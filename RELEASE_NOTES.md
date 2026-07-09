# Release Notes — 2.3.0

**Release date:** July 9, 2026

**Package:** `dist/proxy-switcher.zip`

## Summary

Adds a manual connection test and clearer proxy error reporting. Fixes proxy authentication after switching profiles while connected, a CSP rule that would have blocked the connection test, and error messages that displayed as `[redacted]`.

## Changes

### Added

- **Test connection** button: optional manual check via `https://www.gstatic.com/generate_204` that runs only when clicked, and reports whether the test went through the active proxy or a direct connection
- Human-readable hints for common Chrome proxy errors such as `net::ERR_PROXY_CONNECTION_FAILED`
- The popup shows a summary line of the currently connected proxy

### Fixed

- The manifest CSP `connect-src` now allows the connection test endpoint; the previous `connect-src 'none'` also governed the service worker and would have blocked the test fetch
- Proxy authentication and session restore now use a snapshot of the proxy that was actually connected (`activeProxy`); switching or deleting profiles in the popup while connected no longer breaks auth challenges or restores the wrong proxy after a service worker restart
- Validation messages such as "Password is required when username is provided." are no longer over-redacted to `[redacted]` in the popup
- **Connect** now shows the specific validation error instead of a generic "Proxy settings are incomplete."

### Security

- The status payload no longer duplicates the saved password inside the general state object; the popup receives it only through the dedicated password field

## Pre-upload checklist

- [x] Version bumped to `2.3.0` in `manifest.json` and `package.json`
- [x] `npm test`, `npm run lint`, and `npm run format` pass
- [ ] ZIP rebuilt via `npm run build`
- [ ] Publish `PRIVACY.md` at a public URL before store submission — https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Support

Before public launch, you may replace this with a dedicated support inbox.

**Support contact:** asiatabd03@gmail.com
