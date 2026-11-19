const extensionGlobals = {
  chrome: "readonly",
  clearTimeout: "readonly",
  globalThis: "readonly",
  setTimeout: "readonly",
  URL: "readonly",
};

export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "store-assets/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  // Extension code runs in Chrome: no Node globals there.
  {
    files: ["shared.js"],
    languageOptions: { globals: extensionGlobals },
  },
  {
    files: ["background.js"],
    languageOptions: { globals: { ...extensionGlobals, importScripts: "readonly", ProxyShared: "readonly" } },
  },
  {
    files: ["popup.js"],
    languageOptions: { globals: { ...extensionGlobals, document: "readonly" } },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        clearTimeout: "readonly",
        module: "readonly",
        require: "readonly",
        setImmediate: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
  },
];
