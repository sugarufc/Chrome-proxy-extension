# Remove SOCKS5 From Proxy Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome extension support only HTTP and HTTPS while preserving the VPS SOCKS5 service for Telegram and other clients.

**Architecture:** Reject SOCKS5 at the shared parser/profile boundary, remove its popup affordances, and migrate persisted extension state before session restoration. The migration reports when an active SOCKS5 configuration was removed so Chrome's effective proxy setting can also be cleared.

**Tech Stack:** Manifest V3 JavaScript, Chrome Proxy/WebRequest/Storage APIs, Node.js built-in test runner, ESLint, Prettier.

## Global Constraints

- The change affects only `/Users/aslan/Documents/Codex/Chrome proxy extension`.
- Do not remove or reconfigure the SOCKS5 listener on the VPS.
- Do not change HTTP/HTTPS behavior.
- Preserve existing uncommitted parser and diagnostic fixes.
- Do not add dependencies or edit lock files.
- Do not commit, push, publish, or deploy without explicit user authorization.

---

### Task 1: Restrict runtime proxy schemes to HTTP and HTTPS

**Files:**
- Modify: `tests/shared.test.js`
- Modify: `tests/message-protocol.test.js`
- Modify: `shared.js`
- Modify: `background.js`

**Interfaces:**
- Consumes: `parseProxyUrl(input)`, `parseProxyInput(input)`, and `buildProfileFromFields(profile)`.
- Produces: the same interfaces, restricted to `http` and `https`; background connection messages reject any other scheme before changing Chrome settings.

- [ ] **Step 1: Write failing tests for SOCKS5 rejection**

```js
assert.throws(() => parseProxyUrl("socks5://127.0.0.1:1080"), /only HTTP and HTTPS/);
assert.throws(
  () => buildProfileFromFields({ scheme: "socks5", host: "127.0.0.1", port: 1080 }),
  /only HTTP and HTTPS/,
);

const response = await sendBackgroundMessage(chrome, {
  command: "connect",
  profile: { scheme: "socks5", host: "127.0.0.1", port: 1080, username: "" },
  password: "",
});
assert.equal(response.ok, false);
assert.match(response.error, /only HTTP and HTTPS/);
assert.equal(chrome.proxy.settings.setCalls.length, 0);
```

Remove old test cases that expect SOCKS5 parsing, formatting, or credential validation to succeed.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/shared.test.js tests/message-protocol.test.js`

Expected: FAIL because SOCKS5 is still in `SUPPORTED_SCHEMES` and the background accepts an unauthenticated SOCKS5 profile.

- [ ] **Step 3: Implement the scheme restriction**

In `shared.js`:

```js
const SUPPORTED_SCHEMES = new Set(["http", "https"]);
```

Use one consistent validation message:

```js
throw new Error("Unsupported proxy scheme. This extension supports only HTTP and HTTPS.");
```

Delete `SCHEMES_REQUIRING_AUTH`, `SCHEMES_WITHOUT_EXTENSION_AUTH`, `validateChromeProxySupport`, its export, and the SOCKS-specific error hint. In `background.js`, remove the import and call to `validateChromeProxySupport`; `buildProfileFromFields` remains the connection boundary.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/shared.test.js tests/message-protocol.test.js`

Expected: all focused tests pass.

- [ ] **Step 5: Review the focused diff**

Run: `git diff --check -- shared.js background.js tests/shared.test.js tests/message-protocol.test.js`

Expected: no whitespace errors and no unrelated changes.

---

### Task 2: Remove SOCKS5 from the popup and extension metadata

**Files:**
- Modify: `tests/message-protocol.test.js`
- Modify: `tests/manifest.test.js`
- Modify: `popup.html`
- Modify: `popup.js`
- Modify: `manifest.json`

**Interfaces:**
- Consumes: the HTTP/HTTPS-only parser from Task 1.
- Produces: a popup with no SOCKS5 notice or event path and metadata describing only HTTP/HTTPS support.

- [ ] **Step 1: Write failing source-level UI and manifest tests**

