const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const rootDir = path.resolve(__dirname, "..");

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, fileName), "utf8"));
}

test("manifest CSP allows only the extension's own code and no network access", () => {
  const csp = readJson("manifest.json").content_security_policy.extension_pages;

  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp, /connect-src|unsafe|https?:/);
});

test("manifest version stays in sync with package.json", () => {
  const manifest = readJson("manifest.json");
  const packageJson = readJson("package.json");

  assert.equal(manifest.version, packageJson.version);
  assert.equal(manifest.version, "4.0.0");
});

test("manifest requires Chrome 108 or newer", () => {
  const manifest = readJson("manifest.json");

  assert.equal(manifest.minimum_chrome_version, "108");
});

test("manifest advertises only HTTP and HTTPS proxies", () => {
  const manifest = readJson("manifest.json");

  assert.match(manifest.description, /HTTP.*HTTPS/);
  assert.doesNotMatch(manifest.description, /SOCKS/i);
});

test("manifest requests only the permissions the extension uses", () => {
  const manifest = readJson("manifest.json");

  assert.deepEqual(manifest.permissions.sort(), ["proxy", "storage", "webRequest", "webRequestAuthProvider"]);
  assert.equal(manifest.optional_permissions, undefined);
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("manifest declares the proxy toggle keyboard command", () => {
  const manifest = readJson("manifest.json");

  assert.ok(manifest.commands && manifest.commands["toggle-proxy"]);
  assert.ok(manifest.commands["toggle-proxy"].suggested_key.default);
});
