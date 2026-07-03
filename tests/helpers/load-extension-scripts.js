const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const rootDir = path.resolve(__dirname, "../..");

function readRuntimeFile(fileName) {
  return fs.readFileSync(path.join(rootDir, fileName), "utf8");
}

function createStorageArea(initial = {}) {
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
    get(keys, callback) {
      callback(select(keys));
    },
    set(values, callback = () => {}) {
      Object.assign(data, values);
      callback();
    },
    remove(keys, callback = () => {}) {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
      callback();
    },
    clear(callback = () => {}) {
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

function createChromeMock({ local = {}, session = {} } = {}) {
  return {
    storage: {
      local: createStorageArea(local),
      session: createStorageArea(session),
    },
  };
}

function createRuntimeContext(options = {}) {
  const chrome = options.chrome || createChromeMock();
  const context = {
    chrome,
    URL,
  };

  vm.createContext(context);
  vm.runInContext(readRuntimeFile("shared.js"), context, { filename: "shared.js" });

  if (options.includeStorage !== false) {
    vm.runInContext(readRuntimeFile("storage-manager.js"), context, { filename: "storage-manager.js" });
  }

  return context;
}

module.exports = {
  createChromeMock,
  createRuntimeContext,
};
