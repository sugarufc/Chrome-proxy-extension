"use strict";

importScripts("shared.js", "storage-manager.js");

const AUTH_RETRY_LIMIT = 2;
const AUTH_ATTEMPT_MAX_ENTRIES = 200;
const AUTH_ATTEMPT_TTL_MS = 5 * 60 * 1000;
const TEST_CONNECTION_URL = "https://www.gstatic.com/generate_204";
const TEST_CONNECTION_TIMEOUT_MS = 10_000;
const authAttemptsByRequest = new Map();
const {
  buildProfileFromFields,
  validatePasswordForProfile,
  validateChromeProxySupport,
  buildProxyConfig,
  sanitizeParsedProxy,
  sanitizeErrorMessage,
  describeProxyError,
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
  const savedPassword = state.savedPassword || "";

  // The popup receives the password through the dedicated field below; keep the raw
  // secret out of the general state object.
  delete state.savedPassword;

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
  await restoreProxyForCurrentSession();

  const state = await ProxyStorage.getFullState();
  const sessionConnected = await ProxyStorage.isSessionConnected();
  setActionIcon(Boolean(state.active && sessionConnected));
  return getStatusPayload();
}

async function runConnectionTest() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TEST_CONNECTION_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(TEST_CONNECTION_URL, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (response.status !== 204) {
      return { ok: false, message: `Unexpected response from the network (HTTP ${response.status}).` };
    }

    return { ok: true, status: response.status, latencyMs: Date.now() - startedAt };
  } catch (error) {
    const raw = error && error.message ? error.message : "";
    if ((error && error.name === "AbortError") || /failed to fetch/i.test(raw)) {
      return { ok: false, message: "The proxy is not responding." };
    }
    return { ok: false, message: sanitizeErrorMessage(raw || "Connection check failed.") };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function connectProxy(message) {
  const profile = buildProfileFromFields(message.profile || {});
  const password = String(message.password || "");

  validatePasswordForProfile(profile, password);
  validateChromeProxySupport(profile, password);

  const config = buildProxyConfig(profile);

  await proxySettingsSet(config);
  await ProxyStorage.saveConnection({
    profile,
    password,
    parsedProxy: sanitizeParsedProxy(profile, Boolean(password)),
    profileId: message.profileId || "",
  });
  setActionIcon(true);

  const testResult = await runConnectionTest();
  if (!testResult.ok) {
    await markProxyWarning(testResult.message);
  }

  return {
    ...(await getStatusPayload({ status: "connected" })),
    testResult,
  };
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

async function testConnection() {
  const testResult = await runConnectionTest();

  return {
    ...(await getStatusPayload()),
    testResult,
  };
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
    case "testConnection":
      return testConnection();
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

async function deactivateProxy(errorMessage) {
  await ProxyStorage.setLocal({
    active: false,
    ...(errorMessage ? { lastError: sanitizeErrorMessage(errorMessage) } : { lastProxyError: "" }),
  });
  setActionIcon(false);
  try {
    await proxySettingsClear();
  } catch (_error) {
    // Ignore cleanup errors while deactivating.
  }
}

async function restoreProxyForCurrentSession() {
  await migrateLegacyStorage();

  const state = await ProxyStorage.getFullState();
  // Restore the proxy that was actually connected, not the profile currently
  // selected in the form (activeProxy falls back for pre-2.3.0 data).
  const connectedProfile = state.activeProxy || state.proxyProfile;

  if (!state.active || !connectedProfile) {
    setActionIcon(false);
    return;
  }

  const sessionConnected = await ProxyStorage.isSessionConnected();
  const password = sessionConnected
    ? await ProxyStorage.resolveSessionPassword()
    : await ProxyStorage.resolveSavedPassword();

  if (connectedProfile.username && !password) {
    await deactivateProxy("Saved password is missing. Turn the proxy on again.");
    return;
  }

  try {
    await proxySettingsSet(buildProxyConfig(connectedProfile));
    if (!sessionConnected) {
      // Auto-reconnect: the toggle was left on, so restore the session after
      // a browser restart using the locally saved password.
      await ProxyStorage.restoreSession(password);
    }
    setActionIcon(true);
  } catch (error) {
    await deactivateProxy(error && error.message ? error.message : "Failed to restore the proxy.");
  }
}

async function toggleProxyFromShortcut() {
  const state = await ProxyStorage.getFullState();
  const sessionConnected = await ProxyStorage.isSessionConnected();

  if (state.active && sessionConnected) {
    await disconnectProxy();
    return;
  }

  if (!state.proxyProfile) {
    return;
  }

  try {
    const password = await ProxyStorage.resolveSavedPassword();
    await connectProxy({
      profile: state.proxyProfile,
      password,
      profileId: state.selectedProfileId || "",
    });
  } catch (error) {
    await deactivateProxy(error && error.message ? error.message : "Failed to connect the proxy.");
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
  markProxyWarning(describeProxyError(message));
});

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-proxy") {
    return undefined;
  }
  return toggleProxyFromShortcut();
});

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

chrome.webRequest.onAuthRequired.addListener(handleAuthRequired, { urls: ["<all_urls>"] }, ["asyncBlocking"]);
