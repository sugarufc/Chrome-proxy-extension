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

test("popup profile options display only the profile name", () => {
  const source = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.match(source, /option\.textContent = profile\.name;/);
  assert.doesNotMatch(source, /profileOptionLabel/);
});

test("popup does not advertise or handle SOCKS5", () => {
  const popupHtml = fs.readFileSync(path.join(rootDir, "popup.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.doesNotMatch(popupHtml, /socks5/i);
  assert.doesNotMatch(popupSource, /socks5/i);
  assert.doesNotMatch(popupSource, /validateChromeProxySupport/);
});

test("popup contains no password mask and sends the parsed password when saving a profile", () => {
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");
  const sharedSource = fs.readFileSync(path.join(rootDir, "shared.js"), "utf8");

  assert.doesNotMatch(popupSource, /PASSWORD_MASK|\*{6}/);
  assert.doesNotMatch(sharedSource, /PASSWORD_MASK|\*{6}/);
  assert.match(
    popupSource,
    /sendCommand\("saveProfile",\s*\{\s*name,\s*profile:\s*parsed\.profile,\s*password:\s*parsed\.password,\s*profileId:/s,
  );
  assert.match(popupSource, /selectedPassword/);
});

test("popup uses inline confirmations instead of blocking browser dialogs", () => {
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.doesNotMatch(popupSource, /window\.(?:prompt|confirm)/);
  assert.match(popupSource, /Confirm delete\?/);
  assert.match(popupSource, /Confirm forget\?/);
  assert.match(popupSource, /4_000/);
});

test("popup connects on Enter but runs connection checks only from the status line", () => {
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");
  const connectSource = popupSource.match(
    /async function connect\(\) \{([\s\S]*?)\n    \}\n\n    async function disconnect/,
  );

  assert.ok(connectSource);
  assert.match(popupSource, /proxyInput\.addEventListener\("keydown"/);
  assert.match(popupSource, /event\.key !== "Enter"/);
  assert.doesNotMatch(connectSource[1], /runConnectionCheck/);
  assert.match(popupSource, /statusLine\.addEventListener\("click", retestConnection\)/);
  assert.doesNotMatch(popupSource, /state\.lastProxyError/);
});

test("popup ignores storage changes while its own command is running and labels the save button", () => {
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.match(
    popupSource,
    /chrome\.storage\.onChanged\.addListener\(\(changes, areaName\) => \{\s*\/\/[^\n]*\n\s*if \(busy\)/,
  );
  assert.match(popupSource, /"Update profile" : "Save as profile"/);
  assert.doesNotMatch(popupSource, /lastProxyError/);
});

test("popup renders the installed manifest version in a shared footer label", () => {
  const popupHtml = fs.readFileSync(path.join(rootDir, "popup.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.match(popupHtml, /<p id="versionLabel" class="version-label" aria-label="Extension version"><\/p>/);
  assert.match(popupSource, /versionLabel\.textContent = `Version \$\{chrome\.runtime\.getManifest\(\)\.version\}`/);
});

test("background connect stores auth state before applying controlled proxy settings without running a network test", async () => {
  const fetchCalls = [];
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({ local: { disclaimerAccepted: true } }),
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return { status: 204 };
    },
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile: {
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
    password: "secret",
  });

  assert.equal(response.ok, true);
  assert.equal(response.testResult, undefined);
  assert.equal(fetchCalls.length, 0);
  assert.equal(chrome.proxy.settings.setCalls.length, 1);
  assert.equal(chrome.proxy.settings.getCalls.length, 1);
  assert.ok(chrome.operationLog.indexOf("storage.local.set") < chrome.operationLog.indexOf("proxy.settings.set"));
  assert.ok(chrome.operationLog.indexOf("storage.session.set") < chrome.operationLog.indexOf("proxy.settings.set"));
  assert.deepEqual(plain(chrome.proxy.settings.setCalls[0].value.rules.bypassList), [
    "localhost",
    "127.0.0.1",
    "<local>",
  ]);
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.proxyProfile.host, "proxy.example.com");
  assert.equal(chrome.storage.local.data.activeProxy.host, "proxy.example.com");
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.deepEqual(Object.values(chrome.storage.local.data.profilePasswords), ["secret"]);
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.action.iconCalls.length, 1);
});

test("background connect fully rolls back when applying proxy settings fails", async () => {
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({
      local: { disclaimerAccepted: true },
      proxySetError: "Proxy settings are unavailable.",
    }),
    fetch: async () => ({ status: 204 }),
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    password: "secret",
  });

  assert.equal(response.ok, false);
  assert.equal(chrome.storage.local.data.active, false);
  assert.deepEqual(plain(chrome.storage.session.data), {});
  assert.ok(chrome.proxy.settings.clearCalls.length >= 1);
  assert.equal(chrome.action.iconCalls.at(-1).path[16], "icons/icon16.png");
});

test("background connect rejects proxy settings controlled by another extension or policy", async () => {
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({
      local: { disclaimerAccepted: true },
      proxyLevelOfControl: "controlled_by_other_extensions",
    }),
    fetch: async () => ({ status: 204 }),
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile: { scheme: "https", host: "proxy.example.com", port: 443, username: "user" },
    password: "secret",
  });

  assert.equal(response.ok, false);
  assert.equal(response.error, "Another extension or a policy is managing Chrome's proxy settings.");
  assert.equal(chrome.proxy.settings.getCalls.length, 1);
  assert.equal(chrome.storage.local.data.active, false);
  assert.deepEqual(plain(chrome.storage.session.data), {});
  assert.ok(chrome.proxy.settings.clearCalls.length >= 1);
});

test("background rejects SOCKS5 before changing Chrome proxy settings", async () => {
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({ local: { disclaimerAccepted: true } }),
    fetch: async () => ({ status: 204 }),
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile: {
      scheme: "socks5",
      host: "127.0.0.1",
      port: 1080,
      username: "",
    },
    password: "",
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /only HTTP and HTTPS/);
  assert.equal(chrome.proxy.settings.setCalls.length, 0);
});

