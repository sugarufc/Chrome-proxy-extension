(function initProxyPopup() {
  "use strict";

  const CONFIRM_TIMEOUT_MS = 4_000;
  const $ = (id) => document.getElementById(id);
  const toggle = $("proxyToggle");
  const input = $("proxyInput");
  const forgetButton = $("forgetButton");
  let busy = false;
  let accepted = false;
  let confirmTimer = null;

  function send(command, payload = {}) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ command, ...payload }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (!response || !response.ok) {
          reject(new Error((response && response.error) || "Something went wrong."));
        } else {
          resolve(response.status);
        }
      });
    });
  }

  function showError(message) {
    $("errorMessage").textContent = message || "";
    $("errorMessage").hidden = !message;
  }

  function render(status) {
    accepted = status.accepted;
    $("disclaimerSection").hidden = accepted;
    $("mainSection").hidden = !accepted;
    toggle.disabled = busy || !accepted;
    toggle.checked = status.active;

    $("statusDot").className = `dot ${status.active ? "dot-on" : status.error ? "dot-error" : ""}`;
    $("statusText").textContent = status.active ? `Connected · ${status.label}` : "Off";
    showError(status.active ? "" : status.error);

    // Never overwrite what the user is typing; fill the field on open and after a connect.
    if (!input.value || status.active) {
      input.value = status.input;
    }
  }

  async function run(command, payload) {
    busy = true;
    toggle.disabled = true;
    try {
      render(await send(command, payload));
    } catch (error) {
      toggle.checked = false;
      showError(error.message);
    } finally {
      busy = false;
      // The switch stays locked until the disclaimer is accepted (also right after "Forget").
      toggle.disabled = !accepted;
    }
  }

  function resetForget() {
    clearTimeout(confirmTimer);
    confirmTimer = null;
    forgetButton.textContent = "Forget saved data";
  }

  $("versionLabel").textContent = `Version ${chrome.runtime.getManifest().version}`;

  $("disclaimerCheckbox").addEventListener("change", (event) => {
    $("acceptButton").disabled = !event.target.checked;
  });
  $("acceptButton").addEventListener("click", () => run("acceptDisclaimer"));

  function applyToggle() {
    showError("");
    run(toggle.checked ? "connect" : "disconnect", { input: input.value });
  }

  toggle.addEventListener("change", applyToggle);
  input.addEventListener("input", () => showError(""));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !toggle.disabled) {
      event.preventDefault();
      toggle.checked = true;
      applyToggle();
    }
  });

  forgetButton.addEventListener("click", async () => {
    if (!confirmTimer) {
      forgetButton.textContent = "Click again to confirm";
      confirmTimer = setTimeout(resetForget, CONFIRM_TIMEOUT_MS);
      return;
    }

    resetForget();
    input.value = "";
    await run("forget");
    $("disclaimerCheckbox").checked = false;
    $("acceptButton").disabled = true;
  });

  // The background can turn the proxy off by itself (for example after a rejected login).
  chrome.storage.onChanged.addListener((changes) => {
    if (!busy && (changes.active || changes.lastError)) {
      send("getStatus").then(render, () => {});
    }
  });

  send("getStatus").then(render, (error) => showError(error.message));
})();
