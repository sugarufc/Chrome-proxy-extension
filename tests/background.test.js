const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createChromeMock, createRuntimeContext } = require("./helpers/load-extension-scripts.js");

const rootDir = path.resolve(__dirname, "..");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBackground(local = {}, session = {}, options = {}) {
  const chrome = createChromeMock({ local, session });
  const context = createRuntimeContext({ chrome, includeStorage: false, includeBackground: true, ...options });
  return { chrome, context };
}

function callAuthRequired(context, details) {
  return new Promise((resolve) => {
    context.handleAuthRequired(details, resolve);
  });
}

test("background keeps the strict directive before importScripts", () => {
  const source = fs.readFileSync(path.join(rootDir, "background.js"), "utf8");
  assert.equal(source.split(/\r?\n/, 1)[0], '"use strict";');
});

test("background observes webRequest only for proxy auth and the connection-check URL", () => {
  const { chrome } = loadBackground();

  assert.equal(chrome.webRequest.onAuthRequired.listeners.length, 1);
  assert.equal(chrome.webRequest.onCompleted.listeners.length, 0);
  assert.equal(chrome.webRequest.onErrorOccurred.listeners.length, 1);
  assert.deepEqual(plain(chrome.webRequest.onErrorOccurred.listeners[0].filter), {
    urls: ["https://www.gstatic.com/generate_204"],
  });
});

test("proxy auth restores a lost session from saved data instead of showing Chrome's sign-in dialog", async () => {
  const activeProxy = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };
  const { chrome, context } = loadBackground({
    active: true,
    activeProfileId: "profile-a",
    activeProxy,
    proxyProfiles: [{ id: "profile-a", name: "A", ...activeProxy }],
    profilePasswords: { "profile-a": "saved-secret" },
  });

  const result = await callAuthRequired(context, {
    requestId: "early-request",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });

  assert.deepEqual(plain(result), { authCredentials: { username: "user", password: "saved-secret" } });
  assert.equal(chrome.storage.session.data.sessionConnected, true);
});

test("proxy auth does not restore a session for a proxy the user turned off", async () => {
  const { context } = loadBackground({
    active: false,
    proxyProfile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    proxyProfiles: [],
    profilePasswords: {},
  });

  const result = await callAuthRequired(context, {
    requestId: "off-request",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });

  assert.deepEqual(plain(result), {});
});

test("repeated proxy auth rejection disconnects the proxy and records why", async () => {
  const { chrome, context } = loadBackground(
    {
      active: true,
      proxyProfile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    },
    { sessionConnected: true, sessionPassword: "wrong" },
  );
  const details = {
    requestId: "rejected",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  };

  assert.ok((await callAuthRequired(context, details)).authCredentials);
  assert.ok((await callAuthRequired(context, details)).authCredentials);
  const third = await callAuthRequired(context, details);

  assert.deepEqual(plain(third), { cancel: true });
  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.lastError, "Proxy authentication failed. Proxy disconnected.");
  assert.equal(chrome.proxy.settings.clearCalls.length, 1);
  assert.deepEqual(plain(chrome.storage.session.data), {});
});

test("commands run one at a time so a quick off/on cannot interleave", async () => {
  const chrome = createChromeMock({ local: { disclaimerAccepted: true } });
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  const [{ listener }] = chrome.runtime.onMessage.listeners;
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "" };

  const responses = await Promise.all(
    [{ command: "connect", profile }, { command: "disconnect" }, { command: "connect", profile }].map(
      (message) => new Promise((resolve) => listener(message, {}, resolve)),
    ),
  );

  assert.deepEqual(
    responses.map((response) => response.ok),
    [true, true, true],
  );
  assert.deepEqual(
    chrome.operationLog.filter((entry) => entry.startsWith("proxy.settings.") && entry !== "proxy.settings.get"),
    ["proxy.settings.set", "proxy.settings.clear", "proxy.settings.set"],
  );
  assert.equal(chrome.storage.local.data.active, true);
});

