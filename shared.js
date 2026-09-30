(function initProxyShared() {
  "use strict";

  // Local addresses always connect directly so local servers and forwarders keep working.
  const DEFAULT_BYPASS_LIST = Object.freeze(["localhost", "127.0.0.1", "<local>"]);
  const SUPPORTED_SCHEMES = new Set(["http", "https"]);

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

  function getExplicitPort(raw) {
    const authority = raw.replace(/^[a-z0-9]+:\/\//i, "").split(/[/?#]/, 1)[0];
    const hostAndPort = authority.slice(authority.lastIndexOf("@") + 1);
    const match = hostAndPort.match(/:(\d+)$/);

    return match ? match[1] : "";
  }

  function parseProxyUrl(input) {
    const raw = String(input || "").trim();

    if (!raw) {
      throw new Error("Proxy URL is required.");
    }

    const schemeMatch = raw.match(/^([a-z0-9]+):\/\//i);
    if (!schemeMatch || !SUPPORTED_SCHEMES.has(schemeMatch[1].toLowerCase())) {
      throw new Error("Unsupported proxy scheme. This extension supports only HTTP and HTTPS.");
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
    // URL normalizes explicit default ports (HTTPS 443 and HTTP 80) to an empty string.
    const normalizedPort = url.port || getExplicitPort(raw);
    const port = Number(normalizedPort);

    if (!SUPPORTED_SCHEMES.has(scheme)) {
      throw new Error("Unsupported proxy scheme. This extension supports only HTTP and HTTPS.");
    }

    if (!host) {
      throw new Error("Proxy URL must include host.");
    }

    if (!normalizedPort || !Number.isInteger(port) || port < 1 || port > 65535) {
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

  function parseProxyInput(input) {
    const raw = String(input || "").trim();

    if (!raw) {
      throw new Error("Proxy address is required.");
    }

    if (/^[a-z0-9]+:\/\//i.test(raw)) {
      return parseProxyUrl(raw);
    }

    // Common seller format: host:port:user:pass (password may contain colons).
    const parts = raw.split(":");
    if (parts.length >= 4 && !raw.includes("@") && !raw.includes("/")) {
      const [host, port, username] = parts;
      const password = parts.slice(3).join(":");
      return parseProxyUrl(`http://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${host}:${port}`);
    }

    // host:port or user:pass@host:port — default to HTTP.
    return parseProxyUrl(`http://${raw}`);
  }

  function formatProxyString(profile, options = {}) {
    if (!profile || !profile.host) {
      return "";
    }

    let auth = "";
    if (profile.username) {
      auth = encodeURIComponent(profile.username);
      if (options.password) {
        auth += `:${encodeURIComponent(options.password)}`;
      }
      auth += "@";
    }

    return `${profile.scheme}://${auth}${profile.host}:${profile.port}`;
  }

  function buildProfileFromFields({ scheme, host, port, username }) {
    const normalizedScheme = String(scheme || "")
      .trim()
      .toLowerCase();
    const normalizedHost = String(host || "").trim();
    const normalizedPort = Number(port);
    const normalizedUsername = String(username || "").trim();

    if (!SUPPORTED_SCHEMES.has(normalizedScheme)) {
      throw new Error("Unsupported proxy scheme. This extension supports only HTTP and HTTPS.");
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

  function sanitizeErrorMessage(message) {
    let text = String(message || "Unexpected error.");

    text = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[redacted]");
    text = text.replace(/\S+:\S+@\S+/gi, "[redacted]");
    text = text.replace(/(?:username|password|credential|proxy url)\s*[:=]\s*\S+/gi, "[redacted]");
    text = text.replace(/(?:Proxy-Authorization|Authorization)\s*[:=]?\s*\S+/gi, "[redacted]");

    return text.slice(0, 300);
  }

  const PROXY_ERROR_HINTS = [
    [/ERR_(?:PROXY_CONNECTION|TUNNEL_CONNECTION)_FAILED/i, "Can't reach the proxy server. Check the address and port."],
    [/ERR_CONNECTION_REFUSED/i, "The proxy refused the connection. Check the address and port."],
    [/ERR_CONNECTION_(?:RESET|CLOSED)/i, "The proxy closed the connection."],
    [/ERR_NAME_NOT_RESOLVED/i, "Proxy address not found. Check the host for typos."],
    [/ERR_PROXY_AUTH_UNSUPPORTED/i, "The proxy uses a sign-in method Chrome does not support."],
    [/ERR_PROXY_CERTIFICATE_INVALID/i, "The proxy's security certificate is not valid."],
    [/ERR_(?:CONNECTION_)?TIMED_OUT/i, "The proxy is not responding."],
    [/ERR_INTERNET_DISCONNECTED/i, "No internet connection."],
  ];

  // Replaces raw Chrome net:: error codes with a short plain-language message.
  function describeProxyError(message) {
    const text = String(message || "").trim() || "Proxy connection error";

    for (const [pattern, hint] of PROXY_ERROR_HINTS) {
      if (pattern.test(text)) {
        return hint;
      }
    }

    const netError = text.match(/net::(ERR_[A-Z0-9_]+)/);
    return netError ? `Connection failed (${netError[1]}).` : text;
  }

  function buildProxyConfig(profile) {
    return {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: profile.scheme,
          host: profile.host,
          port: profile.port,
        },
        bypassList: [...DEFAULT_BYPASS_LIST],
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
    DEFAULT_BYPASS_LIST,
    SUPPORTED_SCHEMES,
    parseProxyUrl,
    parseProxyInput,
    formatProxyString,
    buildProfileFromFields,
    validatePasswordForProfile,
    buildProxyConfig,
    sanitizeParsedProxy,
    sanitizeErrorMessage,
    describeProxyError,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.ProxyShared = shared;
  }
})();
