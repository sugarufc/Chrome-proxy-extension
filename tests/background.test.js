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
  const context = createRuntimeContext({ chrome, includeStorage: false, includeBackground: true });
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
