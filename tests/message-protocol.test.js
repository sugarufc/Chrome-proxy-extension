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
    directConnectList: "localhost\n127.0.0.1, <local>",
  });

  assert.equal(response.ok, true);
  assert.equal(chrome.proxy.settings.setCalls.length, 1);
  assert.deepEqual(plain(chrome.proxy.settings.setCalls[0].value.rules.bypassList), [
    "localhost",
    "127.0.0.1",
    "<local>",
  ]);
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.directConnectList, "localhost\n127.0.0.1, <local>");
  assert.equal(chrome.storage.local.data.proxyProfile.host, "proxy.example.com");
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.action.iconCalls.length, 1);
});
