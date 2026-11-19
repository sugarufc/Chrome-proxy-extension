"use strict";

importScripts("shared.js");

const { parseProxyInput, formatProxyString, buildProxyConfig } = ProxyShared;

const AUTH_RETRY_LIMIT = 2;
const AUTH_ATTEMPTS_MAX = 100;
const AUTH_FAILURE_MESSAGE = "Proxy authentication failed. Proxy turned off.";
const CONTROLLED = "controlled_by_this_extension";
const CONTROL_LOST_MESSAGE = "Another extension or a policy took over Chrome's proxy settings. Proxy turned off.";
const TASK_TIMEOUT_MS = 10_000;
const TASK_TIMEOUT_MESSAGE = "Chrome did not respond in time. Try again.";
// Keys written by older versions (profiles, session passwords, ...). Imported once, then removed.
const OLD_KEYS = [
  "proxyProfile",
  "proxyProfiles",
  "selectedProfileId",
  "activeProfileId",
  "activeProxy",
  "profilePasswords",
  "savedPassword",
  "parsedProxy",
  "lastProxyError",
  "schemaVersion",
  "proxyUrl",
  "proxyAuth",
  "encryptionKey",
  "bypassList",
  "directConnectList",
  "rememberPassword",
  "encryptedPassword",
  "encryptionSalt",
  "pinVerifier",
];

// Challenges seen per request id: Chrome repeats the challenge for the same request
// when the credentials were rejected.
const authAttempts = new Map();
let queue = Promise.resolve();

// A Chrome API that never answers must not block every later command.
function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(TASK_TIMEOUT_MESSAGE)), TASK_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// State-changing work runs one at a time, so a quick toggle can never interleave.
function exclusive(task) {
  const result = queue.then(() => withTimeout(task()));
  queue = result.catch(() => {});
  return result;
}

function proxySettings(method, details) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings[method](details, (result) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(result);
    });
  });
}

// "!" on the icon means the proxy is off because of an error; the popup shows the reason.
function setIcon(active, error = "") {
  const suffix = active ? "-on" : "";
  chrome.action.setBadgeText({ text: error ? "!" : "" });
  if (error) {
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  }
  chrome.action.setTitle({ title: error || "Proxy Switcher" });
  chrome.action.setIcon({
    path: {
      16: `icons/icon16${suffix}.png`,
      48: `icons/icon48${suffix}.png`,
      128: `icons/icon128${suffix}.png`,
    },
  });
}

async function applyProxy(proxy) {
  await proxySettings("set", { value: buildProxyConfig(proxy), scope: "regular" });
  const { levelOfControl } = await proxySettings("get", {});
  if (levelOfControl !== CONTROLLED) {
    throw new Error("Another extension or a policy is managing Chrome's proxy settings.");
  }
}

async function clearProxy() {
  try {
    await proxySettings("clear", { scope: "regular" });
  } catch (_error) {
    // Nothing useful to do: the state below says "off" either way.
  }
}

async function turnOff(error = "") {
  await clearProxy();
  await chrome.storage.local.set({ active: false, lastError: error });
  setIcon(false, error);
}

async function connectProxy(proxy) {
  await chrome.storage.local.set({ proxy, active: true, lastError: "" });
  try {
    await applyProxy(proxy);
  } catch (error) {
    await turnOff(error.message);
    throw error;
  }
  setIcon(true);
}

async function getStatus() {
  const state = await chrome.storage.local.get(["disclaimerAccepted", "active", "proxy", "lastError"]);
  return {
    accepted: Boolean(state.disclaimerAccepted),
    active: Boolean(state.active && state.proxy),
    label: state.proxy ? `${state.proxy.scheme}://${state.proxy.host}:${state.proxy.port}` : "",
    input: formatProxyString(state.proxy),
    error: state.lastError || "",
  };
}

// An old profile is kept only if it passes the same checks as a pasted proxy
// (HTTP/HTTPS, host, port 1-65535, a password for a username).
function importOldProxy(profile, password) {
  if (!profile || !profile.host) {
    return null;
  }
  try {
    return parseProxyInput(
      formatProxyString({
        scheme: String(profile.scheme || "").toLowerCase(),
        host: profile.host,
        port: profile.port,
        username: profile.username || "",
        password: profile.username ? password : "",
      }),
    );
  } catch (_error) {
    return null;
  }
}

