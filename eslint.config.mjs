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
        chrome: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        globalThis: "readonly",
        __dirname: "readonly",
        importScripts: "readonly",
        module: "readonly",
        ProxyShared: "readonly",
        require: "readonly",
        setTimeout: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
];
