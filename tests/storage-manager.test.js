const assert = require("node:assert/strict");
const test = require("node:test");

const { createChromeMock, createRuntimeContext } = require("./helpers/load-extension-scripts.js");

function createStorage(local = {}, session = {}) {
  const chrome = createChromeMock({ local, session });
  const context = createRuntimeContext({ chrome });
  return { chrome, storage: context.ProxyStorage };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("saveConnection stores the password locally and in the session for auto-reconnect", async () => {
  const { chrome, storage } = createStorage({ rememberPassword: true });
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };

  await storage.saveConnection({
    profile,
    password: "secret",
    parsedProxy: { scheme: "http", host: "proxy.example.com", port: 8080 },
  });

  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.savedPassword, "secret");
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.storage.session.data.sessionConnected, true);
  assert.equal(await storage.resolveSavedPassword(), "secret");
  assert.equal(chrome.storage.local.data.rememberPassword, undefined);
});

test("saveConnection without a password removes any previously saved password", async () => {
  const { chrome, storage } = createStorage({ savedPassword: "old-secret" });
  const profile = { scheme: "socks5", host: "127.0.0.1", port: 1080, username: "" };

  await storage.saveConnection({
    profile,
    password: "",
    parsedProxy: null,
  });

  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.session.data.sessionConnected, true);
});

test("saveConnection snapshots the connected proxy so profile switching cannot change auth", async () => {
  const { chrome, storage } = createStorage();
  const connectedProfile = { scheme: "http", host: "proxy-a.example.com", port: 8080, username: "user" };

  await storage.saveConnection({
    profile: connectedProfile,
    password: "secret",
    parsedProxy: null,
  });

  assert.deepEqual(plain(chrome.storage.local.data.activeProxy), connectedProfile);

  // Simulate the user selecting another profile in the popup without reconnecting.
  await storage.setLocal({
    proxyProfile: { scheme: "http", host: "proxy-b.example.com", port: 9090, username: "user" },
  });

  const authState = await storage.getAuthState();
  assert.equal(authState.proxyAuth.host, "proxy-a.example.com");
  assert.equal(authState.proxyAuth.port, 8080);
});

test("setDisconnected clears the connected proxy snapshot", async () => {
  const { chrome, storage } = createStorage(
    {
      active: true,
      activeProxy: { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" },
    },
    { sessionConnected: true, sessionPassword: "secret" },
  );

  await storage.setDisconnected();

  assert.equal(chrome.storage.local.data.activeProxy, undefined);
});

test("getAuthState requires active local state and active session state", async () => {
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };
  const { storage } = createStorage(
    {
      active: true,
      proxyProfile: profile,
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  assert.deepEqual(plain(await storage.getAuthState()), {
    active: true,
    proxyAuth: {
      username: "user",
      password: "secret",
      host: "proxy.example.com",
      port: 8080,
      scheme: "http",
    },
    sessionConnected: true,
  });
});

test("setDisconnected clears the session but keeps the saved password for reconnecting", async () => {
  const { chrome, storage } = createStorage(
    {
      active: true,
      savedPassword: "secret",
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  await storage.setDisconnected();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.savedPassword, "secret");
  assert.deepEqual(plain(chrome.storage.session.data), {});
});

test("forgetAllData removes local, session, and legacy secret keys", async () => {
  const { chrome, storage } = createStorage(
    {
      active: true,
      proxyProfile: { scheme: "http" },
      proxyUrl: "http://user:secret@example.com:8080",
      proxyAuth: { password: "secret" },
      savedPassword: "secret",
      directConnectList: "localhost",
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  await storage.forgetAllData();

  assert.deepEqual(plain(chrome.storage.local.data), {});
  assert.deepEqual(plain(chrome.storage.session.data), {});
});

test("cleanupLegacySecrets migrates legacy proxyUrl and removes legacy secret keys", async () => {
  const { chrome, storage } = createStorage({
    proxyUrl: "http://user:secret@example.com:8080",
    bypassList: "localhost, 127.0.0.1",
    proxyAuth: { password: "secret" },
    encryptedPassword: "ciphertext",
  });

  await storage.cleanupLegacySecrets();

  assert.deepEqual(plain(chrome.storage.local.data.proxyProfile), {
    scheme: "http",
    host: "example.com",
    port: 8080,
    username: "user",
  });
  assert.equal(chrome.storage.local.data.directConnectList, undefined);
  assert.equal(chrome.storage.local.data.bypassList, undefined);
  assert.equal(chrome.storage.local.data.proxyUrl, undefined);
  assert.equal(chrome.storage.local.data.proxyAuth, undefined);
  assert.equal(chrome.storage.local.data.encryptedPassword, undefined);
});

test("cleanupLegacySecrets migrates existing proxyProfile to a host-named profile", async () => {
  const { chrome, storage } = createStorage({
    proxyProfile: {
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
  });

  await storage.cleanupLegacySecrets();

  assert.deepEqual(plain(chrome.storage.local.data.proxyProfiles), [
    {
      id: "default",
      name: "proxy.example.com",
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
  ]);
  assert.equal(chrome.storage.local.data.selectedProfileId, "default");
});

test("cleanupLegacySecrets renames a migrated Default profile to its host", async () => {
  const { chrome, storage } = createStorage({
    proxyProfiles: [
      {
        id: "default",
        name: "Default",
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
      {
        id: "profile-work",
        name: "Work",
        scheme: "https",
        host: "work.example.com",
        port: 8443,
        username: "user",
      },
    ],
    proxyProfile: {
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
  });

  await storage.cleanupLegacySecrets();

  assert.equal(chrome.storage.local.data.proxyProfiles[0].name, "proxy.example.com");
  assert.equal(chrome.storage.local.data.proxyProfiles[1].name, "Work");
});

test("cleanupLegacySecrets keeps the Default name when the host name is already taken", async () => {
  const { chrome, storage } = createStorage({
    proxyProfiles: [
      {
        id: "default",
        name: "Default",
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
        username: "user",
      },
      {
        id: "profile-existing",
        name: "PROXY.example.com",
        scheme: "https",
        host: "proxy.example.com",
        port: 8443,
        username: "user",
      },
    ],
    proxyProfile: {
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
  });

  await storage.cleanupLegacySecrets();

  assert.equal(chrome.storage.local.data.proxyProfiles[0].name, "Default");
  assert.equal(chrome.storage.local.data.proxyProfiles[1].name, "PROXY.example.com");
});

test("saveProfile and deleteProfile manage named proxy profiles", async () => {
  const { chrome, storage } = createStorage();
  const profile = {
    scheme: "http",
    host: "proxy.example.com",
    port: 8080,
    username: "user",
  };

  const saved = await storage.saveProfile({ name: "Work", profile });
  assert.equal(saved.name, "Work");
  assert.equal(chrome.storage.local.data.selectedProfileId, saved.id);
  assert.equal(chrome.storage.local.data.proxyProfiles.length, 1);

  const updated = await storage.saveProfile({
    name: "Work",
    profile: {
      ...profile,
      port: 9090,
    },
  });
  assert.equal(updated.id, saved.id);
  assert.equal(chrome.storage.local.data.proxyProfiles.length, 1);
  assert.equal(chrome.storage.local.data.proxyProfiles[0].port, 9090);

  await storage.deleteProfile(saved.id);
  assert.deepEqual(plain(chrome.storage.local.data.proxyProfiles), []);
  assert.equal(chrome.storage.local.data.selectedProfileId, "");
});
