"use strict";

importScripts("shared.js", "storage-manager.js");

const AUTH_RETRY_LIMIT = 2;
const AUTH_FAILURE_MESSAGE = "Proxy authentication failed. Proxy disconnected.";
const AUTH_BLOCKED_MESSAGE = "Proxy login failed. Traffic is blocked. Turn the proxy off or fix the login.";
const WEBRTC_POLICY = "disable_non_proxied_udp";
const AUTH_ATTEMPT_MAX_ENTRIES = 200;
const AUTH_ATTEMPT_TTL_MS = 5 * 60 * 1000;
const TEST_CONNECTION_URL = "https://www.gstatic.com/generate_204";
const TEST_CONNECTION_TIMEOUT_MS = 10_000;
const authAttemptsByRequest = new Map();
// Error codes that only mean "we cancelled the request ourselves"; they say nothing about the proxy.
const IGNORED_REQUEST_ERRORS = /ERR_(?:BLOCKED_BY_CLIENT|ABORTED)/i;
let latestProxyError = { message: "", timestamp: 0 };
let commandQueue = Promise.resolve();
const {
  buildProfileFromFields,
  validatePasswordForProfile,
  buildProxyConfig,
  sanitizeParsedProxy,
  sanitizeErrorMessage,
  describeProxyError,
} = ProxyShared;

// State-changing commands (popup, shortcut, startup restore) run one at a time so that a
// fast toggle or a shortcut press during a connect can never interleave storage and proxy writes.
function runExclusive(task) {
  const result = commandQueue.then(task);
  commandQueue = result.catch(() => {});
  return result;
}

function proxySettings(method, details) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings[method](details, (result) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(result);
    });
  });
}

const proxySettingsSet = (config) => proxySettings("set", { value: config, scope: "regular" });
const proxySettingsClear = () => proxySettings("clear", { scope: "regular" });
async function proxySettingsGet() {
  return (await proxySettings("get", {})) || {};
}

function recordProxyError(message) {
  latestProxyError = { message: describeProxyError(message), timestamp: Date.now() };
}

function setActionIcon(active) {
  const suffix = active ? "-on" : "";
  chrome.action.setBadgeText({ text: "" });
  chrome.action.setTitle({ title: "Proxy Switcher" });
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  });
}

// Regular tabs and calls leak the real IP through WebRTC unless its UDP is restricted.
// The policy applies only while the proxy is on and only after the user opted in.
async function syncWebRtcProtection(active) {
  const setting = chrome.privacy && chrome.privacy.network && chrome.privacy.network.webRTCIPHandlingPolicy;
  if (!setting) {
    return;
  }

  const { webRtcProtection } = await ProxyStorage.getLocal(["webRtcProtection"]);
  await new Promise((resolve) => {
    const done = () => {
      void chrome.runtime.lastError;
      resolve();
    };
    if (active && webRtcProtection) {
      setting.set({ value: WEBRTC_POLICY }, done);
    } else {
      setting.clear({}, done);
    }
  });
}

async function markConnectionState(active) {
  setActionIcon(active);
  await syncWebRtcProtection(active);
}

async function handleAuthFailure() {
  authAttemptsByRequest.clear();

  const { blockOnFailure } = await ProxyStorage.getLocal(["blockOnFailure"]);
  if (blockOnFailure) {
    // Keep Chrome pointed at the proxy so traffic fails instead of leaking directly; the
    // auth handler stops sending credentials until the user reconnects.
    await ProxyStorage.setAuthBlocked(true);
    await ProxyStorage.setLocal({ lastError: AUTH_BLOCKED_MESSAGE });
    await markConnectionState(true);
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    chrome.action.setTitle({ title: AUTH_BLOCKED_MESSAGE });
    return;
  }

  try {
    await proxySettingsClear();
  } catch (_error) {
    // Ignore cleanup errors after auth failure.
  }
  await ProxyStorage.setDisconnected();
  await ProxyStorage.setLocal({ lastError: AUTH_FAILURE_MESSAGE });
  await markConnectionState(false);
}

