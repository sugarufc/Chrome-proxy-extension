(function initProxyStorageManager() {
  "use strict";

  const CURRENT_SCHEMA_VERSION = 1;
  const SCHEMA_VERSION_KEY = "schemaVersion";
  const SESSION_PASSWORD_KEY = "sessionPassword";
  const SESSION_CONNECTED_KEY = "sessionConnected";
  const LOCAL_PASSWORD_KEY = "savedPassword";
  const PROFILES_KEY = "proxyProfiles";
  const PROFILE_PASSWORDS_KEY = "profilePasswords";
  const SELECTED_PROFILE_ID_KEY = "selectedProfileId";
  const ACTIVE_PROFILE_ID_KEY = "activeProfileId";
  const ACTIVE_PROXY_KEY = "activeProxy";
  const LOCAL_KEYS = [
    SCHEMA_VERSION_KEY,
    "disclaimerAccepted",
    "active",
    "proxyProfile",
    ACTIVE_PROXY_KEY,
    PROFILES_KEY,
    SELECTED_PROFILE_ID_KEY,
    ACTIVE_PROFILE_ID_KEY,
    PROFILE_PASSWORDS_KEY,
    LOCAL_PASSWORD_KEY,
    "parsedProxy",
    "lastError",
  ];
  // Keys written by older versions. They are dropped on every connect and on forget-all.
  const LEGACY_SECRET_KEYS = [
    "lastProxyError",
    "proxyUrl",
    "proxyAuth",
    "encryptionKey",
    "bypassList",
    "directConnectList",
    "rememberPassword",
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

  function deduplicateProfileName(profiles, requestedName) {
    let suffixNumber = 2;
    let candidate = requestedName;

    while (profiles.some((profile) => profile.name.toLowerCase() === candidate.toLowerCase())) {
      const suffix = `-${suffixNumber}`;
      candidate = `${requestedName.slice(0, 80 - suffix.length)}${suffix}`;
      suffixNumber += 1;
    }

    return candidate;
  }

  async function getProfiles() {
    const state = await getLocal([PROFILES_KEY]);
    return Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
  }

  async function getProfilePasswords() {
    const state = await getLocal([PROFILE_PASSWORDS_KEY]);
    const passwords = state[PROFILE_PASSWORDS_KEY];
    return passwords && typeof passwords === "object" && !Array.isArray(passwords) ? { ...passwords } : {};
  }

  async function getProfilePassword(profileId) {
    const passwords = await getProfilePasswords();
    return passwords[String(profileId || "")] || "";
  }

  async function setProfilePassword(profileId, password) {
    const id = String(profileId || "");
    if (!id) {
      return;
    }

    const passwords = await getProfilePasswords();
    if (password) {
      passwords[id] = String(password);
    } else {
      delete passwords[id];
    }
    await setLocal({ [PROFILE_PASSWORDS_KEY]: passwords });
  }

  function profilesMatch(left, right) {
    if (!left || !right) {
      return false;
    }
    return (
      String(left.scheme || "").toLowerCase() === String(right.scheme || "").toLowerCase() &&
      String(left.host || "").toLowerCase() === String(right.host || "").toLowerCase() &&
      Number(left.port) === Number(right.port) &&
      String(left.username || "") === String(right.username || "")
    );
  }

  // A connection is tied to a saved profile only when the connected proxy really is that
  // profile. Connecting to something else must never overwrite the profile's password.
  async function resolveConnectionProfileId(profile, profileId) {
    const state = await getLocal([PROFILES_KEY, SELECTED_PROFILE_ID_KEY]);
    const profiles = Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];

    for (const candidateId of [String(profileId || ""), String(state[SELECTED_PROFILE_ID_KEY] || "")]) {
      const candidate = candidateId && profiles.find((item) => item.id === candidateId);
      if (candidate && profilesMatch(candidate, profile)) {
        return candidate.id;
      }
    }

    return "";
  }

  async function migrateLegacySavedPassword() {
    const state = await getLocal([LOCAL_PASSWORD_KEY, ACTIVE_PROFILE_ID_KEY, ACTIVE_PROXY_KEY, PROFILES_KEY]);
    const legacyPassword = state[LOCAL_PASSWORD_KEY] || "";
    const profiles = Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
    let targetProfileId = "";

    if (legacyPassword) {
      const activeProfileId = String(state[ACTIVE_PROFILE_ID_KEY] || "");
      if (activeProfileId && profiles.some((profile) => profile.id === activeProfileId)) {
        targetProfileId = activeProfileId;
      } else if (state[ACTIVE_PROXY_KEY]) {
        const matches = profiles.filter((profile) => profilesMatch(profile, state[ACTIVE_PROXY_KEY]));
        if (matches.length === 1) {
          targetProfileId = matches[0].id;
        }
      }
    }

    if (targetProfileId) {
      await setProfilePassword(targetProfileId, legacyPassword);
    }
    await removeLocal([LOCAL_PASSWORD_KEY]);
    return targetProfileId;
  }

  async function migrateProxyProfileToProfiles() {
    const state = await getLocal(["proxyProfile", PROFILES_KEY, SELECTED_PROFILE_ID_KEY]);
    if (!state.proxyProfile || (Array.isArray(state[PROFILES_KEY]) && state[PROFILES_KEY].length > 0)) {
      return;
    }

    const fields = profileFields(state.proxyProfile);
    const defaultProfile = {
      id: "default",
      name: fields.host,
      ...fields,
    };

    await setLocal({
      [PROFILES_KEY]: [defaultProfile],
      [SELECTED_PROFILE_ID_KEY]: state[SELECTED_PROFILE_ID_KEY] || defaultProfile.id,
    });
  }

  async function renameLegacyDefaultProfile() {
    const profiles = await getProfiles();
    const index = profiles.findIndex((profile) => profile.id === "default" && profile.name === "Default");
    if (index < 0) {
      return;
    }

    // saveProfile matches profiles by name, so the rename must not collide with
    // an existing profile the user already named after this host.
    const hostName = String(profiles[index].host || "").trim();
    const taken = profiles.some(
      (profile, profileIndex) => profileIndex !== index && profile.name.toLowerCase() === hostName.toLowerCase(),
    );
    if (!hostName || taken) {
      return;
    }

    profiles[index] = { ...profiles[index], name: hostName };
    await setLocal({ [PROFILES_KEY]: profiles });
  }

  function isSupportedStoredProfile(profile) {
    const scheme = String(profile?.scheme || "").toLowerCase();
    return scheme === "http" || scheme === "https";
  }

  async function cleanupUnsupportedProfiles() {
    const state = await getLocal([
      "active",
      "proxyProfile",
      ACTIVE_PROXY_KEY,
      PROFILES_KEY,
      PROFILE_PASSWORDS_KEY,
      SELECTED_PROFILE_ID_KEY,
      ACTIVE_PROFILE_ID_KEY,
      LOCAL_PASSWORD_KEY,
      "parsedProxy",
    ]);
    const profiles = Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
    const supportedProfiles = profiles.filter(isSupportedStoredProfile);
    const supportedProfileIds = new Set(supportedProfiles.map((profile) => profile.id));
    const storedPasswords =
      state[PROFILE_PASSWORDS_KEY] && typeof state[PROFILE_PASSWORDS_KEY] === "object"
        ? state[PROFILE_PASSWORDS_KEY]
        : {};
    const supportedPasswords = Object.fromEntries(
      Object.entries(storedPasswords).filter(([profileId]) => supportedProfileIds.has(profileId)),
    );
    const selectedProfile = supportedProfiles.find((profile) => profile.id === state[SELECTED_PROFILE_ID_KEY]);
    const nextSelectedProfile = selectedProfile || supportedProfiles[0] || null;
    const connectedProfile = state[ACTIVE_PROXY_KEY] || (state.active ? state.proxyProfile : null);
    const removedActiveProxy = Boolean(state.active && connectedProfile && !isSupportedStoredProfile(connectedProfile));
    const unsupportedFormProfile = Boolean(state.proxyProfile && !isSupportedStoredProfile(state.proxyProfile));
    const nextState = {
      [PROFILES_KEY]: supportedProfiles,
      [PROFILE_PASSWORDS_KEY]: supportedPasswords,
      [SELECTED_PROFILE_ID_KEY]: nextSelectedProfile?.id || "",
    };
    const keysToRemove = [];

    if (unsupportedFormProfile) {
      if (nextSelectedProfile) {
        nextState.proxyProfile = profileFromRecord(nextSelectedProfile);
      } else {
        keysToRemove.push("proxyProfile");
      }
    }

    if (removedActiveProxy) {
      await clearSession();
      Object.assign(nextState, {
        active: false,
        [ACTIVE_PROFILE_ID_KEY]: "",
        lastError: "",
      });
      keysToRemove.push(ACTIVE_PROXY_KEY, LOCAL_PASSWORD_KEY, "parsedProxy");
    } else if (
      state[ACTIVE_PROFILE_ID_KEY] &&
      !supportedProfiles.some((profile) => profile.id === state[ACTIVE_PROFILE_ID_KEY])
    ) {
      nextState[ACTIVE_PROFILE_ID_KEY] = "";
    }

    if (unsupportedFormProfile && !isSupportedStoredProfile(state[ACTIVE_PROXY_KEY])) {
      keysToRemove.push(LOCAL_PASSWORD_KEY, "parsedProxy");
    }

    await setLocal(nextState);
    if (keysToRemove.length > 0) {
      await removeLocal([...new Set(keysToRemove)]);
    }

    return { removedActiveProxy };
  }

  async function saveProfile({ name, profile, password = "", profileId = "" }) {
    const requestedName = normalizeProfileName(name);
    const profilePayload = profileFields(profile);
    const profiles = await getProfiles();
    const requestedProfileId = String(profileId || "");
    let existingIndex = requestedProfileId ? profiles.findIndex((item) => item.id === requestedProfileId) : -1;

    if (existingIndex < 0) {
      const matchingNameIndex = profiles.findIndex((item) => item.name.toLowerCase() === requestedName.toLowerCase());
      if (matchingNameIndex >= 0 && profilesMatch(profiles[matchingNameIndex], profilePayload)) {
        existingIndex = matchingNameIndex;
      }
    }

    const existing = existingIndex >= 0 ? profiles[existingIndex] : null;
    const profileName = existing ? existing.name : deduplicateProfileName(profiles, requestedName);
    const savedProfile = {
      id: existing ? existing.id : makeProfileId(),
      name: profileName,
      ...profilePayload,
    };
    const passwords = await getProfilePasswords();

    if (password) {
      passwords[savedProfile.id] = String(password);
    } else {
      delete passwords[savedProfile.id];
    }

    if (existingIndex >= 0) {
      profiles[existingIndex] = savedProfile;
    } else {
      profiles.push(savedProfile);
    }

    await setLocal({
      [PROFILES_KEY]: profiles,
      [SELECTED_PROFILE_ID_KEY]: savedProfile.id,
      proxyProfile: profilePayload,
      [PROFILE_PASSWORDS_KEY]: passwords,
      lastError: "",
    });

    return savedProfile;
  }

  async function deleteProfile(profileId) {
    const id = String(profileId || "");
    const state = await getLocal([PROFILES_KEY, PROFILE_PASSWORDS_KEY, SELECTED_PROFILE_ID_KEY, ACTIVE_PROFILE_ID_KEY]);
    const profiles = Array.isArray(state[PROFILES_KEY]) ? state[PROFILES_KEY] : [];
    const nextProfiles = profiles.filter((profile) => profile.id !== id);
    const selectedProfileId =
      state[SELECTED_PROFILE_ID_KEY] === id ? nextProfiles[0]?.id || "" : state[SELECTED_PROFILE_ID_KEY] || "";
    const selectedProfile = nextProfiles.find((profile) => profile.id === selectedProfileId);
    const nextState = {
      [PROFILES_KEY]: nextProfiles,
      [SELECTED_PROFILE_ID_KEY]: selectedProfileId,
    };
    const passwords =
      state[PROFILE_PASSWORDS_KEY] && typeof state[PROFILE_PASSWORDS_KEY] === "object"
        ? { ...state[PROFILE_PASSWORDS_KEY] }
        : {};
    delete passwords[id];
    nextState[PROFILE_PASSWORDS_KEY] = passwords;

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

  async function saveConnection({ profile, password, parsedProxy, profileId }) {
    const resolvedProfileId = await resolveConnectionProfileId(profile, profileId);
    const localPayload = {
      active: true,
      proxyProfile: profile,
      // Snapshot of the connected proxy. Auth challenges and session restore must keep
      // using this even if the user switches or edits profiles without reconnecting.
      [ACTIVE_PROXY_KEY]: profile,
      [ACTIVE_PROFILE_ID_KEY]: resolvedProfileId,
      parsedProxy,
      lastError: "",
      // An unsaved proxy must not leave an unrelated saved profile selected in the popup.
      [SELECTED_PROFILE_ID_KEY]: resolvedProfileId,
    };

    if (resolvedProfileId) {
      await setProfilePassword(resolvedProfileId, password);
    }

    await removeLocal([...LEGACY_SECRET_KEYS, LOCAL_PASSWORD_KEY]);
    await setLocal(localPayload);

    await restoreSession(password || "");
  }

  async function restoreSession(password) {
    await setSession({
      [SESSION_PASSWORD_KEY]: password || "",
      [SESSION_CONNECTED_KEY]: true,
    });
  }

  async function resolveSessionPassword() {
    const sessionState = await getSession([SESSION_PASSWORD_KEY]);
    return sessionState[SESSION_PASSWORD_KEY] || "";
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
    await clearSession();
    await setLocal({
      active: false,
      lastError: "",
    });

    // The saved password stays so toggling back on (or the keyboard shortcut)
    // works without retyping. Forget saved data removes it.
    await removeLocal([ACTIVE_PROXY_KEY]);
  }

  async function forgetAllData() {
    await clearSession();
    await removeLocal([...LOCAL_KEYS, ...LEGACY_SECRET_KEYS]);
  }

  async function cleanupLegacySecrets() {
    const cleanupResult = await cleanupUnsupportedProfiles();
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
    await renameLegacyDefaultProfile();
    await migrateLegacySavedPassword();
    await removeLocal(LEGACY_SECRET_KEYS);
    return cleanupResult;
  }

  async function migrateStorage() {
    const state = await getLocal([SCHEMA_VERSION_KEY]);
    if (Number(state[SCHEMA_VERSION_KEY] || 0) >= CURRENT_SCHEMA_VERSION) {
      return { migrated: false, removedActiveProxy: false };
    }

    const cleanupResult = await cleanupLegacySecrets();
    await setLocal({ [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION });
    return { migrated: true, removedActiveProxy: cleanupResult.removedActiveProxy };
  }

  globalThis.ProxyStorage = {
    CURRENT_SCHEMA_VERSION,
    SCHEMA_VERSION_KEY,
    LOCAL_KEYS,
    LOCAL_PASSWORD_KEY,
    PROFILE_PASSWORDS_KEY,
    SESSION_PASSWORD_KEY,
    SESSION_CONNECTED_KEY,
    PROFILES_KEY,
    SELECTED_PROFILE_ID_KEY,
    ACTIVE_PROFILE_ID_KEY,
    ACTIVE_PROXY_KEY,
    buildProxyAuth,
    profilesMatch,
    getProfiles,
    getProfilePasswords,
    getProfilePassword,
    setProfilePassword,
    saveProfile,
    deleteProfile,
    selectProfile,
    cleanupUnsupportedProfiles,
    migrateLegacySavedPassword,
    migrateProxyProfileToProfiles,
    configureTrustedStorageAccess,
    saveConnection,
    restoreSession,
    resolveSessionPassword,
    isSessionConnected,
    getAuthState,
    getFullState,
    acceptDisclaimer,
    setDisconnected,
    forgetAllData,
    cleanupLegacySecrets,
    migrateStorage,
    getLocal,
    setLocal,
    removeLocal,
    getSession,
    setSession,
    clearSession,
  };
})();
