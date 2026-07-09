(function initProxyPopup() {
  "use strict";

  const {
    DEFAULT_DIRECT_CONNECT_LIST,
    buildProfileFromFields,
    validatePasswordForProfile,
    validateChromeProxySupport,
    parseDirectConnectList,
    sanitizeErrorMessage,
  } = ProxyShared;

  function sendCommand(command, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ command, ...payload }, (response) => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }

        if (!response || response.ok !== true) {
          reject(new Error(response && response.error ? response.error : "Proxy command failed."));
          return;
        }

        resolve(response);
      });
    });
  }

  function attachPopup() {
    if (typeof document === "undefined" || typeof chrome === "undefined") {
      return;
    }

    const disclaimerSection = document.getElementById("disclaimerSection");
    const mainSection = document.getElementById("mainSection");
    const disclaimerCheckbox = document.getElementById("disclaimerCheckbox");
    const acceptDisclaimerButton = document.getElementById("acceptDisclaimerButton");
    const profileSelect = document.getElementById("profileSelect");
    const saveProfileButton = document.getElementById("saveProfileButton");
    const deleteProfileButton = document.getElementById("deleteProfileButton");
    const proxyScheme = document.getElementById("proxyScheme");
    const proxyHost = document.getElementById("proxyHost");
    const proxyPort = document.getElementById("proxyPort");
    const proxyUsername = document.getElementById("proxyUsername");
    const proxyPassword = document.getElementById("proxyPassword");
    const directConnectList = document.getElementById("directConnectList");
    const togglePasswordButton = document.getElementById("togglePasswordButton");
    const rememberPassword = document.getElementById("rememberPassword");
    const errorMessage = document.getElementById("errorMessage");
    const warningMessage = document.getElementById("warningMessage");
    const statusBadge = document.getElementById("statusBadge");
    const activeProxyInfo = document.getElementById("activeProxyInfo");
    const connectButton = document.getElementById("connectButton");
    const disconnectButton = document.getElementById("disconnectButton");
    const testConnectionButton = document.getElementById("testConnectionButton");
    const forgetButton = document.getElementById("forgetButton");
    const socks5AuthNotice = document.getElementById("socks5AuthNotice");

    let disclaimerAccepted = false;
    let savedPasswordValue = "";
    let profiles = [];

    function updateSocks5Notice() {
      if (!socks5AuthNotice) {
        return;
      }

      const values = readFormValues();
      const hasCredentials = Boolean(String(values.username || "").trim() || String(values.password || "").trim());
      socks5AuthNotice.hidden = proxyScheme.value !== "socks5" || !hasCredentials;
    }

    function setBusy(isBusy) {
      connectButton.disabled = isBusy || !disclaimerAccepted;
      disconnectButton.disabled = isBusy;
      testConnectionButton.disabled = isBusy;
      forgetButton.disabled = isBusy;
      saveProfileButton.disabled = isBusy;
      deleteProfileButton.disabled = isBusy || !profileSelect.value;
    }

    function setProxyWarning(message, options = {}) {
      warningMessage.textContent = message || "";
      warningMessage.hidden = !message;
      warningMessage.classList.toggle("success", Boolean(message && options.success));
    }

    function setErrorMessage(message) {
      errorMessage.textContent = sanitizeErrorMessage(message);
      errorMessage.hidden = !message;
    }

    function setStatus(status, message) {
      statusBadge.className = "status";

      if (status === "connected") {
        statusBadge.classList.add("status-on");
        statusBadge.textContent = "Connected";
        setErrorMessage("");
        setProxyWarning("");
        return;
      }

      if (status === "warning") {
        statusBadge.classList.add("status-warning");
        statusBadge.textContent = "Warning";
        if (message) {
          setProxyWarning(message);
        }
        return;
      }

      if (status === "error") {
        statusBadge.classList.add("status-error");
        statusBadge.textContent = "Error";
        setProxyWarning("");
        if (message) {
          setErrorMessage(message);
        }
        return;
      }

      statusBadge.classList.add("status-off");
      statusBadge.textContent = "Disconnected";
      setErrorMessage("");
      setProxyWarning("");
    }

    function readFormValues() {
      return {
        scheme: proxyScheme.value,
        host: proxyHost.value,
        port: proxyPort.value,
        username: proxyUsername.value,
        password: proxyPassword.value,
        directConnectList: directConnectList.value,
      };
    }

    function fillFormFromProfile(profile, options = {}) {
      proxyScheme.value = profile.scheme || "http";
      proxyHost.value = profile.host || "";
      proxyPort.value = profile.port ? String(profile.port) : "";
      proxyUsername.value = profile.username || "";

      if (options.password !== undefined) {
        proxyPassword.value = options.password;
      }
    }

    function profileLabel(profile) {
      const username = profile.username ? `${profile.username}@` : "";
      return `${profile.name} - ${profile.scheme}://${username}${profile.host}:${profile.port}`;
    }

    function selectedProfile() {
      return profiles.find((profile) => profile.id === profileSelect.value) || null;
    }

    function populateProfileSelect(state) {
      const selectedProfileId = state.selectedProfileId || "";
      profiles = Array.isArray(state.proxyProfiles) ? state.proxyProfiles : [];
      profileSelect.replaceChildren();

      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = "Unsaved settings";
      profileSelect.appendChild(emptyOption);

      for (const profile of profiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profileLabel(profile);
        profileSelect.appendChild(option);
      }

      profileSelect.value = profiles.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : "";
      deleteProfileButton.disabled = !profileSelect.value;
    }

    function parseCurrentForm({ showError }) {
      try {
        const values = readFormValues();
        const profile = buildProfileFromFields(values);
        validatePasswordForProfile(profile, values.password);
        validateChromeProxySupport(profile, values.password);
        const parsedDirectConnectList = parseDirectConnectList(values.directConnectList);
        setErrorMessage("");
        return {
          profile,
          password: values.password,
          directConnectList: parsedDirectConnectList.join(", "),
        };
      } catch (error) {
        if (showError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("");
        }
        return null;
      }
    }

    function updateActiveProxyInfo(state, connected) {
      const parsed = state.parsedProxy;

      if (connected && parsed && parsed.host) {
        activeProxyInfo.textContent = `Active proxy: ${parsed.scheme}://${parsed.host}:${parsed.port}`;
        activeProxyInfo.hidden = false;
        return;
      }

      activeProxyInfo.textContent = "";
      activeProxyInfo.hidden = true;
    }

    function applyStatusResponse(response) {
      const state = response.state || {};
      const sessionConnected = Boolean(response.sessionConnected);
      const connected = response.status === "connected" || Boolean(state.active && sessionConnected);

      updateActiveProxyInfo(state, connected);

      if (response.status === "warning") {
        setStatus("warning", response.message);
        return;
      }

      if (response.status === "connected") {
        setStatus("connected");
        return;
      }

      if (response.status === "disconnected") {
        setStatus("disconnected");
        return;
      }

      if (state.lastError) {
        setStatus("error", state.lastError);
        return;
      }

      if (state.active && state.lastProxyError) {
        setStatus("warning", state.lastProxyError);
        return;
      }

      setStatus(state.active && sessionConnected ? "connected" : "disconnected");
    }

    function showDisclaimer() {
      disclaimerSection.hidden = false;
      mainSection.hidden = true;
      disclaimerAccepted = false;
      connectButton.disabled = true;
    }

    function showMainForm() {
      disclaimerSection.hidden = true;
      mainSection.hidden = false;
      disclaimerAccepted = true;
      connectButton.disabled = false;
    }

    function loadSavedForm(response) {
      const state = response.state || {};
      populateProfileSelect(state);

      const profile = selectedProfile() || state.proxyProfile;
      if (profile) {
        fillFormFromProfile(profile);
      }

      rememberPassword.checked = Boolean(state.rememberPassword);
      directConnectList.value = state.directConnectList || DEFAULT_DIRECT_CONNECT_LIST;
      savedPasswordValue = response.password || "";

      if (savedPasswordValue) {
        proxyPassword.value = savedPasswordValue;
      }
    }

    async function resolvePasswordForConnect(formPassword) {
      if (formPassword) {
        return formPassword;
      }

      if (rememberPassword.checked) {
        return savedPasswordValue;
      }

      return "";
    }

    async function connect() {
      if (!disclaimerAccepted) {
        setErrorMessage("Accept the disclaimer before connecting.");
        return;
      }

      const parsed = parseCurrentForm({ showError: true });
      if (!parsed) {
        setStatus("error");
        return;
      }

      const password = await resolvePasswordForConnect(parsed.password);

      try {
        validatePasswordForProfile(parsed.profile, password);
        validateChromeProxySupport(parsed.profile, password);
        setErrorMessage("");
      } catch (error) {
        setStatus("error", error.message);
        return;
      }

      setBusy(true);
      try {
        const response = await sendCommand("connect", {
          profile: parsed.profile,
          password,
          rememberPassword: rememberPassword.checked,
          directConnectList: parsed.directConnectList,
          profileId: profileSelect.value || "",
        });
        if (password) {
          proxyPassword.value = password;
          savedPasswordValue = password;
        }
        applyStatusResponse(response);
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    async function disconnect() {
      setBusy(true);
      try {
        const rememberEnabled = rememberPassword.checked;
        const response = await sendCommand("disconnect");
        if (!rememberEnabled) {
          proxyPassword.value = "";
          savedPasswordValue = "";
        }
        applyStatusResponse(response);
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    async function forgetSavedData() {
      const confirmed = window.confirm("Remove all saved proxy settings and credentials from this device?");
      if (!confirmed) {
        return;
      }

      setBusy(true);
      try {
        const response = await sendCommand("forgetAll");
        fillFormFromProfile({ scheme: "http", host: "", port: "", username: "" }, { password: "" });
        populateProfileSelect({});
        directConnectList.value = DEFAULT_DIRECT_CONNECT_LIST;
        rememberPassword.checked = false;
        savedPasswordValue = "";
        showDisclaimer();
        disclaimerCheckbox.checked = false;
        acceptDisclaimerButton.disabled = true;
        applyStatusResponse(response);
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    function togglePasswordVisibility() {
      const isHidden = proxyPassword.type === "password";
      proxyPassword.type = isHidden ? "text" : "password";
      togglePasswordButton.textContent = isHidden ? "Hide" : "Show";
      togglePasswordButton.setAttribute("aria-pressed", String(isHidden));
    }

    async function saveCurrentProfile() {
      const parsed = parseCurrentForm({ showError: true });
      if (!parsed) {
        return;
      }

      const currentProfile = selectedProfile();
      const suggestedName = currentProfile ? currentProfile.name : parsed.profile.host || "Profile";
      const name = window.prompt("Profile name", suggestedName);
      if (name === null) {
        return;
      }

      setBusy(true);
      try {
        const response = await sendCommand("saveProfile", {
          name,
          profile: parsed.profile,
        });
        loadSavedForm(response);
        updateSocks5Notice();
        applyStatusResponse(response);
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    async function deleteSelectedProfile() {
      const profile = selectedProfile();
      if (!profile) {
        return;
      }

      const confirmed = window.confirm(`Delete profile "${profile.name}"?`);
      if (!confirmed) {
        return;
      }

      setBusy(true);
      try {
        const response = await sendCommand("deleteProfile", {
          profileId: profile.id,
        });
        loadSavedForm(response);
        updateSocks5Notice();
        applyStatusResponse(response);
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    async function testConnection() {
      setBusy(true);
      try {
        const response = await sendCommand("testConnection");
        applyStatusResponse(response);
        if (response.testResult && response.testResult.message) {
          setProxyWarning(response.testResult.message, { success: Boolean(response.testResult.ok) });
        }
      } catch (error) {
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    disclaimerCheckbox.addEventListener("change", () => {
      acceptDisclaimerButton.disabled = !disclaimerCheckbox.checked;
    });

    acceptDisclaimerButton.addEventListener("click", async () => {
      if (!disclaimerCheckbox.checked) {
        return;
      }

      await sendCommand("acceptDisclaimer");
      showMainForm();
    });

    connectButton.addEventListener("click", connect);
    disconnectButton.addEventListener("click", disconnect);
    testConnectionButton.addEventListener("click", testConnection);
    forgetButton.addEventListener("click", forgetSavedData);
    saveProfileButton.addEventListener("click", saveCurrentProfile);
    deleteProfileButton.addEventListener("click", deleteSelectedProfile);
    togglePasswordButton.addEventListener("click", togglePasswordVisibility);
    profileSelect.addEventListener("change", async () => {
      const profile = selectedProfile();
      if (profile) {
        fillFormFromProfile(profile);
      }
      deleteProfileButton.disabled = !profileSelect.value;
      updateSocks5Notice();

      try {
        await sendCommand("selectProfile", {
          profileId: profileSelect.value,
        });
      } catch (error) {
        setStatus("error", error.message);
      }
    });
    proxyScheme.addEventListener("change", updateSocks5Notice);
    proxyUsername.addEventListener("input", updateSocks5Notice);
    proxyPassword.addEventListener("input", updateSocks5Notice);
    directConnectList.value = DEFAULT_DIRECT_CONNECT_LIST;

    function refreshStatus() {
      sendCommand("getStatus")
        .then((response) => {
          const state = response.state || {};
          if (!state.disclaimerAccepted) {
            showDisclaimer();
            return;
          }

          applyStatusResponse(response);
        })
        .catch((error) => {
          setStatus("error", error.message);
        });
    }

    sendCommand("getStatus")
      .then((response) => {
        const state = response.state || {};
        if (!state.disclaimerAccepted) {
          showDisclaimer();
          return;
        }

        showMainForm();
        loadSavedForm(response);
        updateSocks5Notice();
        applyStatusResponse(response);
      })
      .catch((error) => {
        setStatus("error", error.message);
      });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "session" && changes.sessionConnected) {
        refreshStatus();
        return;
      }

      if (areaName !== "local") {
        return;
      }

      if (changes.lastError && changes.lastError.newValue) {
        setStatus("error", changes.lastError.newValue);
        return;
      }

      if (changes.lastProxyError || changes.active) {
        refreshStatus();
      }
    });
  }

  attachPopup();
})();