```js
test("popup does not advertise or handle SOCKS5", () => {
  const popupHtml = fs.readFileSync(path.join(rootDir, "popup.html"), "utf8");
  const popupSource = fs.readFileSync(path.join(rootDir, "popup.js"), "utf8");

  assert.doesNotMatch(popupHtml, /socks5/i);
  assert.doesNotMatch(popupSource, /socks5/i);
});

test("manifest advertises only HTTP and HTTPS proxies", () => {
  assert.match(manifest.description, /HTTP.*HTTPS/);
  assert.doesNotMatch(manifest.description, /SOCKS/i);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test tests/message-protocol.test.js tests/manifest.test.js`

Expected: FAIL because the popup notice, popup handler, and manifest still mention SOCKS5.

- [ ] **Step 3: Remove the popup affordance and update copy**

Delete `socks5AuthNotice`, `updateSocks5Notice()`, and every invocation of that function from `popup.js`. Delete the notice paragraph from `popup.html`, and change helper copy to:

```html
<p class="helper-text">
  Any common format works: <code>scheme://user:pass@host:port</code>, <code>host:port</code>, or
  <code>host:port:user:pass</code>. HTTP and HTTPS.
</p>
```

Change the manifest description to:

```json
"description": "Chrome proxy switcher for user-provided HTTP and HTTPS proxies."
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `node --test tests/message-protocol.test.js tests/manifest.test.js`

Expected: all focused tests pass.

---

### Task 3: Migrate saved SOCKS5 profiles safely

**Files:**
- Modify: `tests/storage-manager.test.js`
- Modify: `storage-manager.js`
- Modify: `background.js`

**Interfaces:**
- Produces: `cleanupUnsupportedProfiles(): Promise<{ removedActiveProxy: boolean }>`.
- Changes: `cleanupLegacySecrets()` returns the same result after legacy migration and cleanup.
- Consumes: `restoreProxyForCurrentSession()` clears Chrome proxy settings when `removedActiveProxy` is true.

- [ ] **Step 1: Replace the obsolete SOCKS5 save fixture and add a failing migration test**

Use an HTTP no-password profile in the existing `saveConnection without a password` test. Add:

```js
test("cleanup removes SOCKS5 profiles and disconnects an active SOCKS5 proxy", async () => {
  const httpProfile = {
    id: "http-profile",
    name: "HTTPS proxy",
    scheme: "https",
    host: "proxy.example.com",
    port: 443,
    username: "user",
  };
  const socksProfile = {
    id: "socks-profile",
    name: "Legacy SOCKS",
    scheme: "socks5",
    host: "127.0.0.1",
    port: 1080,
    username: "user",
  };
  const { chrome, storage } = createStorage(
    {
      active: true,
      proxyProfiles: [socksProfile, httpProfile],
      selectedProfileId: "socks-profile",
      activeProfileId: "socks-profile",
      proxyProfile: socksProfile,
      activeProxy: socksProfile,
      savedPassword: "secret",
    },
    { sessionConnected: true, sessionPassword: "secret" },
  );

  const result = await storage.cleanupLegacySecrets();

  assert.deepEqual(plain(chrome.storage.local.data.proxyProfiles), [httpProfile]);
  assert.equal(chrome.storage.local.data.selectedProfileId, "http-profile");
  assert.equal(chrome.storage.local.data.proxyProfile.scheme, "https");
  assert.equal(chrome.storage.local.data.active, false);
  assert.equal(chrome.storage.local.data.activeProxy, undefined);
  assert.equal(chrome.storage.local.data.savedPassword, undefined);
  assert.deepEqual(plain(chrome.storage.session.data), {});
  assert.deepEqual(plain(result), { removedActiveProxy: true });
});
```

- [ ] **Step 2: Run the migration test and verify RED**

Run: `node --test --test-name-pattern='cleanup removes SOCKS5' tests/storage-manager.test.js`

Expected: FAIL because unsupported stored profiles are not filtered.

- [ ] **Step 3: Implement storage cleanup before profile normalization**

Add a raw-record check that does not call the HTTP/HTTPS-only field validator:

```js
function isSupportedStoredProfile(profile) {
  const scheme = String(profile?.scheme || "").toLowerCase();
  return scheme === "http" || scheme === "https";
}
```

Implement `cleanupUnsupportedProfiles()` so it:

1. Filters `proxyProfiles` to supported records.
2. Repoints `selectedProfileId` and `proxyProfile` to the first remaining profile when the selected profile was removed.
3. Detects an active unsupported `activeProxy` (or unsupported `proxyProfile` for legacy active state).
4. For an active unsupported proxy, clears session state, sets `active: false`, clears `activeProfileId`, and removes `activeProxy`, `savedPassword`, and stale parsed/error state.
5. Returns `{ removedActiveProxy }`.

Call it at the start of `cleanupLegacySecrets()` before `migrateProxyProfileToProfiles()`, then return its result. Export it through `ProxyStorage` for direct tests.

- [ ] **Step 4: Clear Chrome's effective proxy setting during restore**

```js
async function migrateLegacyStorage() {
  return ProxyStorage.cleanupLegacySecrets();
}

