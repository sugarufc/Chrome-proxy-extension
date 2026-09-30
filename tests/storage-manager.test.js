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

test("saveConnection stores the saved profile password separately and in the active session", async () => {
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };
  const { chrome, storage } = createStorage({
    proxyProfiles: [{ id: "profile-a", name: "A", ...profile }],
    profilePasswords: { "profile-a": "old-secret", "profile-b": "other-secret" },
    rememberPassword: true,
  });

  await storage.saveConnection({
    profile,
    password: "secret",
    parsedProxy: { scheme: "http", host: "proxy.example.com", port: 8080 },
    profileId: "profile-a",
  });

  assert.equal(chrome.storage.local.data.active, true);
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "secret");
  assert.equal(chrome.storage.local.data.profilePasswords["profile-b"], "other-secret");
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
  assert.equal(chrome.storage.session.data.sessionConnected, true);
  assert.equal(await storage.getProfilePassword("profile-a"), "secret");
  assert.equal(chrome.storage.local.data.rememberPassword, undefined);
});

test("saveConnection without a password removes only that saved profile password", async () => {
  const profile = { scheme: "http", host: "127.0.0.1", port: 8080, username: "" };
  const { chrome, storage } = createStorage({
    proxyProfiles: [{ id: "profile-a", name: "A", ...profile }],
    profilePasswords: { "profile-a": "old-secret", "profile-b": "other-secret" },
  });

  await storage.saveConnection({
    profile,
    password: "",
    parsedProxy: null,
    profileId: "profile-a",
  });

  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], undefined);
  assert.equal(chrome.storage.local.data.profilePasswords["profile-b"], "other-secret");
  assert.equal(chrome.storage.session.data.sessionConnected, true);
});

test("connecting to a different proxy never overwrites the selected profile's password", async () => {
  const saved = { scheme: "http", host: "saved.example.com", port: 8080, username: "saved-user" };
  const { chrome, storage } = createStorage({
    proxyProfiles: [{ id: "profile-a", name: "Saved", ...saved }],
    selectedProfileId: "profile-a",
    profilePasswords: { "profile-a": "saved-secret" },
  });
  const other = { scheme: "http", host: "other.example.com", port: 9090, username: "other-user" };

  await storage.saveConnection({ profile: other, password: "other-secret", parsedProxy: null, profileId: "profile-a" });

  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "saved-secret");
  const created = chrome.storage.local.data.proxyProfiles.find((item) => item.host === "other.example.com");
  assert.ok(created);
  assert.equal(chrome.storage.local.data.activeProfileId, created.id);
  assert.equal(chrome.storage.local.data.selectedProfileId, created.id);
  assert.equal(chrome.storage.local.data.profilePasswords[created.id], "other-secret");
  assert.deepEqual(plain(chrome.storage.local.data.proxyProfile), other);
  assert.equal(chrome.storage.session.data.sessionPassword, "other-secret");
});

test("a connection to an unknown proxy is saved as a host-named profile", async () => {
  const { chrome, storage } = createStorage();
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };

  await storage.saveConnection({ profile, password: "secret", parsedProxy: null, profileId: "" });

  const [saved] = chrome.storage.local.data.proxyProfiles;
  assert.equal(saved.name, "proxy.example.com");
  assert.equal(chrome.storage.local.data.selectedProfileId, saved.id);
  assert.equal(chrome.storage.local.data.activeProfileId, saved.id);
  assert.equal(chrome.storage.local.data.profilePasswords[saved.id], "secret");
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(chrome.storage.session.data.sessionPassword, "secret");
});

test("reconnecting a known proxy reuses its profile instead of adding a duplicate", async () => {
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };
  const { chrome, storage } = createStorage({
    proxyProfiles: [{ id: "profile-a", name: "Work", ...profile }],
    selectedProfileId: "",
  });

  await storage.saveConnection({ profile, password: "secret", parsedProxy: null, profileId: "" });

  assert.equal(chrome.storage.local.data.proxyProfiles.length, 1);
  assert.equal(chrome.storage.local.data.activeProfileId, "profile-a");
  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "secret");
});

test("renameProfile renames without touching other profiles and avoids duplicate names", async () => {
  const { storage } = createStorage();
  const first = await storage.saveProfile({
    name: "One",
    profile: { scheme: "http", host: "one.example.com", port: 8080, username: "" },
  });
  await storage.saveProfile({
    name: "Two",
    profile: { scheme: "http", host: "two.example.com", port: 8080, username: "" },
  });

  assert.equal((await storage.renameProfile(first.id, "  Home  ")).name, "Home");
  assert.equal((await storage.renameProfile(first.id, "two")).name, "two-2");
  assert.equal((await storage.renameProfile(first.id, "two-2")).name, "two-2");
  await assert.rejects(() => storage.renameProfile(first.id, "   "), /name is required/i);
  await assert.rejects(() => storage.renameProfile("missing", "x"), /not found/);
  assert.deepEqual(plain((await storage.getProfiles()).map((profile) => profile.name)), ["two-2", "Two"]);
});

