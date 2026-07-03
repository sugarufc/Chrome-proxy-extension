(function initProxyShared() {
  "use strict";

  const DEFAULT_DIRECT_CONNECT_LIST = "localhost, 127.0.0.1, <local>";
  const SUPPORTED_SCHEMES = new Set(["http", "https", "socks5"]);
  const SCHEMES_REQUIRING_AUTH = new Set(["http", "https"]);
  const SCHEMES_WITHOUT_EXTENSION_AUTH = new Set(["socks5"]);

  function assertEncodedCredentials(raw) {
    const authority = raw.replace(/^[a-z0-9]+:\/\//i, "").split(/[/?#]/, 1)[0];
    const atMatches = authority.match(/@/g) || [];

    if (atMatches.length !== 1) {
      throw new Error("Proxy URL must include username and password. URL-encode special password characters like @.");
    }

    const credentials = authority.slice(0, authority.lastIndexOf("@"));
    const separatorIndex = credentials.indexOf(":");

    if (separatorIndex <= 0 || separatorIndex === credentials.length - 1) {
      throw new Error("Proxy URL must include username and password.");
    }

    const passwordPart = credentials.slice(separatorIndex + 1);
    if (passwordPart.includes(":")) {
      throw new Error("URL-encode special password characters like :.");
    }
  }

  function safeDecode(value, label) {
    try {
      return decodeURIComponent(value);
    } catch (_error) {
      throw new Error(`Invalid ${label} encoding. URL-encode special characters.`);
    }
  }

  function parseProxyUrl(input) {
    const raw = String(input || "").trim();

    if (!raw) {
      throw new Error("Proxy URL is required.");
    }

    const schemeMatch = raw.match(/^([a-z0-9]+):\/\//i);
    if (!schemeMatch || !SUPPORTED_SCHEMES.has(schemeMatch[1].toLowerCase())) {
      throw new Error("Unsupported proxy scheme. Use http://, https://, or socks5://.");
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

    const scheme = url.protocol.replace(":", "").toLowerCase();
    const username = safeDecode(url.username, "username");
    const password = safeDecode(url.password, "password");
    const host = url.hostname;
    const port = Number(url.port);

    if (!SUPPORTED_SCHEMES.has(scheme)) {
      throw new Error("Unsupported proxy scheme. Use http://, https://, or socks5://.");
    }

    if (!host) {
      throw new Error("Proxy URL must include host.");
    }

    if (!url.port || !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("Proxy port must be a number from 1 to 65535.");
    }

    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
      throw new Error(
        "Proxy URL must not include path, query, or hash. URL-encode special password characters like @, :, /, #, and ?.",
      );
    }

    return {
      scheme,
      username,
      password,
      host,
      port,
    };
  }

  function buildProfileFromFields({ scheme, host, port, username }) {
    const normalizedScheme = String(scheme || "")
      .trim()
      .toLowerCase();
    const normalizedHost = String(host || "").trim();
    const normalizedPort = Number(port);
    const normalizedUsername = String(username || "").trim();

    if (!SUPPORTED_SCHEMES.has(normalizedScheme)) {
      throw new Error("Select a supported proxy type: HTTP, HTTPS, or SOCKS5.");
    }

    if (!normalizedHost) {
      throw new Error("Proxy host is required.");
    }

    if (!Number.isInteger(normalizedPort) || normalizedPort < 1 || normalizedPort > 65535) {
      throw new Error("Proxy port must be a number from 1 to 65535.");
    }

    return {
      scheme: normalizedScheme,
      host: normalizedHost,
      port: normalizedPort,
      username: normalizedUsername,
    };
  }

  function validatePasswordForProfile(profile, password) {
    if (!profile) {
      throw new Error("Proxy settings are incomplete.");
    }

    if (profile.username && !password) {
      throw new Error("Password is required when username is provided.");
    }
  }

  function validateChromeProxySupport(profile, password) {
    if (!profile || !SCHEMES_WITHOUT_EXTENSION_AUTH.has(profile.scheme)) {
      return;
    }

    if (profile.username || password) {
      throw new Error(
        "Chrome cannot authenticate SOCKS5 proxies in extensions. Use HTTP or HTTPS if your provider supports it, or run a local HTTP forwarder to your SOCKS5 proxy and connect to 127.0.0.1 here.",
      );
    }
  }

  function sanitizeErrorMessage(message) {
    let text = String(message || "Unexpected error.");

    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
    text = text.replace(/\S+:\S+@\S+/gi, "[redacted]");
    text = text.replace(/(?:username|password|credential|proxy url)\s*[:=]\s*\S+/gi, "[redacted]");
    text = text.replace(/(?:Proxy-Authorization|Authorization)\s*[:=]?\s*\S+/gi, "[redacted]");
    text = text.replace(/(?:password|username|credential|proxy url)[^\n]*/gi, "[redacted]");

    return text.slice(0, 300);
  }

  function parseDirectConnectList(input) {
    return String(input || DEFAULT_DIRECT_CONNECT_LIST)
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function buildProxyConfig(profile, directConnectList) {
    return {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: profile.scheme,
          host: profile.host,
          port: profile.port,
        },
        bypassList: directConnectList,
      },
    };
  }

  function sanitizeParsedProxy(profile, passwordExists) {
    if (!profile) {
      return null;
    }

    return {
      scheme: profile.scheme,
      host: profile.host,
      port: profile.port,
      usernameExists: Boolean(profile.username),
      passwordExists: Boolean(passwordExists),
    };
  }

  const shared = {
    DEFAULT_DIRECT_CONNECT_LIST,
    SUPPORTED_SCHEMES,
    SCHEMES_REQUIRING_AUTH,
    SCHEMES_WITHOUT_EXTENSION_AUTH,
    parseProxyUrl,
    buildProfileFromFields,
    validatePasswordForProfile,
    validateChromeProxySupport,
    parseDirectConnectList,
    buildProxyConfig,
    sanitizeParsedProxy,
    sanitizeErrorMessage,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.ProxyShared = shared;
  }
})();
