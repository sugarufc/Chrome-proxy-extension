(function initProxyPopup() {
  "use strict";

  const CONFIRMATION_TIMEOUT_MS = 4_000;
  const {
    parseProxyInput,
    formatProxyString,
    buildProfileFromFields,
    validatePasswordForProfile,
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
    const errorMessage = document.getElementById("errorMessage");
    const saveProfileButton = document.getElementById("saveProfileButton");
    const deleteProfileButton = document.getElementById("deleteProfileButton");
    const forgetButton = document.getElementById("forgetButton");
    const versionLabel = document.getElementById("versionLabel");

    versionLabel.textContent = `Version ${chrome.runtime.getManifest().version}`;

    let disclaimerAccepted = false;
    let selectedPasswordValue = "";
    let profiles = [];
    let confirmationButton = null;
    let confirmationTimeoutId = null;
    let statusRequestId = 0;

    function resetConfirmation() {
      if (confirmationTimeoutId !== null) {
        clearTimeout(confirmationTimeoutId);
        confirmationTimeoutId = null;
      }

      if (confirmationButton === deleteProfileButton) {
        deleteProfileButton.textContent = "Delete profile";
        deleteProfileButton.classList.remove("link-danger");
      } else if (confirmationButton === forgetButton) {
        forgetButton.textContent = "Forget saved data";
      }

      confirmationButton = null;
    }

    function confirmInline(button, confirmationText) {
      if (confirmationButton === button) {
        resetConfirmation();
        return true;
      }

      resetConfirmation();
      confirmationButton = button;
      button.textContent = confirmationText;
      button.classList.add("link-danger");
      confirmationTimeoutId = setTimeout(resetConfirmation, CONFIRMATION_TIMEOUT_MS);
      return false;
    }

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

    function parseForm({ showError }) {
      try {
        const parsed = parseProxyInput(proxyInput.value);
        const profile = buildProfileFromFields(parsed);
        const password = parsed.password || "";

        validatePasswordForProfile(profile, password);
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
      proxyInput.value = formatProxyString(profile, { password: selectedPasswordValue });
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
        option.textContent = profile.name;
        profileSelect.appendChild(option);
      }

      profileSelect.value = profiles.some((profile) => profile.id === selectedProfileId) ? selectedProfileId : "";
      profileRow.hidden = profiles.length === 0;
      deleteProfileButton.hidden = !profileSelect.value;
    }

    function loadSavedForm(response) {
      const state = response.state || {};
      selectedPasswordValue = response.selectedPassword || "";
      populateProfileSelect(state);

      const profile = selectedProfile() || state.proxyProfile;
      if (profile && profile.host) {
        fillInputFromProfile(profile);
      }
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

    // The check must not block the toggle, so the user can turn the proxy off
    // while the test request is still running. Stale results are dropped.
    async function runConnectionCheck() {
      const requestId = ++statusRequestId;
      setStatusLine("testing", "Checking…");
      try {
        const response = await sendCommand("testConnection");
        if (requestId === statusRequestId && proxyToggle.checked) {
          renderStatus(response);
        }
      } catch (error) {
        if (requestId === statusRequestId && proxyToggle.checked) {
          setStatusLine("warn", sanitizeErrorMessage(error.message));
        }
      }
    }

    async function connect() {
      const parsed = parseForm({ showError: true });
      if (!parsed) {
        proxyToggle.checked = false;
        setStatusLine("error", "Off");
        return;
      }

      statusRequestId += 1;
      setBusy(true);
      setStatusLine("testing", "Connecting…");
      try {
        const connectResponse = await sendCommand("connect", {
          profile: parsed.profile,
          password: parsed.password,
          profileId: profileSelect.value || "",
        });
        selectedPasswordValue = parsed.password || "";
        fillInputFromProfile(parsed.profile);
        renderStatus(connectResponse);
      } catch (error) {
        proxyToggle.checked = false;
        setStatusLine("error", "Off");
        setErrorMessage(error.message);
        return;
      } finally {
        setBusy(false);
      }

      await runConnectionCheck();
    }

    async function disconnect() {
      statusRequestId += 1;
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

      await runConnectionCheck();
    }

    async function saveCurrentProfile() {
      const parsed = parseForm({ showError: true });
      if (!parsed) {
        return;
      }

      const current = selectedProfile();
      const name = current ? current.name : parsed.profile.host;

      setBusy(true);
      try {
        const response = await sendCommand("saveProfile", {
          name,
          profile: parsed.profile,
          password: parsed.password,
          profileId: current ? current.id : "",
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

      if (!confirmInline(deleteProfileButton, "Confirm delete?")) {
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
      if (!confirmInline(forgetButton, "Confirm forget?")) {
        return;
      }

      setBusy(true);
      try {
        const response = await sendCommand("forgetAll");
        proxyInput.value = "";
        selectedPasswordValue = "";
        populateProfileSelect({});
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

    function handleToggleChange() {
      if (proxyToggle.checked) {
        connect();
      } else {
        disconnect();
      }
    }

    proxyToggle.addEventListener("change", handleToggleChange);

    statusLine.addEventListener("click", retestConnection);
    saveProfileButton.addEventListener("click", saveCurrentProfile);
    deleteProfileButton.addEventListener("click", deleteSelectedProfile);
    forgetButton.addEventListener("click", forgetSavedData);

    proxyInput.addEventListener("input", () => {
      setErrorMessage("");
    });

    proxyInput.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || !disclaimerAccepted || proxyToggle.disabled) {
        return;
      }

      event.preventDefault();
      proxyToggle.checked = true;
      handleToggleChange();
    });

    document.addEventListener("click", (event) => {
      if (confirmationButton && event.target !== confirmationButton) {
        resetConfirmation();
      }
    });

    document.addEventListener("input", resetConfirmation);

    profileSelect.addEventListener("change", async () => {
      const profile = selectedProfile();
      deleteProfileButton.hidden = !profileSelect.value;
      try {
        const response = await sendCommand("selectProfile", {
          profileId: profileSelect.value,
        });
        if (profile) {
          loadSavedForm(response);
        } else {
          selectedPasswordValue = "";
        }
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
