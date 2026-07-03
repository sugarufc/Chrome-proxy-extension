const assert = require("node:assert/strict");
const test = require("node:test");

const { createRuntimeContext } = require("./helpers/load-extension-scripts.js");

function shared() {
  return createRuntimeContext({ includeStorage: false }).ProxyShared;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("parseProxyUrl accepts supported proxy URLs with and without credentials", () => {
  const { parseProxyUrl } = shared();

  assert.deepEqual(plain(parseProxyUrl(" http://user:pass@example.com:8080 ")), {
    scheme: "http",
    username: "user",
    password: "pass",
    host: "example.com",
    port: 8080,
  });

  assert.deepEqual(plain(parseProxyUrl("https://proxy.example.com:8443")), {
    scheme: "https",
    username: "",
    password: "",
    host: "proxy.example.com",
    port: 8443,
  });

  assert.deepEqual(plain(parseProxyUrl("socks5://127.0.0.1:1080")), {
    scheme: "socks5",
    username: "",
    password: "",
    host: "127.0.0.1",
    port: 1080,
  });
});

test("parseProxyUrl decodes URL-encoded password characters and rejects raw reserved characters", () => {
  const { parseProxyUrl } = shared();

  assert.equal(parseProxyUrl("http://user:pa%40ss%3Aword%2Fok%23x%3Fy@example.com:8080").password, "pa@ss:word/ok#x?y");
  assert.throws(() => parseProxyUrl("http://user:pa@ss@example.com:8080"), /URL-encode/);
  assert.throws(() => parseProxyUrl("http://user:pa:ss@example.com:8080"), /URL-encode/);
});

test("parseProxyUrl validates required fields and port boundaries", () => {
  const { parseProxyUrl } = shared();

  assert.equal(parseProxyUrl("http://u:p@example.com:1").port, 1);
  assert.equal(parseProxyUrl("http://u:p@example.com:65535").port, 65535);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:0"), /port/);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:66000"), /port/);
  assert.throws(() => parseProxyUrl("ftp://u:p@example.com:21"), /Unsupported proxy scheme/);
  assert.throws(() => parseProxyUrl("http://u:p@:8080"), /Invalid proxy URL|host/);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:8080/path"), /must not include path/);
});

test("buildProfileFromFields normalizes valid fields and rejects invalid profile values", () => {
  const { buildProfileFromFields } = shared();

  assert.deepEqual(
    plain(
      buildProfileFromFields({
        scheme: " HTTPS ",
        host: " proxy.example.com ",
        port: "443",
        username: " user ",
      }),
    ),
    {
      scheme: "https",
      host: "proxy.example.com",
      port: 443,
      username: "user",
    },
  );

  assert.throws(() => buildProfileFromFields({ scheme: "ftp", host: "example.com", port: 21 }), /supported proxy type/);
  assert.throws(() => buildProfileFromFields({ scheme: "http", host: "", port: 8080 }), /host is required/);
  assert.throws(() => buildProfileFromFields({ scheme: "http", host: "example.com", port: 0 }), /port/);
});

test("validatePasswordForProfile enforces password only when username is present", () => {
  const { validatePasswordForProfile } = shared();

  assert.doesNotThrow(() => validatePasswordForProfile({ scheme: "http", username: "" }, ""));
  assert.doesNotThrow(() => validatePasswordForProfile({ scheme: "http", username: "user" }, "pass"));
  assert.throws(() => validatePasswordForProfile({ scheme: "http", username: "user" }, ""), /Password is required/);
  assert.throws(() => validatePasswordForProfile(null, "pass"), /incomplete/);
});

test("validateChromeProxySupport blocks SOCKS5 credentials but allows SOCKS5 without auth", () => {
  const { validateChromeProxySupport } = shared();

  assert.doesNotThrow(() => validateChromeProxySupport({ scheme: "socks5", username: "" }, ""));
  assert.throws(
    () => validateChromeProxySupport({ scheme: "socks5", username: "user" }, ""),
    /cannot authenticate SOCKS5/,
  );
  assert.throws(
    () => validateChromeProxySupport({ scheme: "socks5", username: "" }, "pass"),
    /cannot authenticate SOCKS5/,
  );
  assert.doesNotThrow(() => validateChromeProxySupport({ scheme: "http", username: "user" }, "pass"));
});

test("sanitizeErrorMessage redacts URLs, credentials, and auth headers", () => {
  const { sanitizeErrorMessage } = shared();
  const sanitized = sanitizeErrorMessage(
    "Failed http://user:secret@example.com:8080 password=secret Proxy-Authorization: Basic abc Authorization=Bearer token",
  );

  assert.doesNotMatch(sanitized, /secret/);
  assert.doesNotMatch(sanitized, /Basic abc/);
  assert.doesNotMatch(sanitized, /Bearer token/);
  assert.match(sanitized, /\[redacted\]/);
  assert.equal(sanitizeErrorMessage("x".repeat(500)).length, 300);
});

test("parseDirectConnectList returns trimmed entries and default bypass list", () => {
  const { DEFAULT_DIRECT_CONNECT_LIST, parseDirectConnectList } = shared();

  assert.deepEqual(plain(parseDirectConnectList("localhost, 127.0.0.1, <local>")), [
    "localhost",
    "127.0.0.1",
    "<local>",
  ]);
  assert.deepEqual(plain(parseDirectConnectList(" one.test, , two.test ")), ["one.test", "two.test"]);
  assert.deepEqual(plain(parseDirectConnectList("")), plain(parseDirectConnectList(DEFAULT_DIRECT_CONNECT_LIST)));
});

test("buildProxyConfig and sanitizeParsedProxy shape Chrome-safe data", () => {
  const { buildProxyConfig, sanitizeParsedProxy } = shared();
  const profile = { scheme: "http", host: "proxy.example.com", port: 8080, username: "user" };

  assert.deepEqual(plain(buildProxyConfig(profile, ["localhost"])), {
    mode: "fixed_servers",
    rules: {
      singleProxy: {
        scheme: "http",
        host: "proxy.example.com",
        port: 8080,
      },
      bypassList: ["localhost"],
    },
  });

  assert.deepEqual(plain(sanitizeParsedProxy(profile, true)), {
    scheme: "http",
    host: "proxy.example.com",
    port: 8080,
    usernameExists: true,
    passwordExists: true,
  });

  assert.equal(sanitizeParsedProxy(null, true), null);
});
