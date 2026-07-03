"use strict";

importScripts("shared.js", "storage-manager.js");

const AUTH_RETRY_LIMIT = 2;
const AUTH_ATTEMPT_MAX_ENTRIES = 200;
const AUTH_ATTEMPT_TTL_MS = 5 * 60 * 1000;
const authAttemptsByRequest = new Map();
const {
  DEFAULT_DIRECT_CONNECT_LIST,
  buildProfileFromFields,
  validatePasswordForProfile,
  validateChromeProxySupport,
  parseDirectConnectList,
  buildProxyConfig,
  sanitizeParsedProxy,
  sanitizeErrorMessage,
} = ProxyShared;

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

  const challengerPort = Number(details.challenger.port);
  const proxyPort = Number(proxyAuth.port);
  if (challengerPort !== proxyPort) {
    return false;
  }

  const challengerHost = String(details.challenger.host || "").toLowerCase();
  const proxyHost = String(proxyAuth.host || "").toLowerCase();
  if (challengerHost === proxyHost) {
    return true;
  }

  // Chrome may report the resolved proxy IP here even when the profile stores a hostname.
  // This extension configures exactly one active singleProxy, so details.isProxy + matching
  // port is the narrow fallback. Trade-off: this intentionally trusts the current single
  // proxy config over exact DNS-name equality.
  return true;
}

function pruneAuthAttempts(now = Date.now()) {
  for (const [requestId, attempt] of authAttemptsByRequest) {
    if (now - attempt.updatedAt > AUTH_ATTEMPT_TTL_MS) {
      authAttemptsByRequest.delete(requestId);
    }
  }

  while (authAttemptsByRequest.size > AUTH_ATTEMPT_MAX_ENTRIES) {
    const oldestRequestId = authAttemptsByRequest.keys().next().value;
    authAttemptsByRequest.delete(oldestRequestId);
  }
}

function getAuthAttemptCount(requestId) {
  const attempt = authAttemptsByRequest.get(requestId);
  return attempt ? attempt.count : 0;
}

function recordAuthAttempt(requestId, count, now) {
  authAttemptsByRequest.delete(requestId);
  authAttemptsByRequest.set(requestId, {
    count,
    updatedAt: now,
  });
  pruneAuthAttempts(now);
}