test("setSettings stores only known boolean settings", async () => {
  const { chrome, storage } = createStorage();

  await storage.setSettings({ blockOnFailure: true, webRtcProtection: "yes", other: true });

  assert.equal(chrome.storage.local.data.blockOnFailure, true);
  assert.equal(chrome.storage.local.data.webRtcProtection, undefined);
  assert.equal(chrome.storage.local.data.other, undefined);
});

test("cleanup removes SOCKS5 profiles and disconnects an active SOCKS5 proxy", async () => {
  const httpProfile = {
    id: "http-profile",
    name: "HTTPS proxy",
    scheme: "https",
    host: "proxy.example.com",
    port: 443,
    username: "user",
  };
  const socksProfile = {
    id: "socks-profile",
    name: "Legacy SOCKS",
    scheme: "socks5",
    host: "127.0.0.1",
    port: 1080,
    username: "user",
  };
  const { chrome, storage } = createStorage(
    {
      active: true,
      proxyProfiles: [socksProfile, httpProfile],
      selectedProfileId: "socks-profile",
      activeProfileId: "socks-profile",
      proxyProfile: socksProfile,
      activeProxy: socksProfile,
      parsedProxy: { scheme: "socks5", host: "127.0.0.1", port: 1080 },
      savedPassword: "secret",
      profilePasswords: {
        "socks-profile": "legacy-socks-secret",
        "http-profile": "http-secret",
      },
      lastProxyError: "old error",
      lastError: "old error",
    },
    { sessionConnected: true, sessionPassword: "secret" },
  );

  const result = await storage.cleanupLegacySecrets();

  assert.deepEqual(plain(chrome.storage.local.data.proxyProfiles), [httpProfile]);
  assert.equal(chrome.storage.local.data.selectedProfileId, "http-profile");
  assert.equal(chrome.storage.local.data.proxyProfile.scheme, "https");
  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.activeProfileId, "");
  assert.equal(chrome.storage.local.data.activeProxy, undefined);
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.deepEqual(plain(chrome.storage.local.data.profilePasswords), {
    "http-profile": "http-secret",
  });
  assert.equal(chrome.storage.local.data.parsedProxy, undefined);
  assert.equal(chrome.storage.local.data.lastError, "");
  assert.equal(chrome.storage.local.data.lastProxyError, undefined);
  assert.deepEqual(plain(chrome.storage.session.data), {});
  assert.deepEqual(plain(result), { removedActiveProxy: true });
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
    blocked: false,
  });
});

