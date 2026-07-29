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
  assert.equal(manifest.version, "3.2.0");
});

test("manifest version is newer than the last Chrome Web Store package", () => {
  const manifest = readJson("manifest.json");
  const versionParts = manifest.version.split(".").map(Number);
  const lastStoreVersionParts = [3, 1, 6];

  const isNewer = versionParts.some(
    (part, index) =>
      part > lastStoreVersionParts[index] &&
      versionParts
        .slice(0, index)
        .every((earlierPart, earlierIndex) => earlierPart === lastStoreVersionParts[earlierIndex]),
  );

  assert.equal(isNewer, true, `Manifest version ${manifest.version} must be newer than Chrome Web Store version 3.1.6`);
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
  assert.deepEqual(manifest.host_permissions, ["<all_urls>"]);
});

test("manifest declares the proxy toggle keyboard command", () => {
  const manifest = readJson("manifest.json");

  assert.ok(manifest.commands && manifest.commands["toggle-proxy"]);
  assert.ok(manifest.commands["toggle-proxy"].suggested_key.default);
});
