importScripts("shared.js", "storage-manager.js");

("use strict");

const AUTH_RETRY_LIMIT = 2;
const authAttemptsByRequest = new Map();
const { DEFAULT_DIRECT_CONNECT_LIST, parseDirectConnectList, buildProxyConfig, sanitizeErrorMessage } = ProxyShared;

function proxySettingsSet(config) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set({ value: config, scope: "regular" }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

function proxySettingsClear() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear({ scope: "regular" }, () => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve();
    });
  });
}

function setActionIcon(active) {
  const suffix = active ? "-on" : "";
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  });
}

async function markFatalError(message) {
  await ProxyStorage.setLocal({ lastError: sanitizeErrorMessage(message) });
}

async function markProxyWarning(message) {
  await ProxyStorage.setLocal({ lastProxyError: sanitizeErrorMessage(message) });
}

async function disconnectAfterAuthFailure() {
  authAttemptsByRequest.clear();
  try {
    await proxySettingsClear();
  } catch (_error) {
    // Ignore cleanup errors after auth failure.
  }
  await ProxyStorage.setDisconnected();
  setActionIcon(false);
}

function isCurrentProxyChallenge(details, proxyAuth) {
  if (details.isProxy !== true || !details.challenger || !proxyAuth) {
    return false;
  }

  return details.challenger.host === proxyAuth.host && Number(details.challenger.port) === Number(proxyAuth.port);
}

function handleAuthRequired(details, asyncCallback) {
  ProxyStorage.getAuthState()
    .then(async ({ active, proxyAuth }) => {
      if (!active || details.isProxy !== true || !isCurrentProxyChallenge(details, proxyAuth)) {
        authAttemptsByRequest.delete(details.requestId);
        asyncCallback({});
        return;
      }

      const attempts = authAttemptsByRequest.get(details.requestId) || 0;
      if (attempts >= AUTH_RETRY_LIMIT) {
        authAttemptsByRequest.delete(details.requestId);
        await disconnectAfterAuthFailure();
        await markFatalError("Proxy authentication failed. Proxy disconnected.");
        asyncCallback({ cancel: true });
        return;
      }

      authAttemptsByRequest.set(details.requestId, attempts + 1);
      asyncCallback({
        authCredentials: {
          username: proxyAuth.username,
          password: proxyAuth.password,
        },
      });
    })
    .catch(async () => {
      await disconnectAfterAuthFailure();
      await markFatalError("Proxy authentication failed. Proxy disconnected.");
      asyncCallback({ cancel: true });
    });
}

async function migrateLegacyStorage() {
  await ProxyStorage.cleanupLegacySecrets();
}

async function restoreProxyForCurrentSession() {
  await migrateLegacyStorage();

  const sessionConnected = await ProxyStorage.isSessionConnected();
  if (!sessionConnected) {
    await proxySettingsClear();
    await ProxyStorage.setLocal({ active: false, lastProxyError: "" });
    setActionIcon(false);
    return;
  }

  const state = await ProxyStorage.getFullState();
  if (!state.active || !state.proxyProfile) {
    setActionIcon(false);
    return;
  }

  try {
    const directConnectList = parseDirectConnectList(state.directConnectList || DEFAULT_DIRECT_CONNECT_LIST);
    const config = buildProxyConfig(state.proxyProfile, directConnectList);
    await proxySettingsSet(config);
    setActionIcon(true);
  } catch (error) {
    await ProxyStorage.setLocal({ active: false, lastError: sanitizeErrorMessage(error.message) });
    setActionIcon(false);
    try {
      await proxySettingsClear();
    } catch (_clearError) {
      // Ignore cleanup errors after a failed restore.
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await ProxyStorage.configureTrustedStorageAccess();
  await ProxyStorage.cleanupLegacySecrets();
  await restoreProxyForCurrentSession();
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreProxyForCurrentSession();
});

chrome.proxy.onProxyError.addListener((details) => {
  const message = details && details.error ? details.error : "Proxy connection error";
  markProxyWarning(message);
});

chrome.webRequest.onAuthRequired.addListener(handleAuthRequired, { urls: ["<all_urls>"] }, ["asyncBlocking"]);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    authAttemptsByRequest.delete(details.requestId);
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    authAttemptsByRequest.delete(details.requestId);
  },
  { urls: ["<all_urls>"] },
);
