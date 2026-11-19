const assert = require("node:assert/strict");
const test = require("node:test");

const { createChromeMock, loadScripts } = require("./helpers/load-extension-scripts.js");

function shared() {
  return loadScripts(["shared.js"], createChromeMock()).ProxyShared;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

test("parseProxyUrl accepts HTTP and HTTPS proxy URLs with and without credentials", () => {
  const { parseProxyInput: parseProxyUrl } = shared();

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

  assert.throws(() => parseProxyUrl("socks5://127.0.0.1:1080"), /only HTTP and HTTPS/);
});

test("parseProxyUrl preserves explicitly specified default ports", () => {
  const { parseProxyInput: parseProxyUrl } = shared();

  assert.equal(parseProxyUrl("https://user:pass@example.com:443").port, 443);
  assert.equal(parseProxyUrl("http://user:pass@example.com:80").port, 80);
});

test("parseProxyUrl decodes URL-encoded password characters and rejects raw reserved characters", () => {
  const { parseProxyInput: parseProxyUrl } = shared();

  assert.equal(parseProxyUrl("http://user:pa%40ss%3Aword%2Fok%23x%3Fy@example.com:8080").password, "pa@ss:word/ok#x?y");
  assert.throws(() => parseProxyUrl("http://user:pa@ss@example.com:8080"), /URL-encode/);
  assert.throws(() => parseProxyUrl("http://user:pa:ss@example.com:8080"), /URL-encode/);
});

test("parseProxyUrl validates required fields and port boundaries", () => {
  const { parseProxyInput: parseProxyUrl } = shared();

  assert.equal(parseProxyUrl("http://u:p@example.com:1").port, 1);
  assert.equal(parseProxyUrl("http://u:p@example.com:65535").port, 65535);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:0"), /port/);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:66000"), /port/);
  assert.throws(() => parseProxyUrl("ftp://u:p@example.com:21"), /Unsupported proxy scheme/);
  assert.throws(() => parseProxyUrl("http://u:p@:8080"), /Invalid proxy URL|host/);
  assert.throws(() => parseProxyUrl("http://u:p@example.com:8080/path"), /must not include path/);
});

test("parseProxyInput accepts URLs, host:port, user:pass@host:port, and host:port:user:pass", () => {
  const { parseProxyInput } = shared();

  assert.throws(() => parseProxyInput("socks5://127.0.0.1:1080"), /only HTTP and HTTPS/);
  assert.throws(() => parseProxyInput(""), /Paste a proxy/);
  assert.throws(() => parseProxyInput("ftp://example.com:21"), /Unsupported proxy scheme/);
  assert.throws(() => parseProxyInput("proxy.example.com"), /port/);
  assert.throws(() => parseProxyInput("http://user@proxy.example.com:8080"), /username and password/);

  assert.deepEqual(plain(parseProxyInput(" proxy.example.com:8080 ")), {
    scheme: "http",
    username: "",
    password: "",
    host: "proxy.example.com",
    port: 8080,
  });
  assert.deepEqual(plain(parseProxyInput("user:pass@proxy.example.com:8080")), {
    scheme: "http",
    username: "user",
    password: "pass",
    host: "proxy.example.com",
    port: 8080,
  });
  assert.deepEqual(plain(parseProxyInput("203.0.113.10:8080:proxy-user:pa:ss")), {
    scheme: "http",
    username: "proxy-user",
    password: "pa:ss",
    host: "203.0.113.10",
    port: 8080,
  });
});

test("host:port:user:pass keeps any character in the password, including @ and /", () => {
  const { parseProxyInput } = shared();

  const parsed = parseProxyInput("203.0.113.10:8080:proxy-user:p@ss/w:rd#1");

  assert.equal(parsed.password, "p@ss/w:rd#1");
  assert.equal(parsed.host, "203.0.113.10");
  assert.equal(parsed.port, 8080);
  assert.throws(() => parseProxyInput("user:p:w@proxy.example.com:8080"), /URL-encode/);
});

test("IPv6 proxies work in brackets; host:port:user:pass cannot carry them", () => {
  const { parseProxyInput, formatProxyString } = shared();

  assert.deepEqual(plain(parseProxyInput("http://u:p@[2001:db8::1]:3128")), {
    scheme: "http",
    username: "u",
    password: "p",
    host: "[2001:db8::1]",
    port: 3128,
  });
  assert.equal(parseProxyInput("[::1]:8080").host, "[::1]");
  assert.equal(formatProxyString(parseProxyInput("u:p@[2001:db8::1]:8080")), "http://u:p@[2001:db8::1]:8080");
  // Without a scheme the colons of an IPv6 address and the separators cannot be told apart.
  assert.throws(() => parseProxyInput("[2001:db8::1]:8080:u:p"), /Invalid proxy URL/);
});

test("formatProxyString writes a string that parseProxyInput reads back", () => {
  const { formatProxyString, parseProxyInput } = shared();
  const proxy = {
    scheme: "https",
    host: "proxy.example.com",
    port: 8443,
    username: "user",
    password: "pa@ss:word/ok#x?y",
  };

  const text = formatProxyString(proxy);

  assert.equal(text, "https://user:pa%40ss%3Aword%2Fok%23x%3Fy@proxy.example.com:8443");
  assert.deepEqual(plain(parseProxyInput(text)), proxy);
  assert.equal(
    formatProxyString({ scheme: "http", host: "proxy.example.com", port: 80, username: "" }),
    "http://proxy.example.com:80",
  );
  assert.equal(formatProxyString(null), "");
});

test("buildProxyConfig routes everything through one proxy except local addresses", () => {
  const { buildProxyConfig } = shared();

  assert.deepEqual(plain(buildProxyConfig({ scheme: "http", host: "proxy.example.com", port: 8080 })), {
    mode: "fixed_servers",
    rules: {
      singleProxy: { scheme: "http", host: "proxy.example.com", port: 8080 },
      bypassList: ["localhost", "127.0.0.1", "<local>"],
    },
  });
});
