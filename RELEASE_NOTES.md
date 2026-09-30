# Release Notes

## Unreleased

- **Fixed:** connecting to a different proxy while a saved profile was selected overwrote that profile's password,
  so the profile later showed its own host with the wrong password. A connection is now tied to a saved profile only
  when it really is that profile; otherwise the dropdown shows "Unsaved proxy".
- **Fixed:** the status line no longer flips to a premature "Connected" or overwrites a check result when storage
  changes while a connect is in progress.
- **Fixed:** the first requests after a browser start could show Chrome's own proxy sign-in dialog; the session is now
  restored on demand from saved data.
- **Fixed:** fast toggle / shortcut sequences could interleave; state-changing commands now run one at a time.
- **Better errors:** a failed connection check reports the actual reason (unreachable, refused, unknown host, bad
  certificate, wrong password) instead of always "The proxy is not responding." Old errors are cleared on browser start.
- The connection check refuses to run while the proxy is off (it would only measure the direct connection).
- The button reads "Update profile" when a saved profile is selected and "Save as profile" for an unsaved proxy.
- Removed the unused `lastProxyError` state and dead code; the webRequest error listener is scoped to the check URL only.

# 3.2.0

**Release date:** July 29, 2026

**Package:** `dist/proxy-switcher.zip`

## Summary (3.2.0)

- Made storage migrations one-time and kept `getStatus` read-only.
- Stored authentication state before applying proxy settings, with full rollback on failure.
- Verified that Chrome proxy settings remain controlled by this extension after connecting.
- Moved the connection test out of the blocking connect path.
- Added automatic profile names with numeric conflict suffixes and inline destructive-action confirmations.
- Added Enter-to-connect, shortcut error badges, and active-session filtering for proxy warnings.
- Set the minimum supported Chrome version to 108.

## Previous release — 3.1.6

**Release date:** July 29, 2026

## Summary (3.1.6)

- Fixed saved proxy passwords disappearing after the first connection when the popup profile ID was temporarily unavailable.
- The background now safely matches the connected proxy to the selected saved profile before storing its password.

## Previous release — 3.1.5

**Release date:** July 28, 2026

## Summary (3.1.5)

- Added a small, centered version label at the bottom of the popup.
- The displayed version is read directly from the installed extension manifest.

## Previous release — 3.1.4

**Release date:** July 28, 2026

## Summary (3.1.4)

- Added distinct toolbar icons for proxy off and proxy on states.

## Previous release — 3.1.3

**Release date:** July 28, 2026

## Summary (3.1.3)

- Updated all extension and toolbar icon sizes with the refined Proxy Switcher logo.

## Previous release — 3.1.2

**Release date:** July 28, 2026

## Summary (3.1.2)

- Replaced the extension icon and toolbar states with the new Proxy Switcher logo.

## Previous release — 3.1.1

**Release date:** July 28, 2026

## Summary (3.1.1)

- Removed password masking from the proxy field.
- Each saved profile now stores and restores its own password.
- Added safe migration from the legacy shared password.
- Passwords with reserved URL characters are displayed with correct percent-encoding.

## Previous release — 3.1.0

**Release date:** July 21, 2026

## Summary (3.1.0)

- Removed SOCKS5 from the Chrome extension because authenticated SOCKS5 is not supported by Chrome extensions.
- Existing SOCKS5 profiles are removed during extension migration; HTTP/HTTPS profiles are preserved.
- Fixed parsing of explicit HTTPS port `443` and HTTP port `80`.
- Preserved specific Chrome proxy errors when a connection check fails.

## Previous release — 3.0.1

**Release date:** July 16, 2026

## Summary (3.0.1)

Status and error messages rewritten in plain language: no raw `net::ERR_*` codes, no redundant "Connection test failed: Connection test timed out" phrasing. A working proxy shows `Working · N ms`; a dead one shows a short human explanation such as "The proxy is not responding."

## Previous release — 3.0.0

## Summary

Full popup redesign around a connect-and-go workflow: paste the proxy as one string, flip one toggle. The connection is verified automatically, the proxy reconnects after a browser restart, and a keyboard shortcut toggles it without opening the popup.

## Changes

### Added

- Single proxy field that accepts `scheme://user:pass@host:port`, `host:port`, `user:pass@host:port`, and the common seller format `host:port:user:pass`
- One on/off toggle instead of Connect / Disconnect / Test connection buttons
- Automatic connection test after turning the proxy on, with response time in the status line; click the status line to re-test
- Automatic reconnect after a browser restart when the proxy was left on
- `Alt+Shift+P` keyboard shortcut to toggle the proxy (configurable at `chrome://extensions/shortcuts`)
- The saved password is shown only masked (`******`) in the proxy string

### Changed

- The password is now always stored locally in the Chrome profile (required for auto-reconnect); **Forget saved data** removes it. The **Remember password** checkbox is gone, and the disclaimer states the storage model up front
- The profile dropdown appears only when at least one profile is saved
- Forget saved data and profile actions are footer links instead of buttons
- Privacy policy updated: the connectivity check runs when the proxy is turned on and when the status line is clicked; no checks run while the proxy is off

### Removed

- Connect, Disconnect, and Test connection buttons
- Separate host/port/username/password fields and the Show password button
- Remember password checkbox and session-only password mode

## Previous release — 2.4.0

- Removed the direct connect (bypass) list UI; local addresses always connect directly

## Pre-upload checklist

- [x] Version bumped to `3.0.0` in `manifest.json` and `package.json`
- [x] `npm test`, `npm run lint`, and `npm run format` pass
- [ ] ZIP rebuilt via `npm run build`
- [ ] Publish `PRIVACY.md` at a public URL before store submission — https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Support

Before public launch, you may replace this with a dedicated support inbox.

**Support contact:** asiatabd03@gmail.com