function handleAuthRequired(details, asyncCallback) {
  const now = Date.now();
  // Avoid global onCompleted/onErrorOccurred listeners on <all_urls>. Auth request state
  // is bounded here instead: stale entries expire by TTL, and the Map keeps only an LRU
  // window large enough for concurrent proxy auth challenges.
  pruneAuthAttempts(now);

  ProxyStorage.getAuthState()
    .then(async ({ active, proxyAuth }) => {
      if (!active || details.isProxy !== true || !isCurrentProxyChallenge(details, proxyAuth)) {
        authAttemptsByRequest.delete(details.requestId);
        asyncCallback({});
        return;
      }

      const attempts = getAuthAttemptCount(details.requestId);
      if (attempts >= AUTH_RETRY_LIMIT) {
        authAttemptsByRequest.delete(details.requestId);
        await disconnectAfterAuthFailure();
        await markFatalError("Proxy authentication failed. Proxy disconnected.");
        asyncCallback({ cancel: true });
        return;
      }

      recordAuthAttempt(details.requestId, attempts + 1, now);
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

async function getStatusPayload(options = {}) {
  const state = await ProxyStorage.getFullState();
  const sessionConnected = await ProxyStorage.isSessionConnected();
  const sessionPassword = sessionConnected ? await ProxyStorage.resolveSessionPassword() : "";
  const savedPassword = state.rememberPassword && state.savedPassword ? state.savedPassword : "";

  return {
    state,
    sessionConnected,
    password: sessionPassword || savedPassword,
    status: options.status || "",
    message: options.message || "",
  };
}

async function getCurrentStatus() {
  await ProxyStorage.configureTrustedStorageAccess();
  await migrateLegacyStorage();

  const state = await ProxyStorage.getFullState();
  const sessionConnected = await ProxyStorage.isSessionConnected();
  if (state.active && !sessionConnected) {
    try {
      await proxySettingsClear();
    } catch (_error) {
      // Ignore cleanup errors for stale active state.
    }
    await ProxyStorage.setLocal({ active: false, lastProxyError: "" });
    setActionIcon(false);
    return getStatusPayload({
      status: "warning",
      message: "Session expired. Click Connect to use the proxy again.",
    });
  }

  setActionIcon(Boolean(state.active && sessionConnected));
  return getStatusPayload();
}

async function connectProxy(message) {
  const profile = buildProfileFromFields(message.profile || {});
  const password = String(message.password || "");
  const directConnectList = message.directConnectList || DEFAULT_DIRECT_CONNECT_LIST;

  validatePasswordForProfile(profile, password);
  validateChromeProxySupport(profile, password);

  const parsedDirectConnectList = parseDirectConnectList(directConnectList);
  const config = buildProxyConfig(profile, parsedDirectConnectList);

  await proxySettingsSet(config);
  await ProxyStorage.saveConnection({
    profile,
    password,
    rememberPassword: Boolean(message.rememberPassword),
    directConnectList,
    parsedProxy: sanitizeParsedProxy(profile, Boolean(password)),
    profileId: message.profileId || "",
  });
  setActionIcon(true);

  return getStatusPayload({ status: "connected" });
}

async function disconnectProxy() {
  await proxySettingsClear();
  await ProxyStorage.setDisconnected();
  setActionIcon(false);

  return getStatusPayload({ status: "disconnected" });
}

async function forgetAllData() {
  await proxySettingsClear();
  await ProxyStorage.forgetAllData();
  setActionIcon(false);

  return getStatusPayload({ status: "disconnected" });
}

async function acceptDisclaimer() {
  await ProxyStorage.acceptDisclaimer();
  return getStatusPayload();
}

async function saveProfile(message) {
  await ProxyStorage.saveProfile({
    name: message.name,
    profile: message.profile,
  });
  return getStatusPayload();
}

async function deleteProfile(message) {
  await ProxyStorage.deleteProfile(message.profileId);
  return getStatusPayload();
}

async function selectProfile(message) {
  await ProxyStorage.selectProfile(message.profileId);
  return getStatusPayload();
}

async function runRuntimeCommand(message) {
  switch (message && message.command) {
    case "connect":
      return connectProxy(message);
    case "disconnect":
      return disconnectProxy();
    case "forgetAll":
      return forgetAllData();
    case "getStatus":
      return getCurrentStatus();
    case "acceptDisclaimer":
      return acceptDisclaimer();
    case "saveProfile":
      return saveProfile(message);
    case "deleteProfile":
      return deleteProfile(message);
    case "selectProfile":
      return selectProfile(message);
    default:
      throw new Error("Unknown command.");
  }
}

function shouldPersistCommandError(command) {
  return command === "connect" || command === "disconnect" || command === "forgetAll";
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  runRuntimeCommand(message)
    .then((payload) => {
      sendResponse({ ok: true, ...payload });
    })
    .catch(async (error) => {
      const command = message && message.command;
      const errorMessage = sanitizeErrorMessage(error && error.message ? error.message : "Proxy command failed.");

      if (shouldPersistCommandError(command)) {
        await ProxyStorage.setLocal({
          lastError: errorMessage,
          ...(command === "connect" ? { active: false } : {}),
        });
        if (command === "connect") {
          setActionIcon(false);
        }
      }

      sendResponse({ ok: false, error: errorMessage });
    });

  return true;
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

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

chrome.webRequest.onAuthRequired.addListener(handleAuthRequired, { urls: ["<all_urls>"] }, ["asyncBlocking"]);
