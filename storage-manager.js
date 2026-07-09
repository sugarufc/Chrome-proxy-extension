(function initProxyStorageManager() {
  "use strict";

  const SESSION_PASSWORD_KEY = "sessionPassword";
  const SESSION_CONNECTED_KEY = "sessionConnected";
  const LOCAL_PASSWORD_KEY = "savedPassword";
  const PROFILES_KEY = "proxyProfiles";
  const SELECTED_PROFILE_ID_KEY = "selectedProfileId";
  const ACTIVE_PROFILE_ID_KEY = "activeProfileId";
  const ACTIVE_PROXY_KEY = "activeProxy";
  const LOCAL_KEYS = [
    "disclaimerAccepted",
    "active",
    "rememberPassword",
    "proxyProfile",
    ACTIVE_PROXY_KEY,
    PROFILES_KEY,
    SELECTED_PROFILE_ID_KEY,
    ACTIVE_PROFILE_ID_KEY,
    LOCAL_PASSWORD_KEY,
    "parsedProxy",
    "lastError",
    "lastProxyError",
  ];
  const LEGACY_SECRET_KEYS = [
    "proxyUrl",
    "proxyAuth",
    "encryptionKey",
    "bypassList",
    "directConnectList",
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

  function profileFields(profile) {
    const normalized = ProxyShared.buildProfileFromFields(profile || {});

    return {
      scheme: normalized.scheme,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username || "",
    };
  }

  function profileFromRecord(record) {
    if (!record) {
      return null;
    }

    return profileFields(record);
  }

  function makeProfileId() {
    return `profile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeProfileName(name) {
    const normalized = String(name || "").trim();
    if (!normalized) {
      throw new Error("Profile name is required.");
    }
    return normalized.slice(0, 80);
  }

  async function getProfiles() {
    const state = await getLocal([PROFILES_KEY]);
    return Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
  }

  async function migrateProxyProfileToProfiles() {
    const state = await getLocal(["proxyProfile", PROFILES_KEY, SELECTED_PROFILE_ID_KEY]);
    if (!state.proxyProfile || (Array.isArray(state[PROFILES_KEY]) && state[PROFILES_KEY].length > 0)) {
      return;
    }

    const defaultProfile = {
      id: "default",
      name: "Default",
      ...profileFields(state.proxyProfile),
    };

    await setLocal({
      [PROFILES_KEY]: [defaultProfile],
      [SELECTED_PROFILE_ID_KEY]: state[SELECTED_PROFILE_ID_KEY] || defaultProfile.id,
    });
  }

  async function saveProfile({ name, profile }) {
    const profileName = normalizeProfileName(name);
    const profilePayload = profileFields(profile);
    const profiles = await getProfiles();
    const existingIndex = profiles.findIndex((item) => item.name.toLowerCase() === profileName.toLowerCase());
    const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
    const savedProfile = {
      id: existing ? existing.id : makeProfileId(),
      name: profileName,
      ...profilePayload,
    };

    if (existingIndex >= 0) {
      profiles[existingIndex] = savedProfile;
    } else {
      profiles.push(savedProfile);
    }

    await setLocal({
      [PROFILES_KEY]: profiles,
      [SELECTED_PROFILE_ID_KEY]: savedProfile.id,
      proxyProfile: profilePayload,
      lastError: "",
    });

    return savedProfile;
  }

  async function deleteProfile(profileId) {
    const id = String(profileId || "");
    const state = await getLocal([PROFILES_KEY, SELECTED_PROFILE_ID_KEY, ACTIVE_PROFILE_ID_KEY]);
    const profiles = Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
    const nextProfiles = profiles.filter((profile) => profile.id !== id);
    const selectedProfileId =
      state[SELECTED_PROFILE_ID_KEY] === id ? nextProfiles[0]?.id || "" : state[SELECTED_PROFILE_ID_KEY] || "";
    const selectedProfile = nextProfiles.find((profile) => profile.id === selectedProfileId);
    const nextState = {
      [PROFILES_KEY]: nextProfiles,
      [SELECTED_PROFILE_ID_KEY]: selectedProfileId,
    };

    if (state[ACTIVE_PROFILE_ID_KEY] === id) {
      nextState[ACTIVE_PROFILE_ID_KEY] = "";
    }

    if (selectedProfile) {
      nextState.proxyProfile = profileFromRecord(selectedProfile);
    }

    await setLocal(nextState);
    return selectedProfile || null;
  }

  async function selectProfile(profileId) {
    const id = String(profileId || "");
    if (!id) {
      await setLocal({ [SELECTED_PROFILE_ID_KEY]: "" });
      return null;
    }

    const profiles = await getProfiles();
    const selectedProfile = profiles.find((profile) => profile.id === id);
    if (!selectedProfile) {
      throw new Error("Selected profile was not found.");
    }

    await setLocal({
      [SELECTED_PROFILE_ID_KEY]: id,
      proxyProfile: profileFromRecord(selectedProfile),
      lastError: "",
    });

    return selectedProfile;
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

  async function saveConnection({ profile, password, rememberPassword, parsedProxy, profileId }) {
    const localPayload = {
      active: true,
      rememberPassword: Boolean(rememberPassword),
      proxyProfile: profile,
      // Snapshot of the connected proxy. Auth challenges and session restore must keep
      // using this even if the user switches or edits profiles without reconnecting.
      [ACTIVE_PROXY_KEY]: profile,
      [ACTIVE_PROFILE_ID_KEY]: profileId || "",
      parsedProxy,
      lastError: "",
      lastProxyError: "",
    };

    if (profileId) {
      localPayload[SELECTED_PROFILE_ID_KEY] = profileId;
    }

    if (rememberPassword && password) {
      localPayload[LOCAL_PASSWORD_KEY] = password;
    } else {
      await removeLocal([LOCAL_PASSWORD_KEY]);
    }

    await removeLocal(LEGACY_SECRET_KEYS);
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
    const state = await getLocal(["active", "proxyProfile", ACTIVE_PROXY_KEY]);
    const sessionConnected = await isSessionConnected();
    const password = sessionConnected ? await resolveSessionPassword() : "";
    const active = Boolean(state.active && sessionConnected);
    const connectedProfile = state[ACTIVE_PROXY_KEY] || state.proxyProfile;

    return {
      active,
      proxyAuth: buildProxyAuth(connectedProfile, password),
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

    await removeLocal(rememberPassword ? [ACTIVE_PROXY_KEY] : [ACTIVE_PROXY_KEY, LOCAL_PASSWORD_KEY]);
  }

  async function forgetAllData() {
    await clearSession();
    await removeLocal([...LOCAL_KEYS, ...LEGACY_SECRET_KEYS]);
  }

  async function cleanupLegacySecrets() {
    const state = await getLocal(["proxyProfile", "proxyUrl"]);

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
        });
      } catch (_error) {
        // Skip invalid legacy URL values.
      }
    }

    await migrateProxyProfileToProfiles();
    await removeLocal(LEGACY_SECRET_KEYS);
  }

  globalThis.ProxyStorage = {
    LOCAL_KEYS,
    LOCAL_PASSWORD_KEY,
    SESSION_PASSWORD_KEY,
    SESSION_CONNECTED_KEY,
    PROFILES_KEY,
    SELECTED_PROFILE_ID_KEY,
    ACTIVE_PROFILE_ID_KEY,
    ACTIVE_PROXY_KEY,
    buildProxyAuth,
    getProfiles,
    saveProfile,
    deleteProfile,
    selectProfile,
    migrateProxyProfileToProfiles,
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
