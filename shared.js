(function initProxyShared() {
  "use strict";

  // Local addresses always connect directly so local servers and forwarders keep working.
  const BYPASS_LIST = Object.freeze(["localhost", "127.0.0.1", "<local>"]);
  const SCHEMES = new Set(["http", "https"]);
  const UNSUPPORTED_SCHEME = "Unsupported proxy scheme. This extension supports only HTTP and HTTPS.";

  function authorityOf(raw) {
    return raw.replace(/^[a-z0-9]+:\/\//i, "").split(/[/?#]/, 1)[0];
  }

  // Credentials must be URL-encoded so that @ and : in a password cannot be misread.
  function assertEncodedCredentials(raw) {
    const authority = authorityOf(raw);
    if ((authority.match(/@/g) || []).length !== 1) {
      throw new Error("Proxy URL must include username and password. URL-encode special password characters like @.");
    }

    const credentials = authority.slice(0, authority.lastIndexOf("@"));
    const separator = credentials.indexOf(":");
    if (separator <= 0 || separator === credentials.length - 1) {
      throw new Error("Proxy URL must include username and password.");
    }
    if (credentials.slice(separator + 1).includes(":")) {
      throw new Error("URL-encode special password characters like :.");
    }
  }

  function decode(value, label) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      throw new Error(`Invalid ${label} encoding. URL-encode special characters.`);
    }
  }

  function parseProxyUrl(raw) {
    const scheme = (raw.match(/^([a-z0-9]+):\/\//i) || [])[1];
    if (!scheme || !SCHEMES.has(scheme.toLowerCase())) {
      throw new Error(UNSUPPORTED_SCHEME);
    }

    if (raw.includes("@")) {
      assertEncodedCredentials(raw);
    }

    let url;
    try {
      url = new URL(raw);
    } catch (_error) {
      throw new Error("Invalid proxy URL. Check username, password, host, and port.");
    }

    // URL drops explicit default ports (80 for HTTP, 443 for HTTPS), so read the port from the text.
    const explicitPort = (authorityOf(raw).match(/:(\d+)$/) || [])[1];
    const port = Number(url.port || explicitPort);

    if (!url.hostname) {
      throw new Error("Proxy URL must include host.");
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Proxy port must be a number from 1 to 65535.");
    }
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      throw new Error(
        "Proxy URL must not include path, query, or hash. URL-encode special password characters like @, :, /, #, and ?.",
      );
    }

    return {
      scheme: url.protocol.replace(":", "").toLowerCase(),
      username: decode(url.username, "username"),
      password: decode(url.password, "password"),
      host: url.hostname,
      port,
    };
  }

  // Accepts scheme://user:pass@host:port, user:pass@host:port, host:port and host:port:user:pass.
  function parseProxyInput(input) {
    const raw = String(input || "").trim();
    if (!raw) {
      throw new Error("Paste a proxy address first.");
    }

    if (/^[a-z0-9]+:\/\//i.test(raw)) {
      return parseProxyUrl(raw);
    }

    // Common seller format: host:port:user:pass (the password may contain colons).
    const parts = raw.split(":");
    if (parts.length >= 4 && /^\d+$/.test(parts[1])) {
      const [host, port, username, ...password] = parts;
      const credentials = `${encodeURIComponent(username)}:${encodeURIComponent(password.join(":"))}`;
      return parseProxyUrl(`http://${credentials}@${host}:${port}`);
    }

    return parseProxyUrl(`http://${raw}`);
  }

  function formatProxyString(proxy) {
    if (!proxy || !proxy.host) {
      return "";
    }

    const auth = proxy.username
      ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || "")}@`
      : "";
    return `${proxy.scheme}://${auth}${proxy.host}:${proxy.port}`;
  }

  function buildProxyConfig(proxy) {
    return {
      mode: "fixed_servers",
      rules: {
        singleProxy: { scheme: proxy.scheme, host: proxy.host, port: proxy.port },
        bypassList: [...BYPASS_LIST],
      },
    };
  }

  globalThis.ProxyShared = { SCHEMES, parseProxyInput, formatProxyString, buildProxyConfig };
})();
