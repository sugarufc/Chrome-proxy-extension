const assert = require("node:assert/strict");
const test = require("node:test");

const { loadPopup } = require("./helpers/load-extension-scripts.js");

// Lets pending messages, storage writes and change events finish.
const settle = () => new Promise((resolve) => setImmediate(resolve));
const proxy = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user", password: "secret" };
const challenge = { requestId: "r", isProxy: true, challenger: { host: "1.2.3.4", port: 8080 } };

function flip(toggle, checked) {
  toggle.checked = checked;
  toggle.dispatch("change");
}

test("first open shows the disclaimer and keeps the switch locked until it is accepted", async () => {
  const { chrome, $ } = loadPopup();
  await settle();

  assert.equal($("disclaimerSection").hidden, false);
  assert.equal($("mainSection").hidden, true);
  assert.equal($("proxyToggle").disabled, true);
  assert.equal($("acceptButton").disabled, true);
  assert.match($("versionLabel").textContent, /^Version \d+\.\d+\.\d+$/);

  // Enter does nothing while the switch is locked.
  $("proxyInput").value = "proxy.example.com:8080";
  assert.equal($("proxyInput").dispatch("keydown", { key: "Enter" }).defaultPrevented, false);

  $("disclaimerCheckbox").checked = true;
  $("disclaimerCheckbox").dispatch("change");
  assert.equal($("acceptButton").disabled, false);

  $("acceptButton").dispatch("click");
  await settle();

  assert.equal(chrome.storage.local.data.disclaimerAccepted, true);
  assert.equal(chrome.storage.local.data.active, undefined);
  assert.equal($("disclaimerSection").hidden, true);
  assert.equal($("mainSection").hidden, false);
  assert.equal($("proxyToggle").disabled, false);
});

test("the switch connects the pasted proxy, shows it, and turns it off again", async () => {
  const { chrome, $ } = loadPopup({ local: { disclaimerAccepted: true } });
  await settle();

  $("proxyInput").value = "user:secret@proxy.example.com:8080";
  flip($("proxyToggle"), true);
  assert.equal($("proxyToggle").disabled, true, "locked while the command runs");
  await settle();

  assert.equal(chrome.storage.local.data.active, true);
  assert.equal($("statusText").textContent, "Connected · http://proxy.example.com:8080");
  assert.match($("statusDot").className, /dot-on/);
  assert.equal($("proxyInput").value, "http://user:secret@proxy.example.com:8080");
  assert.equal($("proxyToggle").checked, true);
  assert.equal($("proxyToggle").disabled, false);

  flip($("proxyToggle"), false);
  await settle();

  assert.equal(chrome.storage.local.data.active, false);
  assert.equal($("statusText").textContent, "Off");
  assert.equal($("proxyInput").value, "http://user:secret@proxy.example.com:8080");
});

test("invalid input snaps the switch back and explains why until the user types", async () => {
  const { chrome, $ } = loadPopup({ local: { disclaimerAccepted: true } });
  await settle();

  $("proxyInput").value = "socks5://127.0.0.1:1080";
  flip($("proxyToggle"), true);
  await settle();

  assert.equal($("proxyToggle").checked, false);
  assert.equal($("errorMessage").hidden, false);
  assert.match($("errorMessage").textContent, /only HTTP and HTTPS/);
  assert.deepEqual(chrome.calls, []);

  $("proxyInput").dispatch("input");
  assert.equal($("errorMessage").hidden, true);
});

test("Enter in the proxy field turns the proxy on", async () => {
  const { chrome, $ } = loadPopup({ local: { disclaimerAccepted: true } });
  await settle();

  $("proxyInput").value = "proxy.example.com:8080";
  assert.equal($("proxyInput").dispatch("keydown", { key: "Enter" }).defaultPrevented, true);
  await settle();

  assert.equal(chrome.storage.local.data.active, true);
  assert.equal($("proxyToggle").checked, true);
});

test("Forget saved data needs a second click within a few seconds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const { chrome, $ } = loadPopup({ local: { disclaimerAccepted: true, active: true, proxy } });
  await settle();
  const forget = $("forgetButton");

  forget.dispatch("click");
  assert.equal(forget.textContent, "Click again to confirm");
  t.mock.timers.tick(4_000);
  assert.equal(forget.textContent, "Forget saved data");
  assert.deepEqual(chrome.storage.local.data.proxy, proxy);

  forget.dispatch("click");
  forget.dispatch("click");
  await settle();

  assert.deepEqual({ ...chrome.storage.local.data }, {});
  assert.equal(forget.textContent, "Forget saved data");
  assert.equal($("proxyInput").value, "");
  assert.equal($("disclaimerSection").hidden, false);
  assert.equal($("mainSection").hidden, true);
  assert.equal($("proxyToggle").disabled, true);
  assert.equal($("disclaimerCheckbox").checked, false);
  assert.equal($("acceptButton").disabled, true);
});

test("the popup follows the background turning the proxy off, without wiping what the user typed", async () => {
  const { $, auth } = loadPopup({ local: { disclaimerAccepted: true, active: true, proxy } });
  await settle();

  assert.equal($("proxyInput").value, "http://user:secret@proxy.example.com:8080");
  assert.equal($("proxyToggle").checked, true);

  $("proxyInput").value = "new.example.com:9090";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await auth(challenge);
  }
  await settle();

  assert.equal($("proxyToggle").checked, false);
  assert.equal($("statusText").textContent, "Off");
  assert.match($("statusDot").className, /dot-error/);
  assert.match($("errorMessage").textContent, /authentication failed/);
  assert.equal($("proxyInput").value, "new.example.com:9090");
});
