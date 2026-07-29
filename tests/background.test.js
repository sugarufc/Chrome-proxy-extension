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

test("background only registers onAuthRequired webRequest listener", () => {
  const { chrome } = loadBackground();

  assert.equal(chrome.webRequest.onAuthRequired.listeners.length, 1);
  assert.equal(chrome.webRequest.onCompleted.listeners.length, 0);
  assert.equal(chrome.webRequest.onErrorOccurred.listeners.length, 0);
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

test("proxy errors are persisted only while the proxy session is active", async () => {
  const inactive = loadBackground({ active: false });
  const [{ listener: inactiveListener }] = inactive.chrome.proxy.onProxyError.listeners;

  await inactiveListener({ error: "net::ERR_PROXY_CONNECTION_FAILED" });

  assert.equal(inactive.chrome.storage.local.data.lastProxyError, undefined);

  const active = loadBackground({ active: true }, { sessionConnected: true });
  const [{ listener: activeListener }] = active.chrome.proxy.onProxyError.listeners;

  await activeListener({ error: "net::ERR_PROXY_CONNECTION_FAILED" });

  assert.match(active.chrome.storage.local.data.lastProxyError, /reach the proxy/i);
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