test("background status payload exposes only the selected profile password through a dedicated field", async () => {
  const chrome = loadBackground(
    {
      disclaimerAccepted: true,
      selectedProfileId: "profile-b",
      proxyProfiles: [
        {
          id: "profile-a",
          name: "First",
          scheme: "http",
          host: "first.example.com",
          port: 8080,
          username: "first-user",
        },
        {
          id: "profile-b",
          name: "Second",
          scheme: "https",
          host: "second.example.com",
          port: 443,
          username: "second-user",
        },
      ],
      profilePasswords: {
        "profile-a": "alpha-secret",
        "profile-b": "beta-secret",
      },
    },
    {},
  );

  const response = await sendBackgroundMessage(chrome, { command: "getStatus" });

  assert.equal(response.ok, true);
  assert.equal(response.state.savedPassword, undefined);
  assert.equal(response.state.profilePasswords, undefined);
  assert.equal(response.selectedPassword, "beta-secret");
  assert.equal(response.password, undefined);
});

test("background getStatus reads state without migrations or proxy setting writes", async () => {
  const chrome = loadBackground({
    schemaVersion: 1,
    disclaimerAccepted: true,
    active: false,
  });

  const response = await sendBackgroundMessage(chrome, { command: "getStatus" });

  assert.equal(response.ok, true);
  assert.equal(chrome.storage.local.setCalls.length, 0);
  assert.equal(chrome.storage.local.removeCalls.length, 0);
  assert.equal(chrome.proxy.settings.setCalls.length, 0);
  assert.equal(chrome.proxy.settings.clearCalls.length, 0);
});

test("background keeps a matching selected profile password when connect omits the transient profile id", async () => {
  const profile = {
    id: "profile-a",
    name: "Saved proxy",
    scheme: "https",
    host: "proxy.example.com",
    port: 443,
    username: "proxy-user",
  };
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({
      local: {
        disclaimerAccepted: true,
        selectedProfileId: profile.id,
        proxyProfiles: [profile],
      },
    }),
    fetch: async () => ({ status: 204 }),
  });

  const connected = await sendBackgroundMessage(chrome, {
    command: "connect",
    profile,
    password: "profile-secret",
  });
  assert.equal(connected.ok, true);

  const disconnected = await sendBackgroundMessage(chrome, { command: "disconnect" });
  assert.equal(disconnected.ok, true);

  const reopened = await sendBackgroundMessage(chrome, { command: "getStatus" });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.selectedPassword, "profile-secret");
});

test("background saveProfile stores the password only for the saved profile", async () => {
  const chrome = loadBackground({
    disclaimerAccepted: true,
    proxyProfiles: [
      {
        id: "profile-a",
        name: "First",
        scheme: "http",
        host: "first.example.com",
        port: 8080,
        username: "first-user",
      },
    ],
    profilePasswords: { "profile-a": "alpha-secret" },
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "saveProfile",
    name: "Second",
    profile: {
      scheme: "https",
      host: "second.example.com",
      port: 443,
      username: "second-user",
    },
    password: "beta-secret",
  });

  assert.equal(response.ok, true);
  const secondProfile = chrome.storage.local.data.proxyProfiles.find((profile) => profile.name === "Second");
  assert.ok(secondProfile);
  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "alpha-secret");
  assert.equal(chrome.storage.local.data.profilePasswords[secondProfile.id], "beta-secret");
});

