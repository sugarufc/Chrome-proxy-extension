export default [
  {
    ignores: ["dist/**", "node_modules/**", "coverage/**", "store-assets/**"],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        AbortController: "readonly",
        chrome: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        fetch: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        importScripts: "readonly",
        module: "readonly",
        ProxyShared: "readonly",
        ProxyStorage: "readonly",
        require: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
];
