const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function readRuntimeFile(fileName) {
  return fs.readFileSync(path.join(rootDir, fileName), "utf8");
}

function createEventMock() {
  const listeners = [];

  return {
    listeners,
    addListener(listener, filter, extraInfoSpec) {
      listeners.push({ listener, filter, extraInfoSpec });
    },
  };
}

function createStorageArea(initial = {}, areaName = "storage", operationLog = []) {
  const data = { ...initial };

  function select(keys) {
    if (keys == null) {
      return { ...data };
    }

    if (Array.isArray(keys)) {
      return keys.reduce((result, key) => {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          result[key] = data[key];
        }
        return result;
      }, {});
    }

    if (typeof keys === "string") {
      return Object.prototype.hasOwnProperty.call(data, keys) ? { [keys]: data[keys] } : {};
    }

    return Object.keys(keys).reduce((result, key) => {
      result[key] = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : keys[key];
      return result;
    }, {});
  }

  return {
    data,
    getCalls: [],
    setCalls: [],
    removeCalls: [],
    clearCalls: 0,
    get(keys, callback) {
      this.getCalls.push(keys);
      callback(select(keys));
    },
    set(values, callback = () => {}) {
      this.setCalls.push(values);
      operationLog.push(`${areaName}.set`);
      Object.assign(data, values);
      callback();
    },
    remove(keys, callback = () => {}) {
      this.removeCalls.push(keys);
      operationLog.push(`${areaName}.remove`);
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
      callback();
    },
    clear(callback = () => {}) {
      this.clearCalls += 1;
      operationLog.push(`${areaName}.clear`);
      for (const key of Object.keys(data)) {
        delete data[key];
      }
      callback();
    },
    setAccessLevel(_options, callback = () => {}) {
      callback();
    },
  };
}

function createChromeMock({
  local = {},
  session = {},
  proxyLevelOfControl = "controlled_by_this_extension",
  proxySetError = "",
  proxyClearError = "",
  proxyGetError = "",
} = {}) {
  const operationLog = [];
  const chrome = {
    operationLog,
    action: {
      badgeTextCalls: [],
      badgeBackgroundColorCalls: [],
      iconCalls: [],
      titleCalls: [],
      setBadgeText(value) {
        this.badgeTextCalls.push(value);
      },
      setBadgeBackgroundColor(value) {
        this.badgeBackgroundColorCalls.push(value);
      },
      setIcon(value) {
        this.iconCalls.push(value);
      },
      setTitle(value) {
        this.titleCalls.push(value);
      },
    },
    commands: {
      onCommand: createEventMock(),
    },
    runtime: {
      lastError: null,
      onInstalled: createEventMock(),
      onMessage: createEventMock(),
      onStartup: createEventMock(),
    },
    proxy: {
      onProxyError: createEventMock(),
      settings: {
        setCalls: [],
        clearCalls: [],
        getCalls: [],
        set(value, callback = () => {}) {
          this.setCalls.push(value);
          operationLog.push("proxy.settings.set");
          chrome.runtime.lastError = proxySetError ? { message: proxySetError } : null;
          callback();
          chrome.runtime.lastError = null;
        },
        clear(value, callback = () => {}) {
          this.clearCalls.push(value);
          operationLog.push("proxy.settings.clear");
          chrome.runtime.lastError = proxyClearError ? { message: proxyClearError } : null;
          callback();
          chrome.runtime.lastError = null;
        },
        get(value, callback = () => {}) {
          this.getCalls.push(value);
          operationLog.push("proxy.settings.get");
          chrome.runtime.lastError = proxyGetError ? { message: proxyGetError } : null;
          callback({ levelOfControl: proxyLevelOfControl });
          chrome.runtime.lastError = null;
        },
      },
    },
    storage: {
      local: createStorageArea(local, "storage.local", operationLog),
      session: createStorageArea(session, "storage.session", operationLog),
    },
    webRequest: {
      onAuthRequired: createEventMock(),
      onCompleted: createEventMock(),
      onErrorOccurred: createEventMock(),
    },
  };

  return chrome;
}

function createRuntimeContext(options = {}) {
  const chrome = options.chrome || createChromeMock();
  const context = {
    AbortController,
    chrome,
    clearTimeout,
    fetch: options.fetch,
    setTimeout,
    URL,
  };

  vm.createContext(context);
  vm.runInContext(readRuntimeFile("shared.js"), context, { filename: "shared.js" });

  if (options.includeStorage !== false) {
    vm.runInContext(readRuntimeFile("storage-manager.js"), context, { filename: "storage-manager.js" });
  }

  if (options.includeBackground === true) {
    context.importScripts = (...fileNames) => {
      for (const fileName of fileNames) {
        vm.runInContext(readRuntimeFile(fileName), context, { filename: fileName });
      }
    };
    vm.runInContext(readRuntimeFile("background.js"), context, { filename: "background.js" });
  }

  return context;
}

module.exports = {
  createChromeMock,
  createRuntimeContext,
};