test("background testConnection fetches generate_204 only after explicit command", async () => {
  const fetchCalls = [];
  const chrome = createChromeMock({
    local: { active: true },
    session: { sessionConnected: true },
  });
  loadBackgroundWithOptions({
    chrome,
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
  assert.equal(typeof response.testResult.latencyMs, "number");
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://www.gstatic.com/generate_204");
});

test("background testConnection makes no request while the proxy is off", async () => {
  const fetchCalls = [];
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({ local: { active: false } }),
    fetch: async (url) => {
      fetchCalls.push(url);
      return { status: 204 };
    },
  });

  const response = await sendBackgroundMessage(chrome, { command: "testConnection" });

  assert.equal(response.ok, true);
  assert.equal(response.testResult.ok, false);
  assert.match(response.testResult.message, /turn the proxy on/i);
  assert.deepEqual(fetchCalls, []);
});

test("background reports connection check failures in plain language", async () => {
  const activeChrome = () => createChromeMock({ local: { active: true }, session: { sessionConnected: true } });
  const unreachable = loadBackgroundWithOptions({
    chrome: activeChrome(),
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
  });
  const unreachableResponse = await sendBackgroundMessage(unreachable, { command: "testConnection" });

  assert.equal(unreachableResponse.ok, true);
  assert.equal(unreachableResponse.testResult.ok, false);
  assert.equal(unreachableResponse.testResult.message, "The proxy is not responding.");

  const intercepted = loadBackgroundWithOptions({
    chrome: activeChrome(),
    fetch: async () => ({ status: 200 }),
  });
  const interceptedResponse = await sendBackgroundMessage(intercepted, { command: "testConnection" });

  assert.equal(interceptedResponse.testResult.ok, false);
  assert.equal(interceptedResponse.testResult.message, "Unexpected response from the network (HTTP 200).");
});

test("background explains a failed connection check with the net error Chrome reported", async () => {
  const chrome = createChromeMock({ local: { active: true }, session: { sessionConnected: true } });
  createRuntimeContext({
    chrome,
    includeStorage: false,
    includeBackground: true,
    fetch: async () => {
      const [{ listener }] = chrome.webRequest.onErrorOccurred.listeners;
      listener({ error: "net::ERR_PROXY_CONNECTION_FAILED" });
      throw new TypeError("Failed to fetch");
    },
  });

  const response = await sendBackgroundMessage(chrome, { command: "testConnection" });

  assert.equal(response.testResult.ok, false);
  assert.equal(response.testResult.message, "Can't reach the proxy server. Check the address and port.");
});

test("background ignores self-inflicted request errors when explaining a failed check", async () => {
  const chrome = createChromeMock({ local: { active: true }, session: { sessionConnected: true } });
  createRuntimeContext({
    chrome,
    includeStorage: false,
    includeBackground: true,
    fetch: async () => {
      const [{ listener }] = chrome.webRequest.onErrorOccurred.listeners;
      listener({ error: "net::ERR_BLOCKED_BY_CLIENT" });
      throw new TypeError("Failed to fetch");
    },
  });

  const response = await sendBackgroundMessage(chrome, { command: "testConnection" });

  assert.equal(response.testResult.message, "The proxy is not responding.");
});

test("background reports an authentication failure instead of a generic check error", async () => {
  const chrome = createChromeMock({ local: { active: true }, session: { sessionConnected: true } });
  createRuntimeContext({
    chrome,
    includeStorage: false,
    includeBackground: true,
    fetch: async () => {
      // The auth handler gave up and disconnected while the check request was pending.
      chrome.storage.local.data.active = false;
      chrome.storage.local.data.lastError = "Proxy authentication failed. Proxy disconnected.";
      throw new TypeError("Failed to fetch");
    },
  });

  const response = await sendBackgroundMessage(chrome, { command: "testConnection" });

  assert.equal(response.testResult.message, "Proxy authentication failed. Proxy disconnected.");
});

test("background connect does not overwrite the selected profile when a different proxy is connected", async () => {
  const saved = { scheme: "http", host: "saved.example.com", port: 8080, username: "saved-user" };
  const chrome = loadBackgroundWithOptions({
    chrome: createChromeMock({
      local: {
        disclaimerAccepted: true,
        selectedProfileId: "profile-a",
        proxyProfiles: [{ id: "profile-a", name: "Saved", ...saved }],
        profilePasswords: { "profile-a": "saved-secret" },
      },
    }),
  });

  const response = await sendBackgroundMessage(chrome, {
    command: "connect",
    profileId: "profile-a",
    profile: { scheme: "http", host: "typed.example.com", port: 9090, username: "typed-user" },
    password: "typed-secret",
  });

  assert.equal(response.ok, true);
  assert.notEqual(response.state.selectedProfileId, "profile-a");
  assert.equal(response.selectedPassword, "typed-secret");
  assert.equal(response.state.proxyProfiles.length, 2);
  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "saved-secret");
});
