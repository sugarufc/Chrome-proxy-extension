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
function createStorageArea(initial = {}) {
  const data = { ...initial };
  const keysOf = (keys) => (keys == null ? Object.keys(data) : [].concat(keys));

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
      Object.assign(data, values);
    },
    async remove(keys) {
      for (const key of [].concat(keys)) {
        delete data[key];
      }
    },
    async clear() {
      for (const key of Object.keys(data)) {
        delete data[key];
      }
    },
  };
}

function createChromeMock({
  local = {},
  session = {},
  levelOfControl = "controlled_by_this_extension",
  setError = "",
} = {}) {
  const calls = [];
  const settingsCall = (name, error) => (details, callback) => {
    calls.push({ name, details });
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
    runtime: { lastError: null, onInstalled: createEvent(), onMessage: createEvent(), onStartup: createEvent() },
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
    storage: { local: createStorageArea(local), session: { ...createStorageArea(session) } },
    webRequest: { onAuthRequired: createEvent() },
  };
  return chrome;
}

function loadScripts(files, chrome) {
  const context = { chrome, URL };
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

module.exports = { loadBackground, loadScripts, createChromeMock };
