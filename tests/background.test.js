const assert = require("node:assert/strict");
const test = require("node:test");

const { loadBackground } = require("./helpers/load-extension-scripts.js");

const plain = (value) => JSON.parse(JSON.stringify(value));
const names = (chrome) => chrome.calls.map((call) => call.name);
const proxy = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user", password: "secret" };
const challenge = (requestId, port = 8080) => ({ requestId, isProxy: true, challenger: { host: "1.2.3.4", port } });

test("connect parses the pasted proxy, applies it and remembers it", async () => {
  const { chrome, send } = loadBackground({ local: { disclaimerAccepted: true } });

  const response = await send({ command: "connect", input: "http://user:secret@proxy.example.com:8080" });

  assert.equal(response.ok, true);
  assert.equal(response.status.active, true);
  assert.equal(response.status.label, "http://proxy.example.com:8080");
  assert.deepEqual(plain(chrome.storage.local.data.proxy), proxy);
  assert.equal(chrome.storage.local.data.active, true);
  assert.deepEqual(plain(chrome.calls[0].details.value.rules), {
    singleProxy: { scheme: "http", host: "proxy.example.com", port: 8080 },
    bypassList: ["localhost", "127.0.0.1", "<local>"],
  });
  assert.equal(chrome.calls[0].details.scope, "regular");
  assert.equal(chrome.action.icons.at(-1), "icons/icon16-on.png");
});

test("connect rejects bad input without touching Chrome settings", async () => {
  const { chrome, send } = loadBackground();

  for (const input of ["", "socks5://127.0.0.1:1080", "http://user@host:8080", "host"]) {
    const response = await send({ command: "connect", input });
    assert.equal(response.ok, false, input);
  }

  assert.deepEqual(chrome.calls, []);
  assert.equal(chrome.storage.local.data.active, undefined);
});

test("connect turns everything off and reports the reason when Chrome refuses the settings", async () => {
  const failing = loadBackground({ setError: "Proxy settings are unavailable." });
  const response = await failing.send({ command: "connect", input: "proxy.example.com:8080" });

  assert.equal(response.ok, false);
  assert.equal(response.error, "Proxy settings are unavailable.");
  assert.equal(failing.chrome.storage.local.data.active, false);
  assert.equal(failing.chrome.storage.local.data.lastError, "Proxy settings are unavailable.");
  assert.ok(names(failing.chrome).includes("clear"));
  assert.equal(failing.chrome.action.icons.at(-1), "icons/icon16.png");

  const other = loadBackground({ levelOfControl: "controlled_by_other_extensions" });
  const blocked = await other.send({ command: "connect", input: "proxy.example.com:8080" });
  assert.match(blocked.error, /Another extension or a policy/);
  assert.equal(other.chrome.storage.local.data.active, false);
});

test("disconnect clears the proxy but keeps it saved for the next time", async () => {
  const { chrome, send } = loadBackground({ local: { active: true, proxy } });

  const response = await send({ command: "disconnect" });

  assert.equal(response.status.active, false);
  assert.equal(response.status.input, "http://user:secret@proxy.example.com:8080");
  assert.deepEqual(names(chrome), ["clear"]);
  assert.equal(chrome.action.icons.at(-1), "icons/icon16.png");
});

test("forget removes the proxy, the password and the accepted disclaimer", async () => {
  const { chrome, send } = loadBackground({ local: { disclaimerAccepted: true, active: true, proxy } });

  const response = await send({ command: "forget" });

  assert.deepEqual(plain(chrome.storage.local.data), {});
  assert.equal(response.status.accepted, false);
  assert.equal(response.status.input, "");
  assert.ok(names(chrome).includes("clear"));
});

test("status shows the saved proxy string and a stored error while off", async () => {
  const { send } = loadBackground({ local: { disclaimerAccepted: true, proxy, lastError: "Something failed." } });

  const { status } = await send({ command: "getStatus" });

  assert.deepEqual(plain(status), {
    accepted: true,
    active: false,
    label: "http://proxy.example.com:8080",
    input: "http://user:secret@proxy.example.com:8080",
    error: "Something failed.",
  });
  assert.equal((await send({ command: "nope" })).ok, false);
});

test("acceptDisclaimer is remembered", async () => {
  const { chrome, send } = loadBackground();

  const response = await send({ command: "acceptDisclaimer" });

  assert.equal(response.status.accepted, true);
  assert.equal(chrome.storage.local.data.disclaimerAccepted, true);
});