test("browser startup drops the previous session's error message", async () => {
  const { chrome } = loadBackground({ active: false, lastError: "Proxy authentication failed. Proxy disconnected." });

  const [{ listener }] = chrome.runtime.onStartup.listeners;
  await listener();

  assert.equal(chrome.storage.local.data.lastError, "");
});

test("proxy auth challenge accepts resolved challenger IP when port matches the single active proxy", async () => {
  const { context } = loadBackground(
    {
      active: true,
      proxyProfile: {
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  const result = await callAuthRequired(context, {
    requestId: "soft-host-match",
    isProxy: true,
    challenger: {
      host: "203.0.113.10",
      port: 8080,
    },
  });

  assert.deepEqual(plain(result), {
    authCredentials: {
      username: "user",
      password: "secret",
    },
  });
});

test("proxy auth challenge rejects non-matching proxy port", async () => {
  const { context } = loadBackground(
    {
      active: true,
      proxyProfile: {
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  const result = await callAuthRequired(context, {
    requestId: "wrong-port",
    isProxy: true,
    challenger: {
      host: "203.0.113.10",
      port: 9090,
    },
  });

  assert.deepEqual(plain(result), {});
});

test("proxy auth answers for the connected proxy snapshot, not the selected form profile", async () => {
  const { context } = loadBackground(
    {
      active: true,
      proxyProfile: {
        scheme: "http",
        host: "other.example.com",
        port: 9090,
        username: "user",
      },
      activeProxy: {
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  const granted = await callAuthRequired(context, {
    requestId: "snapshot-match",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });
  assert.deepEqual(plain(granted), {
    authCredentials: {
      username: "user",
      password: "secret",
    },
  });

  const rejected = await callAuthRequired(context, {
    requestId: "form-profile-challenge",
    isProxy: true,
    challenger: { host: "other.example.com", port: 9090 },
  });
  assert.deepEqual(plain(rejected), {});
});

test("background auto-reconnects the saved proxy on browser startup", async () => {
  const activeProxy = { scheme: "http", host: "active.example.com", port: 8080, username: "active-user" };
  const { chrome } = loadBackground(
    {
      active: true,
      activeProfileId: "profile-a",
      selectedProfileId: "profile-b",
      profilePasswords: {
        "profile-a": "active-secret",
        "profile-b": "selected-secret",
      },
      proxyProfiles: [
        { id: "profile-a", name: "Active", ...activeProxy },
        {
          id: "profile-b",
          name: "Selected",
          scheme: "http",
          host: "selected.example.com",
          port: 9090,
          username: "selected-user",
        },
      ],
      activeProxy,
      proxyProfile: { scheme: "http", host: "selected.example.com", port: 9090, username: "selected-user" },
    },
    {},
  );

  const [{ listener }] = chrome.runtime.onStartup.listeners;
  await listener();

  assert.equal(chrome.proxy.settings.setCalls.length, 1);
  assert.equal(chrome.storage.session.data.sessionConnected, true);
  assert.equal(chrome.storage.session.data.sessionPassword, "active-secret");
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.proxy.settings.setCalls[0].value.rules.singleProxy.host, "active.example.com");
});

test("background startup deactivates an auth proxy when no password is saved", async () => {
  const { chrome } = loadBackground(
    {
      active: true,
      activeProxy: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    },
    {},
  );

  const [{ listener }] = chrome.runtime.onStartup.listeners;
  await listener();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.session.data.sessionConnected, undefined);
  assert.match(chrome.storage.local.data.lastError, /password/i);
});

test("background installation migration clears Chrome settings for a removed SOCKS5 proxy", async () => {
  const socksProfile = {
    id: "socks-profile",
    name: "Legacy SOCKS",
    scheme: "socks5",
    host: "127.0.0.1",
    port: 1080,
    username: "user",
  };
  const chrome = createChromeMock({
    local: {
      active: true,
      proxyProfiles: [socksProfile],
      selectedProfileId: "socks-profile",
      activeProfileId: "socks-profile",
      proxyProfile: socksProfile,
      activeProxy: socksProfile,
      savedPassword: "secret",
    },
    session: { sessionConnected: true, sessionPassword: "secret" },
  });
  createRuntimeContext({ chrome, includeBackground: true });

  const [{ listener }] = chrome.runtime.onInstalled.listeners;
  await listener();

  assert.equal(chrome.proxy.settings.clearCalls.length, 1);
  assert.equal(chrome.storage.local.data.active, false);
  assert.deepEqual(chrome.storage.local.data.proxyProfiles, []);
  assert.equal(chrome.storage.local.data.schemaVersion, 1);
});

test("keyboard shortcut toggles the proxy using the saved settings", async () => {
  const { chrome } = loadBackground(
    {
      disclaimerAccepted: true,
      selectedProfileId: "profile-a",
      proxyProfiles: [
        {
          id: "profile-a",
          name: "Proxy",
          scheme: "http",
          host: "proxy.example.com",
          port: 8080,
          username: "user",
        },
      ],
      proxyProfile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
      profilePasswords: { "profile-a": "secret" },
    },
    {},
    { fetch: async () => ({ status: 204 }) },
  );

  const [{ listener }] = chrome.commands.onCommand.listeners;

  await listener("toggle-proxy");
  assert.equal(chrome.proxy.settings.setCalls.length, 1);
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.session.data.sessionConnected, true);
  assert.equal(chrome.action.badgeTextCalls.at(-1).text, "");
  assert.equal(chrome.action.titleCalls.at(-1).title, "Proxy Switcher");

  await listener("toggle-proxy");
  assert.equal(chrome.proxy.settings.clearCalls.length, 1);
  assert.equal(chrome.storage.local.data.active, false);

  await listener("unrelated-command");
  assert.equal(chrome.proxy.settings.setCalls.length, 1);
});

test("keyboard shortcut shows a red error badge when activation fails", async () => {
  const { chrome } = loadBackground({
    selectedProfileId: "profile-a",
    proxyProfiles: [
      {
        id: "profile-a",
        name: "Proxy",
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
    ],
    proxyProfile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
  });
  const [{ listener }] = chrome.commands.onCommand.listeners;

  await listener("toggle-proxy");

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.action.badgeTextCalls.at(-1).text, "!");
  assert.equal(chrome.action.badgeBackgroundColorCalls.at(-1).color, "#d93025");
  assert.match(chrome.action.titleCalls.at(-1).title, /password/i);
});

test("proxy errors stay transient and are not persisted as the overall proxy status", async () => {
  const inactive = loadBackground({ active: false });
  const [{ listener: inactiveListener }] = inactive.chrome.proxy.onProxyError.listeners;

  await inactiveListener({ error: "net::ERR_PROXY_CONNECTION_FAILED" });

  assert.equal(inactive.chrome.storage.local.data.lastProxyError, undefined);

  const active = loadBackground({ active: true }, { sessionConnected: true });
  const [{ listener: activeListener }] = active.chrome.proxy.onProxyError.listeners;

  await activeListener({ error: "net::ERR_PROXY_CONNECTION_FAILED" });

  assert.equal(active.chrome.storage.local.data.lastProxyError, undefined);
});

test("proxy auth attempts are bounded without completed/error webRequest listeners", async () => {
  const { context } = loadBackground(
    {
      active: true,
      proxyProfile: {
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  await callAuthRequired(context, {
    requestId: "oldest",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });

  for (let index = 0; index < 205; index += 1) {
    await callAuthRequired(context, {
      requestId: `new-${index}`,
      isProxy: true,
      challenger: { host: "proxy.example.com", port: 8080 },
    });
  }

  const secondOldestAttempt = await callAuthRequired(context, {
    requestId: "oldest",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });
  const thirdOldestAttempt = await callAuthRequired(context, {
    requestId: "oldest",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });

  assert.deepEqual(plain(secondOldestAttempt), {
    authCredentials: {
      username: "user",
      password: "secret",
    },
  });
  assert.deepEqual(plain(thirdOldestAttempt), {
    authCredentials: {
      username: "user",
      password: "secret",
    },
  });
});

test("with block-on-failure a rejected login keeps the proxy set and stops sending credentials", async () => {
  const { chrome, context } = loadBackground(
    {
      active: true,
      blockOnFailure: true,
      proxyProfile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    },
    { sessionConnected: true, sessionPassword: "wrong" },
  );
  const challenge = (requestId) => ({
    requestId,
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });

  await callAuthRequired(context, challenge("a"));
  await callAuthRequired(context, challenge("a"));
  assert.deepEqual(plain(await callAuthRequired(context, challenge("a"))), { cancel: true });

  assert.equal(chrome.proxy.settings.clearCalls.length, 0);
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.session.data.authBlocked, true);
  assert.match(chrome.storage.local.data.lastError, /blocked/i);
  assert.equal(chrome.action.badgeTextCalls.at(-1).text, "!");

  // Other requests get no credentials while blocked, so the provider is not hammered.
  assert.deepEqual(plain(await callAuthRequired(context, challenge("b"))), { cancel: true });
});

test("reconnecting after a block re-enables credentials", async () => {
  const chrome = createChromeMock({
    local: { disclaimerAccepted: true, blockOnFailure: true },
    session: { sessionConnected: true, authBlocked: true },
  });
  const context = createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  const [{ listener }] = chrome.runtime.onMessage.listeners;

  await new Promise((resolve) =>
    listener(
      {
        command: "connect",
        profile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
        password: "right",
      },
      {},
      resolve,
    ),
  );

  const granted = await callAuthRequired(context, {
    requestId: "fresh",
    isProxy: true,
    challenger: { host: "proxy.example.com", port: 8080 },
  });
  assert.deepEqual(plain(granted), { authCredentials: { username: "user", password: "right" } });
});

test("WebRTC protection applies only while the proxy is on and the user opted in", async () => {
  const chrome = createChromeMock({ local: { disclaimerAccepted: true }, withPrivacy: true });
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  const [{ listener }] = chrome.runtime.onMessage.listeners;
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));
  const policy = chrome.privacy.network.webRTCIPHandlingPolicy;
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "" };

  await send({ command: "connect", profile });
  assert.equal(policy.setCalls.length, 0);

  await send({ command: "setSettings", settings: { webRtcProtection: true } });
  assert.deepEqual(plain(policy.setCalls.at(-1)), { value: "disable_non_proxied_udp" });

  const clearedBefore = policy.clearCalls;
  await send({ command: "disconnect" });
  assert.equal(policy.clearCalls, clearedBefore + 1);
});

test("background works without the optional privacy permission", async () => {
  const chrome = createChromeMock({ local: { disclaimerAccepted: true, webRtcProtection: true } });
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  const [{ listener }] = chrome.runtime.onMessage.listeners;

  const response = await new Promise((resolve) =>
    listener(
      { command: "connect", profile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "" } },
      {},
      resolve,
    ),
  );

  assert.equal(response.ok, true);
});

test("renameProfile and setSettings commands return the updated status", async () => {
  const chrome = createChromeMock({ local: { disclaimerAccepted: true } });
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  const [{ listener }] = chrome.runtime.onMessage.listeners;
  const send = (message) => new Promise((resolve) => listener(message, {}, resolve));

  const saved = await send({
    command: "saveProfile",
    name: "one.example.com",
    profile: { scheme: "http", host: "one.example.com", port: 8080, username: "" },
  });
  const profileId = saved.state.selectedProfileId;

  const renamed = await send({ command: "renameProfile", profileId, name: "Home" });
  assert.equal(renamed.state.proxyProfiles[0].name, "Home");

  const settings = await send({ command: "setSettings", settings: { blockOnFailure: true } });
  assert.equal(settings.state.blockOnFailure, true);
});
