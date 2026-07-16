# Release Notes — 3.0.1

**Release date:** July 16, 2026

**Package:** `dist/proxy-switcher.zip`

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
