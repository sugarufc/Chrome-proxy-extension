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

test("saveConnection stores password in session by default and not in local storage", async () => {
  const { chrome, storage } = createStorage();
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };

  await storage.saveConnection({
    profile,
    password: "secret",
    rememberPassword: false,
    directConnectList: "localhost, 127.0.0.1, <local>",
    parsedProxy: { scheme: "http", host: "proxy.example.com", port: 8080 },
  });

  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.storage.session.data.sessionConnected, true);
});

test("saveConnection stores remembered password locally only when requested", async () => {
  const { chrome, storage } = createStorage();
  const profile = { scheme: "https", host: "proxy.example.com", port: 8443, username: "user" };

  await storage.saveConnection({
    profile,
    password: "secret",
    rememberPassword: true,
    directConnectList: "localhost",
    parsedProxy: null,
  });

  assert.equal(chrome.storage.local.data.rememberPassword, true);
  assert.equal(chrome.storage.local.data.savedPassword, "secret");
  assert.equal(await storage.resolveSavedPassword(), "secret");
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

test("setDisconnected clears session and removes local password unless rememberPassword is enabled", async () => {
  const { chrome, storage } = createStorage(
    {
      active: true,
      rememberPassword: false,
      savedPassword: "secret",
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  await storage.setDisconnected();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.deepEqual(plain(chrome.storage.session.data), {});
});

test("setDisconnected keeps local password when rememberPassword is enabled", async () => {
  const { chrome, storage } = createStorage({
    active: true,
    rememberPassword: true,
    savedPassword: "secret",
  });

  await storage.setDisconnected();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.savedPassword, "secret");
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
  assert.equal(chrome.storage.local.data.directConnectList, "localhost, 127.0.0.1");
  assert.equal(chrome.storage.local.data.proxyUrl, undefined);
  assert.equal(chrome.storage.local.data.proxyAuth, undefined);
  assert.equal(chrome.storage.local.data.encryptedPassword, undefined);
});

test("cleanupLegacySecrets migrates existing proxyProfile to Default profile", async () => {
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
      name: "Default",
      scheme: "http",
      host: "proxy.example.com",
      port: 8080,
      username: "user",
    },
  ]);
  assert.equal(chrome.storage.local.data.selectedProfileId, "default");
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
