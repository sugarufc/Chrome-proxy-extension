# Release Notes — 2.4.0

**Release date:** July 9, 2026

**Package:** `dist/proxy-switcher.zip`

## Summary

Simplifies the popup: the **Direct connect (bypass) list** field is removed. Local addresses (`localhost`, `127.0.0.1`, `<local>`) always connect directly; everything else goes through the proxy. Connect and go.

## Changes

### Removed

- **Direct connect (bypass) list** field and its storage (`directConnectList`); the key is cleaned up on install/update
- `parseDirectConnectList` helper and related validation

### Changed

- The bypass list is now a fixed built-in default: `localhost, 127.0.0.1, <local>` — local servers and local SOCKS5 forwarders keep working without configuration

## Previous release — 2.3.0

- **Test connection** button (manual check via `https://www.gstatic.com/generate_204`), with proxy/direct reporting
- Manifest CSP fixed to allow the connection test from the service worker
- Proxy auth and session restore pinned to the connected proxy snapshot (`activeProxy`); switching or deleting profiles while connected no longer breaks auth
- Validation messages no longer over-redacted to `[redacted]`
- Human-readable hints for common `net::ERR_*` proxy errors
- Active proxy summary shown in the popup

## Pre-upload checklist

- [x] Version bumped to `2.4.0` in `manifest.json` and `package.json`
- [x] `npm test`, `npm run lint`, and `npm run format` pass
- [ ] ZIP rebuilt via `npm run build`
- [ ] Publish `PRIVACY.md` at a public URL before store submission — https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Support

Before public launch, you may replace this with a dedicated support inbox.

**Support contact:** asiatabd03@gmail.com
