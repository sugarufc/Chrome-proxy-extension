const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function readRuntimeFile(fileName) {
  return fs.readFileSync(path.join(rootDir, fileName), "utf8");
}

// node --test counts coverage only for scripts named by a file: URL.
function runRuntimeFile(fileName, context) {
  vm.runInContext(readRuntimeFile(fileName), context, { filename: pathToFileURL(path.join(rootDir, fileName)).href });
}

function createEvent() {
  const listeners = [];
  return { listeners, addListener: (listener, filter, extra) => listeners.push({ listener, filter, extra }) };
}

// Promise-based storage area like chrome.storage.* in Manifest V3.
// Like Chrome, it reports changes to chrome.storage.onChanged after the write has finished.
function createStorageArea(initial = {}, onChanged = createEvent()) {
  const data = { ...initial };
  const keysOf = (keys) => (keys == null ? Object.keys(data) : [].concat(keys));
  const write = (update) => {
    const before = { ...data };
    update();
    const changes = {};
    for (const key of new Set([...Object.keys(before), ...Object.keys(data)])) {
      if (before[key] !== data[key]) {
        changes[key] = { oldValue: before[key], newValue: data[key] };
      }
    }
    if (Object.keys(changes).length) {
      Promise.resolve().then(() => onChanged.listeners.forEach(({ listener }) => listener(changes, "local")));
    }
  };

  return {
    data,
    async get(keys) {
      return Object.fromEntries(
        keysOf(keys)
          .filter((key) => key in data)
          .map((key) => [key, data[key]]),
      );
    },
    async set(values) {
      write(() => Object.assign(data, values));
    },
    async remove(keys) {
      write(() => [].concat(keys).forEach((key) => delete data[key]));
    },
    async clear() {
      write(() => Object.keys(data).forEach((key) => delete data[key]));
    },
  };
}

function createChromeMock({
  local = {},
  session = {},
  levelOfControl = "controlled_by_this_extension",
  setError = "",
  hang = "",
} = {}) {
  const calls = [];
  const onChanged = createEvent();
  const settingsCall = (name, error) => (details, callback) => {
    calls.push({ name, details });
    if (name === hang) {
      return; // Simulates a Chrome API that never answers.
    }
    chrome.runtime.lastError = error ? { message: error } : null;
    callback(name === "get" ? { levelOfControl: chrome.proxy.levelOfControl } : undefined);
    chrome.runtime.lastError = null;
  };

  const chrome = {
    calls,
    action: {
      badge: [],
      title: [],
      icons: [],
      setBadgeText: (value) => chrome.action.badge.push(value.text),
      setBadgeBackgroundColor() {},
      setTitle: (value) => chrome.action.title.push(value.title),
      setIcon: (value) => chrome.action.icons.push(value.path[16]),
    },
    commands: { onCommand: createEvent() },
    runtime: {
      lastError: null,
      onInstalled: createEvent(),
      onMessage: createEvent(),
      onStartup: createEvent(),
      getManifest: () => JSON.parse(readRuntimeFile("manifest.json")),
      // The popup talks to background.js loaded against the same mock.
      sendMessage: (message, callback) => chrome.runtime.onMessage.listeners[0].listener(message, {}, callback),
    },
    proxy: {
      // Tests change this to simulate another extension or a policy taking over.
      levelOfControl,
      settings: {
        set: settingsCall("set", setError),
        get: settingsCall("get"),
        clear: settingsCall("clear"),
        onChange: createEvent(),
      },
    },
    storage: { onChanged, local: createStorageArea(local, onChanged), session: createStorageArea(session) },
    webRequest: { onAuthRequired: createEvent() },
  };
  return chrome;
}

function loadScripts(files, chrome, globals = {}) {
  // Timers are looked up on each call so that node:test mock timers apply.
  const context = {
    chrome,
    URL,
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (...args) => clearTimeout(...args),
    ...globals,
  };
  vm.createContext(context);
  context.importScripts = (...names) => names.forEach((name) => runRuntimeFile(name, context));
  files.forEach((name) => runRuntimeFile(name, context));
  return context;
}

// Loads background.js against a fake chrome and returns helpers to drive it.
function loadBackground(options = {}) {
  const chrome = createChromeMock(options);
  const context = loadScripts(["background.js"], chrome);
  const [{ listener: onMessage }] = chrome.runtime.onMessage.listeners;
  const [{ listener: onAuth }] = chrome.webRequest.onAuthRequired.listeners;

  return {
    chrome,
    context,
    send: (message) => new Promise((resolve) => onMessage(message, {}, resolve)),
    auth: (details) => new Promise((resolve) => onAuth(details, resolve)),
    fire: (event) => chrome[event.split(".")[0]][event.split(".")[1]].listeners[0].listener(),
  };
}

// Just enough DOM for popup.js: the elements with an id in popup.html and their events.
class FakeElement {
  constructor(id, attributes) {
    const flags = new Set(attributes.replace(/"[^"]*"/g, '""').split(/[\s/]+/));
    this.id = id;
    this.hidden = flags.has("hidden");
    this.disabled = flags.has("disabled");
    this.checked = false;
    this.value = "";
    this.textContent = "";
    this.className = (attributes.match(/\bclass="([^"]*)"/) || [])[1] || "";
    this.listeners = {};
  }

  addEventListener(type, listener) {
    (this.listeners[type] = this.listeners[type] || []).push(listener);
  }

  dispatch(type, props = {}) {
    const event = { type, target: this, defaultPrevented: false, ...props };
    event.preventDefault = () => {
      event.defaultPrevented = true;
    };
    (this.listeners[type] || []).forEach((listener) => listener(event));
    return event;
  }
}

function createDocument() {
  const elements = new Map();
  for (const [, attributes] of readRuntimeFile("popup.html").matchAll(/<[a-z0-9]+\s([^>]*\bid="[^"]+"[^>]*)>/gi)) {
    const id = attributes.match(/\bid="([^"]+)"/)[1];
    elements.set(id, new FakeElement(id, attributes));
  }
  return { elements, getElementById: (id) => elements.get(id) || null };
}

// Loads background.js and the popup against one fake chrome, like an opened popup.
function loadPopup(options = {}) {
  const background = loadBackground(options);
  const document = createDocument();
  loadScripts(["popup.js"], background.chrome, { document });
  return { ...background, document, $: (id) => document.getElementById(id) };
}

module.exports = { loadBackground, loadPopup, loadScripts, createChromeMock };
