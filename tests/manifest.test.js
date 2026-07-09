const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, fileName), "utf8"));
}

test("manifest CSP allows connections only to the connection test endpoint", () => {
  const manifest = readJson("manifest.json");
  const csp = manifest.content_security_policy.extension_pages;

  // The extension_pages CSP also governs the MV3 service worker, so the
  // testConnection fetch needs an explicit connect-src allowance.
  assert.match(csp, /connect-src https:\/\/www\.gstatic\.com(;|$)/);
  assert.doesNotMatch(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /object-src 'self'/);
});

test("manifest version stays in sync with package.json", () => {
  const manifest = readJson("manifest.json");
  const packageJson = readJson("package.json");

  assert.equal(manifest.version, packageJson.version);
});

test("manifest requests only the permissions the extension uses", () => {
  const manifest = readJson("manifest.json");

  assert.deepEqual(manifest.permissions.sort(), ["proxy", "storage", "webRequest", "webRequestAuthProvider"]);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("manifest declares the proxy toggle keyboard command", () => {
  const manifest = readJson("manifest.json");

  assert.ok(manifest.commands && manifest.commands["toggle-proxy"]);
  assert.ok(manifest.commands["toggle-proxy"].suggested_key.default);
});