async function restoreProxyForCurrentSession() {
  const { removedActiveProxy } = await migrateLegacyStorage();
  if (removedActiveProxy) {
    await proxySettingsClear();
  }
  // Existing HTTP/HTTPS restore flow follows.
}
```

Remove the duplicate direct `cleanupLegacySecrets()` call from `onInstalled`; `restoreProxyForCurrentSession()` remains the single migration/restore path after storage access is configured.

- [ ] **Step 5: Run storage and background tests**

Run: `node --test tests/storage-manager.test.js tests/background.test.js`

Expected: all storage and restore tests pass, including the new migration case.

---

### Task 4: Update documentation and verify the complete extension

**Files:**
- Modify: `README.md`
- Modify: `STORE_LISTING.md`
- Modify: `RELEASE_NOTES.md`
- Verify: all runtime, test, and build files

**Interfaces:**
- Consumes: completed HTTP/HTTPS-only runtime and migration behavior.
- Produces: consistent documentation and a rebuilt distributable ZIP.

- [ ] **Step 1: Remove obsolete SOCKS5 documentation**

Change positioning text from `HTTP/HTTPS/SOCKS5` to `HTTP/HTTPS`, remove the README SOCKS5 workaround section, remove SOCKS5 from supported types and single-purpose copy in `STORE_LISTING.md`, and add:

```markdown
## Unreleased

- Removed SOCKS5 from the Chrome extension because authenticated SOCKS5 is not supported by Chrome extensions.
- Existing SOCKS5 profiles are removed during extension migration; HTTP/HTTPS profiles are preserved.
```

- [ ] **Step 2: Verify no product/runtime copy advertises SOCKS5**

Run: `rg -n "SOCKS5|socks5" shared.js background.js storage-manager.js popup.html popup.js manifest.json README.md STORE_LISTING.md`

Expected: only intentional storage-migration identifiers or comments remain; no parser, popup, manifest, README, or store copy advertises support.

- [ ] **Step 3: Run the complete automated checks**

```bash
npm test
npm run lint
npm run format
git diff --check
```

Expected: all tests pass, lint and format pass, and the diff has no whitespace errors.

- [ ] **Step 4: Build and inspect the distributable**

```bash
npm run build
unzip -p dist/proxy-switcher.zip manifest.json
unzip -p dist/proxy-switcher.zip popup.html | rg -n "SOCKS5|socks5"
```

Expected: build succeeds, manifest describes HTTP/HTTPS only, and the popup archive contains no SOCKS5 text.

- [ ] **Step 5: Review final scope**

```bash
git status --short
git diff --stat
git diff -- shared.js background.js storage-manager.js popup.html popup.js manifest.json README.md STORE_LISTING.md RELEASE_NOTES.md tests
```

Expected: only approved extension files plus the spec/plan and previous diagnostic fixes are changed; no server workspace files are modified.