test("commands run one at a time", async () => {
  const { chrome, send } = loadBackground();

  const responses = await Promise.all([
    send({ command: "connect", input: "a.example.com:1" }),
    send({ command: "disconnect" }),
    send({ command: "connect", input: "b.example.com:2" }),
  ]);

  assert.deepEqual(
    responses.map((response) => response.ok),
    [true, true, true],
  );
  assert.deepEqual(names(chrome), ["set", "get", "clear", "set", "get"]);
  assert.equal(chrome.storage.local.data.proxy.host, "b.example.com");
  assert.equal(chrome.storage.local.data.active, true);
});

test("a Chrome API that never answers fails the command after a timeout and frees the queue", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { send } = loadBackground({ hang: "set" });

  const pending = send({ command: "connect", input: "proxy.example.com:8080" });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(10_000);
  const response = await pending;

  assert.equal(response.ok, false);
  assert.match(response.error, /did not respond/);
  assert.equal((await send({ command: "getStatus" })).ok, true);
});

test("a successful connect or disconnect clears the error flag on the icon", async () => {
  const { chrome, send } = loadBackground({ local: { proxy, lastError: "Old failure." } });

  await send({ command: "connect", input: "proxy.example.com:8080" });
  assert.equal(chrome.action.badge.at(-1), "");
  await send({ command: "disconnect" });
  assert.equal(chrome.action.badge.at(-1), "");
  assert.equal(chrome.action.title.at(-1), "Proxy Switcher");
});

test("proxy auth answers only the configured proxy", async () => {
  const { auth } = loadBackground({ local: { active: true, proxy } });

  assert.deepEqual(plain(await auth(challenge("a"))), { authCredentials: { username: "user", password: "secret" } });
  // A website login, another port, or a proxy without credentials never gets the password.
  assert.deepEqual(plain(await auth({ ...challenge("b"), isProxy: false })), {});
  assert.deepEqual(plain(await auth(challenge("c", 9090))), {});
  assert.deepEqual(plain(await auth({ requestId: "d", isProxy: true })), {});
});

test("proxy auth does nothing once another extension or a policy controls the proxy", async () => {
  const { chrome, auth } = loadBackground({ local: { active: true, proxy } });
  chrome.proxy.levelOfControl = "controlled_by_other_extensions";

  assert.deepEqual(plain(await auth(challenge("a"))), {});
});

test("losing control of the proxy settings turns the proxy off and says why", async () => {
  const { chrome } = loadBackground({ local: { active: true, proxy } });
  const [{ listener: onChange }] = chrome.proxy.settings.onChange.listeners;

  await onChange({ levelOfControl: "controlled_by_this_extension" });
  assert.equal(chrome.storage.local.data.active, true);
  assert.deepEqual(chrome.calls, []);

  await onChange({ levelOfControl: "controlled_by_other_extensions" });
  assert.equal(chrome.storage.local.data.active, false);
  assert.match(chrome.storage.local.data.lastError, /took over/);
  assert.deepEqual(names(chrome), ["clear"]);
  assert.equal(chrome.action.icons.at(-1), "icons/icon16.png");
  assert.equal(chrome.action.badge.at(-1), "!");

  // Our own clear fires the event again; nothing more happens while the proxy is off.
  await onChange({ levelOfControl: "controllable_by_this_extension" });
  assert.deepEqual(names(chrome), ["clear"]);
});

test("proxy auth does nothing while the proxy is off or has no credentials", async () => {
  const off = loadBackground({ local: { active: false, proxy } });
  assert.deepEqual(plain(await off.auth(challenge("a"))), {});

  const open = loadBackground({ local: { active: true, proxy: { ...proxy, username: "", password: "" } } });
  assert.deepEqual(plain(await open.auth(challenge("a"))), {});
});

test("a rejected login turns the proxy off after two retries", async () => {
  const { chrome, auth } = loadBackground({ local: { active: true, proxy } });

  assert.ok((await auth(challenge("r"))).authCredentials);
  assert.ok((await auth(challenge("r"))).authCredentials);
  assert.deepEqual(plain(await auth(challenge("r"))), { cancel: true });

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.lastError, "Proxy authentication failed. Proxy turned off.");
  assert.ok(names(chrome).includes("clear"));
  assert.equal(chrome.action.badge.at(-1), "!");
  assert.equal(chrome.action.title.at(-1), "Proxy authentication failed. Proxy turned off.");
  // Other requests are no longer answered once the proxy is off.
  assert.deepEqual(plain(await auth(challenge("other"))), {});
});

