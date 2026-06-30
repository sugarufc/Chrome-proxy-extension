(function initProxyPopup() {
  "use strict";

  const {
    DEFAULT_DIRECT_CONNECT_LIST,
    buildProfileFromFields,
    validatePasswordForProfile,
    validateChromeProxySupport,
    parseDirectConnectList,
    buildProxyConfig,
    sanitizeParsedProxy,
    sanitizeErrorMessage,
  } = ProxyShared;

  function chromeCall(apiCall) {
    return new Promise((resolve, reject) => {
      apiCall(() => {
        const runtimeError = chrome.runtime.lastError;
        if (runtimeError) {
          reject(new Error(runtimeError.message));
          return;
        }
        resolve();
      });
    });
  }

  function setActionIcon(active) {
    const suffix = active ? "-on" : "";

    return Promise.all([
      chromeCall((done) => chrome.action.setBadgeText({ text: "" }, done)),
      chromeCall((done) =>
        chrome.action.setIcon(
          {
            path: {
              16: `icons/icon16${suffix}.png`,
              48: `icons/icon48${suffix}.png`,
              128: `icons/icon128${suffix}.png`,
            },
          },
          done,
        ),
      ),
    ]);
  }

  function attachPopup() {
    if (typeof document === "undefined" || typeof chrome === "undefined") {
      return;
    }

    const disclaimerSection = document.getElementById("disclaimerSection");
    const mainSection = document.getElementById("mainSection");
    const disclaimerCheckbox = document.getElementById("disclaimerCheckbox");
    const acceptDisclaimerButton = document.getElementById("acceptDisclaimerButton");
    const proxyScheme = document.getElementById("proxyScheme");
    const proxyHost = document.getElementById("proxyHost");
    const proxyPort = document.getElementById("proxyPort");
    const proxyUsername = document.getElementById("proxyUsername");
    const proxyPassword = document.getElementById("proxyPassword");
    const togglePasswordButton = document.getElementById("togglePasswordButton");
    const rememberPassword = document.getElementById("rememberPassword");
    const errorMessage = document.getElementById("errorMessage");
    const warningMessage = document.getElementById("warningMessage");
    const statusBadge = document.getElementById("statusBadge");
    const connectButton = document.getElementById("connectButton");
    const disconnectButton = document.getElementById("disconnectButton");
    const forgetButton = document.getElementById("forgetButton");
    const socks5AuthNotice = document.getElementById("socks5AuthNotice");

    let disclaimerAccepted = false;

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
      forgetButton.disabled = isBusy;
    }

    function setProxyWarning(message) {
      warningMessage.textContent = message || "";
      warningMessage.hidden = !message;
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

    function parseCurrentForm({ showError }) {
      try {
        const values = readFormValues();
        const profile = buildProfileFromFields(values);
        validatePasswordForProfile(profile, values.password);
        validateChromeProxySupport(profile, values.password);
        setErrorMessage("");
        return { profile, password: values.password };
      } catch (error) {
        if (showError) {
          setErrorMessage(error.message);
        } else {
          setErrorMessage("");
        }
        return null;
      }
    }

    async function applyStoredStatus(state) {
      const sessionConnected = await ProxyStorage.isSessionConnected();

      if (state.active && !sessionConnected) {
        try {
          await chromeCall((done) => chrome.proxy.settings.clear({ scope: "regular" }, done));
        } catch (error) {
          // Ignore cleanup errors for stale active state.
        }
        await ProxyStorage.setLocal({ active: false, lastProxyError: "" });
        await setActionIcon(false);
        setStatus("warning", "Session expired. Click Connect to use the proxy again.");
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

    async function loadSavedForm(state) {
      if (state.proxyProfile) {
        fillFormFromProfile(state.proxyProfile);
      }

      rememberPassword.checked = Boolean(state.rememberPassword);

      const sessionPassword = await ProxyStorage.resolveSessionPassword();
      if (sessionPassword) {
        proxyPassword.value = sessionPassword;
        return;
      }

      if (state.rememberPassword && state.savedPassword) {
        proxyPassword.value = state.savedPassword;
      }
    }

    async function resolvePasswordForConnect(formPassword) {
      if (formPassword) {
        return formPassword;
      }

      if (rememberPassword.checked) {
        return ProxyStorage.resolveSavedPassword();
      }

      return "";
    }

    async function connect() {
      if (!disclaimerAccepted) {
        setErrorMessage("Accept the disclaimer before connecting.");
        return;
      }

      const parsed = parseCurrentForm({ showError: false });
      if (!parsed) {
        setStatus("error");
        setErrorMessage("Proxy settings are incomplete.");
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

      const directConnectList = parseDirectConnectList(DEFAULT_DIRECT_CONNECT_LIST);
      const config = buildProxyConfig(parsed.profile, directConnectList);

      setBusy(true);
      try {
        await chromeCall((done) => chrome.proxy.settings.set({ value: config, scope: "regular" }, done));
        await ProxyStorage.saveConnection({
          profile: parsed.profile,
          password,
          rememberPassword: rememberPassword.checked,
          directConnectList: DEFAULT_DIRECT_CONNECT_LIST,
          parsedProxy: sanitizeParsedProxy(parsed.profile, Boolean(password)),
        });
        await setActionIcon(true);
        if (password) {
          proxyPassword.value = password;
        }
        setStatus("connected");
      } catch (error) {
        await ProxyStorage.setLocal({ active: false, lastError: sanitizeErrorMessage(error.message) });
        setStatus("error", error.message);
      } finally {
        setBusy(false);
      }
    }

    async function disconnect() {
      setBusy(true);
      try {
        await chromeCall((done) => chrome.proxy.settings.clear({ scope: "regular" }, done));
        const rememberEnabled = rememberPassword.checked;
        await ProxyStorage.setDisconnected();
        if (!rememberEnabled) {
          proxyPassword.value = "";
        }
        await setActionIcon(false);
        setStatus("disconnected");
      } catch (error) {
        await ProxyStorage.setLocal({ lastError: sanitizeErrorMessage(error.message) });
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
        await chromeCall((done) => chrome.proxy.settings.clear({ scope: "regular" }, done));
        await ProxyStorage.forgetAllData();
        fillFormFromProfile({ scheme: "http", host: "", port: "", username: "" }, { password: "" });
        rememberPassword.checked = false;
        await setActionIcon(false);
        showDisclaimer();
        disclaimerCheckbox.checked = false;
        acceptDisclaimerButton.disabled = true;
        setStatus("disconnected");
      } catch (error) {
        await ProxyStorage.setLocal({ lastError: sanitizeErrorMessage(error.message) });
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

    disclaimerCheckbox.addEventListener("change", () => {
      acceptDisclaimerButton.disabled = !disclaimerCheckbox.checked;
    });

    acceptDisclaimerButton.addEventListener("click", async () => {
      if (!disclaimerCheckbox.checked) {
        return;
      }

      await ProxyStorage.acceptDisclaimer();
      showMainForm();
    });

    connectButton.addEventListener("click", connect);
    disconnectButton.addEventListener("click", disconnect);
    forgetButton.addEventListener("click", forgetSavedData);
    togglePasswordButton.addEventListener("click", togglePasswordVisibility);
    proxyScheme.addEventListener("change", updateSocks5Notice);
    proxyUsername.addEventListener("input", updateSocks5Notice);
    proxyPassword.addEventListener("input", updateSocks5Notice);

    ProxyStorage.configureTrustedStorageAccess().then(() =>
      ProxyStorage.getFullState().then(async (state) => {
        if (!state.disclaimerAccepted) {
          showDisclaimer();
          return;
        }

        showMainForm();
        await loadSavedForm(state);
        updateSocks5Notice();
        await applyStoredStatus(state);
      }),
    );

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "session" && changes.sessionConnected) {
        ProxyStorage.getFullState().then((state) => applyStoredStatus(state));
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
        ProxyStorage.getFullState().then((state) => applyStoredStatus(state));
      }
    });
  }

  attachPopup();
})();
