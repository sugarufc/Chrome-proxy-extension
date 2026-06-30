(function initProxyStorageManager() {
  "use strict";

  const SESSION_PASSWORD_KEY = "sessionPassword";
  const SESSION_CONNECTED_KEY = "sessionConnected";
  const LOCAL_PASSWORD_KEY = "savedPassword";
  const LOCAL_KEYS = [
    "disclaimerAccepted",
    "active",
    "rememberPassword",
    "proxyProfile",
    LOCAL_PASSWORD_KEY,
    "directConnectList",
    "parsedProxy",
    "lastError",
    "lastProxyError",
  ];
  const LEGACY_SECRET_KEYS = [
    "proxyUrl",
    "proxyAuth",
    "encryptionKey",
    "bypassList",
    "encryptedPassword",
    "encryptionSalt",
    "pinVerifier",
  ];

  function getLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, resolve);
    });
  }

  function setLocal(values) {
    return new Promise((resolve) => {
      chrome.storage.local.set(values, resolve);
    });
  }

  function removeLocal(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.remove(keys, resolve);
    });
  }

  function getSession(keys) {
    return new Promise((resolve) => {
      chrome.storage.session.get(keys, resolve);
    });
  }

  function setSession(values) {
    return new Promise((resolve) => {
      chrome.storage.session.set(values, resolve);
    });
  }

  function clearSession() {
    return new Promise((resolve) => {
      chrome.storage.session.clear(resolve);
    });
  }

  function buildProxyAuth(profile, password) {
    if (!profile || !profile.username || !password) {
      return null;
    }

    return {
      username: profile.username,
      password,
      host: profile.host,
      port: profile.port,
      scheme: profile.scheme,
    };
  }

  async function configureTrustedStorageAccess() {
    if (!chrome.storage.local.setAccessLevel) {
      return;
    }

    await Promise.all([
      new Promise((resolve) => {
        chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, resolve);
      }),
      new Promise((resolve) => {
        if (chrome.storage.session && chrome.storage.session.setAccessLevel) {
          chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }, resolve);
          return;
        }
        resolve();
      }),
    ]);
  }

  async function saveConnection({ profile, password, rememberPassword, directConnectList, parsedProxy }) {
    const localPayload = {
      active: true,
      rememberPassword: Boolean(rememberPassword),
      proxyProfile: profile,
      directConnectList,
      parsedProxy,
      lastError: "",
      lastProxyError: "",
    };

    if (rememberPassword && password) {
      localPayload[LOCAL_PASSWORD_KEY] = password;
    } else {
      await removeLocal([LOCAL_PASSWORD_KEY]);
    }

    await removeLocal(LEGACY_SECRET_KEYS.filter((key) => key !== "bypassList"));
    await setLocal(localPayload);

    await setSession({
      [SESSION_PASSWORD_KEY]: password || "",
      [SESSION_CONNECTED_KEY]: true,
    });
  }

  async function resolveSessionPassword() {
    const sessionState = await getSession([SESSION_PASSWORD_KEY]);
    return sessionState[SESSION_PASSWORD_KEY] || "";
  }

  async function resolveSavedPassword() {
    const state = await getLocal(["rememberPassword", LOCAL_PASSWORD_KEY]);
    if (!state.rememberPassword || !state[LOCAL_PASSWORD_KEY]) {
      return "";
    }
    return state[LOCAL_PASSWORD_KEY];
  }

  async function isSessionConnected() {
    const sessionState = await getSession([SESSION_CONNECTED_KEY]);
    return Boolean(sessionState[SESSION_CONNECTED_KEY]);
  }

  async function getAuthState() {
    const state = await getLocal(["active", "proxyProfile"]);
    const sessionConnected = await isSessionConnected();
    const password = sessionConnected ? await resolveSessionPassword() : "";
    const active = Boolean(state.active && sessionConnected);

    return {
      active,
      proxyAuth: buildProxyAuth(state.proxyProfile, password),
      sessionConnected,
    };
  }

  async function getFullState() {
    return getLocal(LOCAL_KEYS);
  }

  async function acceptDisclaimer() {
    await setLocal({ disclaimerAccepted: true });
  }

  async function setDisconnected() {
    const { rememberPassword } = await getLocal(["rememberPassword"]);
    await clearSession();
    await setLocal({
      active: false,
      lastError: "",
      lastProxyError: "",
    });

    if (!rememberPassword) {
      await removeLocal([LOCAL_PASSWORD_KEY]);
    }
  }

  async function forgetAllData() {
    await clearSession();
    await removeLocal([...LOCAL_KEYS, ...LEGACY_SECRET_KEYS]);
  }

  async function cleanupLegacySecrets() {
    const state = await getLocal(["proxyProfile", "proxyUrl", "bypassList"]);

    if (!state.proxyProfile && state.proxyUrl) {
      try {
        const parsed = ProxyShared.parseProxyUrl(state.proxyUrl);
        await setLocal({
          proxyProfile: {
            scheme: parsed.scheme,
            host: parsed.host,
            port: parsed.port,
            username: parsed.username || "",
          },
          directConnectList: state.bypassList || ProxyShared.DEFAULT_DIRECT_CONNECT_LIST,
        });
      } catch (error) {
        // Skip invalid legacy URL values.
      }
    }

    await removeLocal(LEGACY_SECRET_KEYS);
  }

  globalThis.ProxyStorage = {
    LOCAL_KEYS,
    LOCAL_PASSWORD_KEY,
    SESSION_PASSWORD_KEY,
    SESSION_CONNECTED_KEY,
    buildProxyAuth,
    configureTrustedStorageAccess,
    saveConnection,
    resolveSessionPassword,
    resolveSavedPassword,
    isSessionConnected,
    getAuthState,
    getFullState,
    acceptDisclaimer,
    setDisconnected,
    forgetAllData,
    cleanupLegacySecrets,
    getLocal,
    setLocal,
    removeLocal,
    getSession,
    setSession,
    clearSession,
  };
})();