// Pre-4.0 data had several profiles. Keep the proxy that was in use (or selected).
async function migrateOldData() {
  const old = await chrome.storage.local.get(null);
  if (!OLD_KEYS.some((key) => key in old)) {
    return;
  }

  const profiles = Array.isArray(old.proxyProfiles) ? old.proxyProfiles : [];
  // The password must belong to the same proxy: the connected one, otherwise the selected one.
  const profileId = old.activeProxy ? old.activeProfileId : old.selectedProfileId;
  const profile = old.activeProxy || profiles.find((item) => item.id === profileId) || old.proxyProfile;
  const password = ((old.profilePasswords || {})[profileId] || old.savedPassword || "").toString();
  const proxy = old.proxy ? null : importOldProxy(profile, password);

  await chrome.storage.local.set(proxy ? { proxy } : { active: false });
  await chrome.storage.local.remove(OLD_KEYS);
  if (chrome.storage.session) {
    await chrome.storage.session.clear();
  }
}

// Chrome keeps the proxy across restarts, but re-applying it makes the state authoritative.
async function restore() {
  await migrateOldData();
  const { active, proxy } = await chrome.storage.local.get(["active", "proxy"]);

  if (!(active && proxy)) {
    await clearProxy();
    await chrome.storage.local.set({ active: false, lastError: "" });
    setIcon(false);
    return;
  }

  try {
    await applyProxy(proxy);
    await chrome.storage.local.set({ lastError: "" });
    setIcon(true);
  } catch (error) {
    await turnOff(error.message);
  }
}

async function toggleFromShortcut() {
  const { active, proxy } = await chrome.storage.local.get(["active", "proxy"]);
  if (active) {
    await turnOff();
    return;
  }
  if (!proxy) {
    return;
  }

  try {
    await connectProxy(proxy);
  } catch (_error) {
    // connectProxy has already turned the proxy off and flagged the icon.
  }
}

async function respondToAuth(details) {
  const { active, proxy } = await chrome.storage.local.get(["active", "proxy"]);
  // Only the configured proxy gets the credentials, never a website asking for a login.
  // Chrome may report the resolved IP as the challenger host, so only the port is compared.
  const isOurProxy =
    active &&
    proxy &&
    proxy.username &&
    details.isProxy === true &&
    details.challenger &&
    Number(details.challenger.port) === proxy.port;
  if (!isOurProxy) {
    return {};
  }
  // If another extension or a policy has taken over, the challenge comes from someone else's proxy.
  const { levelOfControl } = await proxySettings("get", {});
  if (levelOfControl !== CONTROLLED) {
    return {};
  }

  const attempts = (authAttempts.get(details.requestId) || 0) + 1;
  authAttempts.delete(details.requestId);
  if (attempts > AUTH_RETRY_LIMIT) {
    authAttempts.clear();
    await exclusive(() => turnOff(AUTH_FAILURE_MESSAGE));
    return { cancel: true };
  }

  authAttempts.set(details.requestId, attempts);
  if (authAttempts.size > AUTH_ATTEMPTS_MAX) {
    authAttempts.delete(authAttempts.keys().next().value);
  }
  return { authCredentials: { username: proxy.username, password: proxy.password } };
}

const COMMANDS = {
  getStatus: async () => {},
  acceptDisclaimer: () => chrome.storage.local.set({ disclaimerAccepted: true }),
  connect: (message) => connectProxy(parseProxyInput(message.input)),
  disconnect: () => turnOff(),
  forget: async () => {
    await clearProxy();
    await chrome.storage.local.clear();
    setIcon(false);
  },
};

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const command = COMMANDS[message && message.command];
  if (!command) {
    sendResponse({ ok: false, error: "Unknown command." });
    return false;
  }

  exclusive(async () => {
    await command(message);
    return getStatus();
  }).then(
    (status) => sendResponse({ ok: true, status }),
    (error) => sendResponse({ ok: false, error: error.message || "Something went wrong." }),
  );
  return true;
});

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    respondToAuth(details)
      .catch(() => ({ cancel: true }))
      .then(callback);
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"],
);

// Our own set/clear also fires this event; it is ignored because the state is already up to date.
async function onProxySettingsChange(details) {
  if (details.levelOfControl === CONTROLLED) {
    return;
  }
  const { active } = await chrome.storage.local.get("active");
  if (active) {
    await turnOff(CONTROL_LOST_MESSAGE);
  }
}

chrome.proxy.settings.onChange.addListener((details) => exclusive(() => onProxySettingsChange(details)));

chrome.commands.onCommand.addListener((command) =>
  command === "toggle-proxy" ? exclusive(toggleFromShortcut) : undefined,
);

chrome.runtime.onInstalled.addListener(() => exclusive(restore));
chrome.runtime.onStartup.addListener(() => exclusive(restore));
