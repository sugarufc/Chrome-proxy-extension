const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { createChromeMock, createRuntimeContext } = require("./helpers/load-extension-scripts.js");

const rootDir = path.resolve(__dirname, "..");

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadBackground(local = {}, session = {}) {
  const chrome = createChromeMock({ local, session });
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
  return chrome;
}

function loadBackgroundWithOptions(options = {}) {
  const chrome = options.chrome || createChromeMock();
  createRuntimeContext({ chrome, includeStorage: false, includeBackground: true, fetch: options.fetch });
  return chrome;
}

function sendBackgroundMessage(chrome, message) {
  const [{ listener }] = chrome.runtime.onMessage.listeners;

  return new Promise((resolve) => {
    const keepAlive = listener(message, {}, resolve);
    assert.equal(keepAlive, true);
  });
}

test("popup delegates proxy, action, and storage mutations to background messages", () => {
  const source = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.doesNotMatch(source, /chrome\.proxy/);
  assert.doesNotMatch(source, /chrome\.action/);
  assert.doesNotMatch(source, /ProxyStorage/);
  assert.match(source, /chrome\.runtime\.sendMessage/);
});

test("background connect message applies proxy settings, icon, and storage state", async () => {
  const chrome = loadBackground(
    {
      disclaimerAccepted: true,
    },
    {},
  );

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile: {
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
    password: "secret",
    rememberPassword: false,
  });

  assert.equal(response.ok, true);
  assert.equal(chrome.proxy.settings.setCalls.length, 1);
  assert.deepEqual(plain(chrome.proxy.settings.setCalls[0].value.rules.bypassList), [
    "localhost",
    "127.0.0.1",
    "<local>",
  ]);
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.directConnectList, undefined);
  assert.equal(chrome.storage.local.data.proxyProfile.host, "proxy.example.com");
  assert.equal(chrome.storage.local.data.activeProxy.host, "proxy.example.com");
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.action.iconCalls.length, 1);
});

test("background status payload exposes the password only through the dedicated field", async () => {
  const chrome = loadBackground(
    {
      disclaimerAccepted: true,
      rememberPassword: true,
      savedPassword: "secret",
    },
    {},
  );

  const response = await sendBackgroundMessage(chrome, { command: "getStatus" });

  assert.equal(response.ok, true);
  assert.equal(response.state.savedPassword, undefined);
  assert.equal(response.password, "secret");
});

test("background testConnection fetches generate_204 only after explicit command", async () => {
  const fetchCalls = [];
  const chrome = loadBackgroundWithOptions({
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return { status: 204 };
    },
  });

  assert.equal(fetchCalls.length, 0);

  const response = await sendBackgroundMessage(chrome, {
    command: "testConnection",
  });

  assert.equal(response.ok, true);
  assert.equal(response.testResult.ok, true);
  assert.equal(response.testResult.status, 204);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://www.gstatic.com/generate_204");
});
