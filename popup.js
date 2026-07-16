(function initProxyPopup() {
  "use strict";

  const {
    PASSWORD_MASK,
    parseProxyInput,
    formatProxyString,
    buildProfileFromFields,
    validatePasswordForProfile,
    validateChromeProxySupport,
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
    const proxyToggle = document.getElementById("proxyToggle");
    const statusLine = document.getElementById("statusLine");
    const statusDot = document.getElementById("statusDot");
    const statusText = document.getElementById("statusText");
    const profileRow = document.getElementById("profileRow");
    const profileSelect = document.getElementById("profileSelect");
    const proxyInput = document.getElementById("proxyInput");
    const socks5AuthNotice = document.getElementById("socks5AuthNotice");
    const errorMessage = document.getElementById("errorMessage");
    const saveProfileButton = document.getElementById("saveProfileButton");
    const deleteProfileButton = document.getElementById("deleteProfileButton");
    const forgetButton = document.getElementById("forgetButton");

    let disclaimerAccepted = false;
    let savedPasswordValue = "";
    let profiles = [];

    function setBusy(isBusy) {
      proxyToggle.disabled = isBusy || !disclaimerAccepted;
      saveProfileButton.disabled = isBusy;
      deleteProfileButton.disabled = isBusy;
      forgetButton.disabled = isBusy;
    }

    function setErrorMessage(message) {
      errorMessage.textContent = message ? sanitizeErrorMessage(message) : "";
      errorMessage.hidden = !message;
    }

    function setStatusLine(kind, text) {
      statusDot.className = `dot dot-${kind}`;
      statusText.textContent = text;
    }

    function proxyLabel(state) {
      const parsed = state.parsedProxy;
      if (!parsed || !parsed.host) {
        return "";
      }
      return `${parsed.scheme}://${parsed.host}:${parsed.port}`;
    }

    function renderStatus(response) {
      const state = response.state || {};
      const sessionConnected = Boolean(response.sessionConnected);
      const connected = response.status === "connected" || Boolean(state.active && sessionConnected);
      const testResult = response.testResult;

      proxyToggle.checked = connected;

      if (connected) {
        const label = proxyLabel(state);
        setErrorMessage("");

        if (testResult && testResult.ok) {
          setStatusLine("on", `Working · ${Math.round(testResult.latencyMs)} ms`);
        } else if (testResult && !testResult.ok) {
          setStatusLine("warn", sanitizeErrorMessage(testResult.message));
        } else if (state.lastProxyError) {
          setStatusLine("warn", sanitizeErrorMessage(state.lastProxyError));
        } else {
          setStatusLine("on", label ? `Connected · ${label}` : "Connected");
        }
        return;
      }

      if (state.lastError) {
        setStatusLine("error", "Off");
        setErrorMessage(state.lastError);
        return;
      }

      setStatusLine("off", "Off");
    }

    function updateSocks5Notice() {
      let show = false;
      try {
        const parsed = parseProxyInput(proxyInput.value);
        show = parsed.scheme === "socks5" && Boolean(parsed.username || parsed.password);
      } catch (_error) {
        show = false;
      }
      socks5AuthNotice.hidden = !show;
    }

    function parseForm({ showError }) {
      try {
        const parsed = parseProxyInput(proxyInput.value);
        const profile = buildProfileFromFields(parsed);
        let password = parsed.password || "";

        if (password === PASSWORD_MASK && savedPasswordValue) {
          password = savedPasswordValue;
        }

        validatePasswordForProfile(profile, password);
        validateChromeProxySupport(profile, password);
        setErrorMessage("");
        return { profile, password };
      } catch (error) {
        if (showError) {
          setErrorMessage(error.message);
        }
        return null;
      }
    }

    function fillInputFromProfile(profile) {
      const mask = profile.username && savedPasswordValue ? PASSWORD_MASK : "";
      proxyInput.value = formatProxyString(profile, { password: mask });
    }

    function profileOptionLabel(profile) {
      return `${profile.name} — ${formatProxyString(profile)}`;
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
      emptyOption.textContent = "Unsaved proxy";
      profileSelect.appendChild(emptyOption);

      for (const profile of profiles) {
        const option = document.createElement("option");
        option.value = profile.id;
        option.textContent = profileOptionLabel(profile);
        profileSelect.appendChild(option);
      }

      profileSelect.value = profiles.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : "";
      profileRow.hidden = profiles.length === 0;
      deleteProfileButton.hidden = !profileSelect.value;
    }

    function loadSavedForm(response) {
      const state = response.state || {};
      savedPasswordValue = response.password || "";
      populateProfileSelect(state);

      const profile = selectedProfile() || state.proxyProfile;
      if (profile && profile.host) {
        fillInputFromProfile(profile);
      }

      updateSocks5Notice();
    }

    function showDisclaimer() {
      disclaimerSection.hidden = false;
      mainSection.hidden = true;
      disclaimerAccepted = false;
      proxyToggle.disabled = true;
    }

    function showMainForm() {
      disclaimerSection.hidden = true;
      mainSection.hidden = false;
      disclaimerAccepted = true;
      proxyToggle.disabled = false;
    }

    async function connect() {
      const parsed = parseForm({ showError: true });
      if (!parsed) {
        proxyToggle.checked = false;
        setStatusLine("error", "Off");
        return;
      }

      setBusy(true);
      setStatusLine("testing", "Connecting…");
      try {
        const response = await sendCommand("connect", {
          profile: parsed.profile,
          password: parsed.password,
          profileId: profileSelect.value || "",
        });
        savedPasswordValue = parsed.password || "";
        fillInputFromProfile(parsed.profile);
        renderStatus(response);
      } catch (error) {
        proxyToggle.checked = false;
        setStatusLine("error", "Off");
        setErrorMessage(error.message);
      } finally {
        setBusy(false);
      }
    }

    async function disconnect() {
      setBusy(true);
      try {
        const response = await sendCommand("disconnect");
        renderStatus(response);
      } catch (error) {
        setStatusLine("error", "Off");
        setErrorMessage(error.message);
      } finally {
        setBusy(false);
      }
    }

    async function retestConnection() {
      if (proxyToggle.disabled || !proxyToggle.checked) {
        return;
      }

      setBusy(true);
      setStatusLine("testing", "Checking…");
      try {
        const response = await sendCommand("testConnection");
        renderStatus(response);
      } catch (error) {
        setStatusLine("error", "Off");
        setErrorMessage(error.message);
      } finally {
        setBusy(false);
      }
    }

    async function saveCurrentProfile() {
      const parsed = parseForm({ showError: true });
      if (!parsed) {
        return;
      }

      const current = selectedProfile();
      const suggestedName = current ? current.name : parsed.profile.host || "Profile";
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
        renderStatus(response);
      } catch (error) {
        setErrorMessage(error.message);
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
        renderStatus(response);
      } catch (error) {
        setErrorMessage(error.message);
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
        proxyInput.value = "";
        savedPasswordValue = "";
        populateProfileSelect({});
        updateSocks5Notice();
        showDisclaimer();
        disclaimerCheckbox.checked = false;
        acceptDisclaimerButton.disabled = true;
        renderStatus(response);
      } catch (error) {
        setErrorMessage(error.message);
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

    proxyToggle.addEventListener("change", () => {
      if (proxyToggle.checked) {
        connect();
      } else {
        disconnect();
      }
    });

    statusLine.addEventListener("click", retestConnection);
    saveProfileButton.addEventListener("click", saveCurrentProfile);
    deleteProfileButton.addEventListener("click", deleteSelectedProfile);
    forgetButton.addEventListener("click", forgetSavedData);

    proxyInput.addEventListener("input", () => {
      setErrorMessage("");
      updateSocks5Notice();
    });

    profileSelect.addEventListener("change", async () => {
      const profile = selectedProfile();
      if (profile) {
        fillInputFromProfile(profile);
      }
      deleteProfileButton.hidden = !profileSelect.value;
      updateSocks5Notice();

      try {
        await sendCommand("selectProfile", {
          profileId: profileSelect.value,
        });
      } catch (error) {
        setErrorMessage(error.message);
      }
    });

    function refreshStatus() {
      sendCommand("getStatus")
        .then((response) => {
          const state = response.state || {};
          if (!state.disclaimerAccepted) {
            showDisclaimer();
            return;
          }

          renderStatus(response);
        })
        .catch((error) => {
          setErrorMessage(error.message);
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
        renderStatus(response);
      })
      .catch((error) => {
        setErrorMessage(error.message);
      });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "session" && changes.sessionConnected) {
        refreshStatus();
        return;
      }

      if (areaName !== "local") {
        return;
      }

      if (changes.lastError || changes.lastProxyError || changes.active) {
        refreshStatus();
      }
    });
  }

  attachPopup();
})();