// Chrome may report the resolved proxy IP as the challenger host even when the profile stores
// a hostname, so only the port is compared. This extension configures exactly one proxy and
// details.isProxy already excludes website logins.
function isCurrentProxyChallenge(details, proxyAuth) {
  return (
    details.isProxy === true &&
    Boolean(details.challenger) &&
    Boolean(proxyAuth) &&
    Number(details.challenger.port) === Number(proxyAuth.port)
  );
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

function recordAuthAttempt(requestId, count, now) {
  authAttemptsByRequest.delete(requestId);
  authAttemptsByRequest.set(requestId, { count, updatedAt: now });
  pruneAuthAttempts(now);
}

// After a browser start Chrome can send proxy requests before onStartup has restored the
// session. Restoring it here keeps the first requests from showing Chrome's sign-in dialog.
async function getAuthStateWithRestore() {
  const auth = await ProxyStorage.getAuthState();
  if (auth.sessionConnected) {
    return auth;
  }

  const state = await ProxyStorage.getFullState();
  const connectedProfile = state.activeProxy || state.proxyProfile;
  if (!state.active || !connectedProfile) {
    return auth;
  }

  const password = await ProxyStorage.getProfilePassword(state.activeProfileId);
  if (connectedProfile.username && !password) {
    return auth;
  }

  await ProxyStorage.restoreSession(password);
  return ProxyStorage.getAuthState();
}

async function resolveAuthResponse(details) {
  // Avoid global onCompleted/onErrorOccurred listeners on <all_urls>. Auth request state
  // is bounded here instead: stale entries expire by TTL, and the Map keeps only an LRU
  // window large enough for concurrent proxy auth challenges.
  const now = Date.now();
  pruneAuthAttempts(now);

  const { active, blocked, proxyAuth } = await getAuthStateWithRestore();
  if (!active || !isCurrentProxyChallenge(details, proxyAuth)) {
    authAttemptsByRequest.delete(details.requestId);
    return {};
  }

  if (blocked) {
    return { cancel: true };
  }

  const attempt = authAttemptsByRequest.get(details.requestId);
  const attempts = attempt ? attempt.count : 0;
  if (attempts >= AUTH_RETRY_LIMIT) {
    authAttemptsByRequest.delete(details.requestId);
    await handleAuthFailure();
    return { cancel: true };
  }

  recordAuthAttempt(details.requestId, attempts + 1, now);
  return { authCredentials: { username: proxyAuth.username, password: proxyAuth.password } };
}

function handleAuthRequired(details, asyncCallback) {
  resolveAuthResponse(details)
    .catch(async () => {
      try {
        await handleAuthFailure();
      } catch (_error) {
        // The request is cancelled below regardless.
      }
      return { cancel: true };
    })
    .then(asyncCallback);
}

async function getStatusPayload(options = {}) {
  const state = await ProxyStorage.getFullState();
  const sessionConnected = await ProxyStorage.isSessionConnected();
  const selectedPassword = state.selectedProfileId
    ? await ProxyStorage.getProfilePassword(state.selectedProfileId)
    : "";

  // The popup receives only the selected profile password through the dedicated
  // field below; keep all secrets out of the general state object.
  delete state.savedPassword;
  delete state.profilePasswords;

  return {
    state,
    sessionConnected,
    blocked: Boolean(state.active && sessionConnected && (await ProxyStorage.isAuthBlocked())),
    selectedPassword,
    status: options.status || "",
    message: options.message || "",
  };
}

async function getCurrentStatus() {
  const payload = await getStatusPayload();
  await markConnectionState(Boolean(payload.state.active && payload.sessionConnected));
  return payload;
}

// The most specific explanation for a failed check: an auth failure that just disconnected the
// proxy, then the net error Chrome reported for the check request, then a generic message.
async function explainConnectionFailure(error, startedAt) {
  const { active, lastError } = await ProxyStorage.getLocal(["active", "lastError"]);
  if (!active && lastError) {
    return lastError;
  }
  if (latestProxyError.timestamp >= startedAt && latestProxyError.message) {
    return latestProxyError.message;
  }

  const raw = error && error.message ? error.message : "";
  if ((error && error.name === "AbortError") || /failed to fetch/i.test(raw)) {
    return "The proxy is not responding.";
  }
  return sanitizeErrorMessage(raw || "Connection check failed.");
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
    return { ok: false, message: await explainConnectionFailure(error, startedAt) };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function connectProxy(message) {
  const profile = buildProfileFromFields(message.profile || {});
  const password = String(message.password || "");

  validatePasswordForProfile(profile, password);

  const config = buildProxyConfig(profile);

  await ProxyStorage.saveConnection({
    profile,
    password,
    parsedProxy: sanitizeParsedProxy(profile, Boolean(password)),
    profileId: message.profileId || "",
  });

  try {
    await proxySettingsSet(config);
    const control = await proxySettingsGet();
    if (control.levelOfControl !== "controlled_by_this_extension") {
      throw new Error("Another extension or a policy is managing Chrome's proxy settings.");
    }
  } catch (error) {
    await ProxyStorage.setDisconnected();
    try {
      await proxySettingsClear();
    } catch (_clearError) {
      // Preserve the original connection error.
    }
    await markConnectionState(false);
    throw error;
  }

  await markConnectionState(true);
  return getStatusPayload({ status: "connected" });
}

async function disconnectProxy() {
  await proxySettingsClear();
  await ProxyStorage.setDisconnected();
  await markConnectionState(false);

  return getStatusPayload({ status: "disconnected" });
}

async function forgetAllData() {
  await proxySettingsClear();
  await ProxyStorage.forgetAllData();
  await markConnectionState(false);

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
    password: String(message.password || ""),
    profileId: message.profileId || "",
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

async function renameProfile(message) {
  await ProxyStorage.renameProfile(message.profileId, message.name);
  return getStatusPayload();
}

async function setSettings(message) {
  await ProxyStorage.setSettings(message.settings);
  const payload = await getStatusPayload();
  await markConnectionState(Boolean(payload.state.active && payload.sessionConnected));
  return payload;
}

async function testConnection() {
  // A check while the proxy is off would only measure the direct connection.
  const { active } = await ProxyStorage.getAuthState();
  const testResult = active ? await runConnectionTest() : { ok: false, message: "Turn the proxy on to run the check." };

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
    case "renameProfile":
      return renameProfile(message);
    case "setSettings":
      return setSettings(message);
    case "testConnection":
      return testConnection();
    default:
      throw new Error("Unknown command.");
  }
}

const EXCLUSIVE_COMMANDS = new Set([
  "connect",
  "disconnect",
  "forgetAll",
  "acceptDisclaimer",
  "saveProfile",
  "deleteProfile",
  "selectProfile",
  "renameProfile",
  "setSettings",
]);

// Failures of these commands are stored so the popup can show why the proxy is off.
const PERSISTED_ERROR_COMMANDS = new Set(["connect", "disconnect", "forgetAll"]);

async function persistCommandError(command, errorMessage) {
  if (command === "connect") {
    try {
      await proxySettingsClear();
    } catch (_clearError) {
      // Preserve the original connection error.
    }
  }

  await ProxyStorage.setLocal({
    lastError: errorMessage,
    ...(command === "connect" ? { active: false } : {}),
  });

  if (command === "connect") {
    await markConnectionState(false);
  }
}

// Never rejects: every outcome becomes a response object for the popup.
async function executeCommand(message) {
  const command = message && message.command;

  try {
    return { ok: true, ...(await runRuntimeCommand(message)) };
  } catch (error) {
    const errorMessage = sanitizeErrorMessage(error && error.message ? error.message : "Proxy command failed.");

    if (PERSISTED_ERROR_COMMANDS.has(command)) {
      try {
        await persistCommandError(command, errorMessage);
      } catch (_persistError) {
        // The response below still reports the original error.
      }
    }

    return { ok: false, error: errorMessage };
  }
}

function handleRuntimeMessage(message, _sender, sendResponse) {
  const run = () => executeCommand(message);
  const result = EXCLUSIVE_COMMANDS.has(message && message.command) ? runExclusive(run) : run();

  result.then(sendResponse);
  return true;
}

async function deactivateProxy(errorMessage) {
  const sanitizedError = errorMessage ? sanitizeErrorMessage(errorMessage) : "";
  await ProxyStorage.setLocal({
    active: false,
    ...(sanitizedError ? { lastError: sanitizedError } : {}),
  });
  await markConnectionState(false);
  if (sanitizedError) {
    chrome.action.setBadgeText({ text: "!" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
    chrome.action.setTitle({ title: sanitizedError });
  }
  try {
    await proxySettingsClear();
  } catch (_error) {
    // Ignore cleanup errors while deactivating.
  }
}

async function restoreProxyForCurrentSession() {
  const state = await ProxyStorage.getFullState();
  // Restore the proxy that was actually connected, not the profile currently
  // selected in the form (activeProxy falls back for pre-2.3.0 data).
  const connectedProfile = state.activeProxy || state.proxyProfile;

  if (!state.active || !connectedProfile) {
    await markConnectionState(false);
    return;
  }

  const sessionConnected = await ProxyStorage.isSessionConnected();
  const password = sessionConnected
    ? await ProxyStorage.resolveSessionPassword()
    : await ProxyStorage.getProfilePassword(state.activeProfileId);

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
    await markConnectionState(true);
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
    const password = await ProxyStorage.getProfilePassword(state.selectedProfileId);
    await connectProxy({
      profile: state.proxyProfile,
      password,
      profileId: state.selectedProfileId || "",
    });
  } catch (error) {
    await deactivateProxy(error && error.message ? error.message : "Failed to connect the proxy.");
  }
}

chrome.runtime.onInstalled.addListener(() =>
  runExclusive(async () => {
    await ProxyStorage.configureTrustedStorageAccess();
    const { removedActiveProxy } = await ProxyStorage.migrateStorage();
    if (removedActiveProxy) {
      await proxySettingsClear();
    }
    await restoreProxyForCurrentSession();
  }),
);

chrome.runtime.onStartup.addListener(() =>
  runExclusive(async () => {
    // An error from the previous browser session is stale; the restore below may set a new one.
    await ProxyStorage.setLocal({ lastError: "" });
    await restoreProxyForCurrentSession();
  }),
);

// PAC-script errors only. Failures of a fixed proxy arrive through onErrorOccurred below.
chrome.proxy.onProxyError.addListener((details) => {
  recordProxyError(details && details.error ? details.error : "Proxy connection error");
});

// Scoped to the connection-check URL so no request on regular pages is observed.
chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details && details.error && !IGNORED_REQUEST_ERRORS.test(details.error)) {
      recordProxyError(details.error);
    }
  },
  { urls: [TEST_CONNECTION_URL] },
);

chrome.commands.onCommand.addListener((command) => {
  if (command !== "toggle-proxy") {
    return undefined;
  }
  return runExclusive(toggleProxyFromShortcut);
});

chrome.runtime.onMessage.addListener(handleRuntimeMessage);

chrome.webRequest.onAuthRequired.addListener(handleAuthRequired, { urls: ["<all_urls>"] }, ["asyncBlocking"]);