test("many different requests never count as one rejected login", async () => {
  const { chrome, auth } = loadBackground({ local: { active: true, proxy } });

  for (let index = 0; index < 250; index += 1) {
    assert.ok((await auth(challenge(`request-${index}`))).authCredentials);
  }

  assert.equal(chrome.storage.local.data.active, true);
});

test("browser start re-applies a proxy that was on and clears one that was off", async () => {
  const on = loadBackground({ local: { active: true, proxy, lastError: "old" } });
  await on.fire("runtime.onStartup");
  assert.deepEqual(names(on.chrome), ["set", "get"]);
  assert.equal(on.chrome.storage.local.data.lastError, "");
  assert.equal(on.chrome.action.icons.at(-1), "icons/icon16-on.png");

  const off = loadBackground({ local: { active: false, proxy } });
  await off.fire("runtime.onStartup");
  assert.deepEqual(names(off.chrome), ["clear"]);
  assert.equal(off.chrome.action.icons.at(-1), "icons/icon16.png");
});

test("keyboard shortcut toggles the saved proxy and flags failures on the icon", async () => {
  const { chrome } = loadBackground({ local: { proxy } });
  const [{ listener }] = chrome.commands.onCommand.listeners;

  await listener("toggle-proxy");
  assert.equal(chrome.storage.local.data.active, true);
  await listener("toggle-proxy");
  assert.equal(chrome.storage.local.data.active, false);
  await listener("something-else");
  assert.equal(chrome.storage.local.data.active, false);

  const empty = loadBackground();
  await empty.chrome.commands.onCommand.listeners[0].listener("toggle-proxy");
  assert.deepEqual(empty.chrome.calls, []);

  const broken = loadBackground({ local: { proxy }, setError: "Not allowed." });
  await broken.chrome.commands.onCommand.listeners[0].listener("toggle-proxy");
  assert.equal(broken.chrome.action.badge.at(-1), "!");
  assert.equal(broken.chrome.action.title.at(-1), "Not allowed.");
});

test("update imports the proxy that was in use from the old profile storage", async () => {
  const profile = { id: "p1", name: "Work", scheme: "https", host: "old.example.com", port: 443, username: "me" };
  const { chrome } = loadBackground({
    local: {
      disclaimerAccepted: true,
      active: true,
      proxyProfiles: [profile],
      selectedProfileId: "p1",
      activeProfileId: "p1",
      activeProxy: profile,
      profilePasswords: { p1: "old-secret" },
      schemaVersion: 1,
    },
  });

  await chrome.runtime.onInstalled.listeners[0].listener();

  assert.deepEqual(plain(chrome.storage.local.data.proxy), {
    scheme: "https",
    host: "old.example.com",
    port: 443,
    username: "me",
    password: "old-secret",
  });
  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.proxyProfiles, undefined);
  assert.equal(chrome.storage.local.data.profilePasswords, undefined);
  assert.equal(chrome.storage.local.data.schemaVersion, undefined);
  assert.equal(chrome.storage.local.data.disclaimerAccepted, true);
  assert.equal(chrome.calls[0].details.value.rules.singleProxy.host, "old.example.com");
});

test("update never pairs the connected proxy with another profile's password", async () => {
  const connected = { scheme: "http", host: "connected.example.com", port: 8080, username: "me" };
  const { chrome } = loadBackground({
    local: {
      active: true,
      activeProxy: connected,
      activeProfileId: "",
      selectedProfileId: "other",
      profilePasswords: { other: "other-secret" },
    },
  });

  await chrome.runtime.onInstalled.listeners[0].listener();

  assert.equal(chrome.storage.local.data.proxy, undefined);
  assert.equal(chrome.storage.local.data.active, false);
});

test("update drops old proxies it cannot carry over and turns them off", async () => {
  const socks = { scheme: "socks5", host: "127.0.0.1", port: 1080, username: "" };
  const noPassword = { scheme: "http", host: "x.example.com", port: 80, username: "me" };
  const badPorts = [0, 70000, "abc", undefined].map((port) => ({ scheme: "http", host: "x.example.com", port }));
  const badHost = { scheme: "http", host: "bad host/path", port: 8080 };

  for (const activeProxy of [socks, noPassword, ...badPorts, badHost]) {
    const { chrome } = loadBackground({ local: { active: true, activeProxy, proxyProfile: activeProxy } });
    await chrome.runtime.onInstalled.listeners[0].listener();

    assert.equal(chrome.storage.local.data.proxy, undefined);
    assert.equal(chrome.storage.local.data.active, false);
    assert.deepEqual(names(chrome), ["clear"]);
  }
});