test("setDisconnected clears the session but keeps per-profile passwords", async () => {
  const { chrome, storage } = createStorage(
    {
      active: true,
      profilePasswords: { "profile-a": "secret" },
    },
    {
      sessionConnected: true,
      sessionPassword: "secret",
    },
  );

  await storage.setDisconnected();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.profilePasswords["profile-a"], "secret");
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
      profilePasswords: { "profile-a": "profile-secret" },
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

test("saveProfile and deleteProfile manage named proxy profiles and their passwords", async () => {
  const { chrome, storage } = createStorage();
  const profile = {
    scheme: "http",
    host: "proxy.example.com",
    port: 8080,
    username: "user",
  };

  const saved = await storage.saveProfile({ name: "Work", profile, password: "first-secret" });
  assert.equal(saved.name, "Work");
  assert.equal(chrome.storage.local.data.selectedProfileId, saved.id);
  assert.equal(chrome.storage.local.data.proxyProfiles.length, 1);
  assert.equal(await storage.getProfilePassword(saved.id), "first-secret");

  const updated = await storage.saveProfile({
    name: "Work",
    profileId: saved.id,
    password: "updated-secret",
    profile: {
      ...profile,
      port: 9090,
    },
  });
  assert.equal(updated.id, saved.id);
  assert.equal(chrome.storage.local.data.proxyProfiles.length, 1);
  assert.equal(chrome.storage.local.data.proxyProfiles[0].port, 9090);
  assert.equal(await storage.getProfilePassword(saved.id), "updated-secret");

  await storage.deleteProfile(saved.id);
  assert.deepEqual(plain(chrome.storage.local.data.proxyProfiles), []);
  assert.equal(chrome.storage.local.data.selectedProfileId, "");
  assert.equal(await storage.getProfilePassword(saved.id), "");
});

test("different profiles retain different passwords", async () => {
  const { storage } = createStorage();
  const first = await storage.saveProfile({
    name: "First",
    profile: { scheme: "http", host: "first.example.com", port: 8080, username: "first-user" },
    password: "first-secret",
  });
  const second = await storage.saveProfile({
    name: "Second",
    profile: { scheme: "https", host: "second.example.com", port: 443, username: "second-user" },
    password: "second-secret",
  });

  assert.equal(await storage.getProfilePassword(first.id), "first-secret");
  assert.equal(await storage.getProfilePassword(second.id), "second-secret");
});

test("saveProfile adds numeric suffixes when a host name belongs to another proxy", async () => {
  const { storage } = createStorage();

  const first = await storage.saveProfile({
    name: "proxy.example.com",
    profile: { scheme: "http", host: "proxy.example.com", port: 8080, username: "first-user" },
    password: "first-secret",
  });
  const second = await storage.saveProfile({
    name: "proxy.example.com",
    profile: { scheme: "https", host: "proxy.example.com", port: 443, username: "second-user" },
    password: "second-secret",
  });
  const third = await storage.saveProfile({
    name: "proxy.example.com",
    profile: { scheme: "http", host: "proxy.example.com", port: 3128, username: "third-user" },
    password: "third-secret",
  });

  assert.equal(first.name, "proxy.example.com");
  assert.equal(second.name, "proxy.example.com-2");
  assert.equal(third.name, "proxy.example.com-3");
});

test("saveProfile updates the explicitly selected profile without renaming it", async () => {
  const { storage } = createStorage();
  const saved = await storage.saveProfile({
    name: "Original name",
    profile: { scheme: "http", host: "old.example.com", port: 8080, username: "user" },
    password: "old-secret",
  });

  const updated = await storage.saveProfile({
    name: "new.example.com",
    profileId: saved.id,
    profile: { scheme: "https", host: "new.example.com", port: 443, username: "new-user" },
    password: "new-secret",
  });

  assert.equal(updated.id, saved.id);
  assert.equal(updated.name, "Original name");
  assert.equal((await storage.getProfiles()).length, 1);
  assert.equal(updated.host, "new.example.com");
  assert.equal(await storage.getProfilePassword(saved.id), "new-secret");
});

test("legacy saved password migrates to the active profile id", async () => {
  const profileA = {
    id: "profile-a",
    name: "A",
    scheme: "http",
    host: "a.example.com",
    port: 8080,
    username: "user-a",
  };
  const profileB = { ...profileA, id: "profile-b", name: "B", host: "b.example.com" };
  const { chrome, storage } = createStorage({
    savedPassword: "legacy-secret",
    activeProfileId: "profile-a",
    proxyProfiles: [profileA, profileB],
  });

  await storage.cleanupLegacySecrets();

  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.equal(await storage.getProfilePassword("profile-a"), "legacy-secret");
  assert.equal(await storage.getProfilePassword("profile-b"), "");
});

test("legacy saved password migrates by one exact active proxy match", async () => {
  const profileA = {
    id: "profile-a",
    name: "A",
    scheme: "http",
    host: "a.example.com",
    port: 8080,
    username: "user-a",
  };
  const profileB = { ...profileA, id: "profile-b", name: "B", host: "b.example.com" };
  const { storage } = createStorage({
    savedPassword: "legacy-secret",
    activeProxy: { scheme: "http", host: "a.example.com", port: 8080, username: "user-a" },
    proxyProfiles: [profileA, profileB],
  });

  await storage.cleanupLegacySecrets();

  assert.equal(await storage.getProfilePassword("profile-a"), "legacy-secret");
  assert.equal(await storage.getProfilePassword("profile-b"), "");
});

test("ambiguous legacy proxy match drops the global password", async () => {
  const shared = { scheme: "http", host: "same.example.com", port: 8080, username: "user" };
  const { chrome, storage } = createStorage({
    savedPassword: "legacy-secret",
    activeProxy: shared,
    proxyProfiles: [
      { id: "profile-a", name: "A", ...shared },
      { id: "profile-b", name: "B", ...shared },
    ],
  });

  await storage.cleanupLegacySecrets();

  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.deepEqual(plain(chrome.storage.local.data.profilePasswords || {}), {});
});

test("migrateStorage applies legacy cleanup once for the current schema version", async () => {
  const { chrome, storage } = createStorage({
    proxyUrl: "http://user:secret@example.com:8080",
    savedPassword: "secret",
  });

  const firstResult = await storage.migrateStorage();
  const writesAfterFirstRun = chrome.storage.local.setCalls.length + chrome.storage.local.removeCalls.length;
  const secondResult = await storage.migrateStorage();

  assert.equal(firstResult.migrated, true);
  assert.equal(secondResult.migrated, false);
  assert.equal(chrome.storage.local.data.schemaVersion, 1);
  assert.equal(chrome.storage.local.setCalls.length + chrome.storage.local.removeCalls.length, writesAfterFirstRun);
});
