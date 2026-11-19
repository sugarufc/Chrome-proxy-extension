# Release Notes

## 4.1.0

**Release date:** not released yet

- **Safer:** if another extension or a policy takes over Chrome's proxy settings, the proxy turns off, the popup
  says why, and the password is no longer sent to proxy logins.
- **Safer:** an old 3.x proxy is imported only if it is still valid (HTTP/HTTPS, host, port 1–65535).
- **Clearer:** whenever the proxy turns off because of an error (rejected login, another extension took over, a
  failed connect), the toolbar icon shows `!` and its tooltip gives the reason.
- **Sturdier:** a Chrome call that never answers fails after 10 seconds instead of blocking every later command.
- **New:** the popup follows the system dark theme, and screen readers announce status changes.
- The extension is now licensed under MIT.
- The popup footer links to the developer's website.

## 4.0.0

Back to the essentials: paste one proxy, flip the switch.

- **Simpler:** one proxy instead of profiles. Removed profile management and renaming, the WebRTC and
  block-on-failure options, and the connection test. Chrome already shows its own error page when a proxy fails.
- **Lighter:** the extension code is about a third of its previous size, with no separate storage module and no session
  mirror of the password. The extension makes no network requests of its own.
- **Fixed:** `host:port:user:pass` rejected passwords containing `@` or `/`.
- **Fixed:** commands could interleave on a fast toggle; they now run one at a time.
- **Kept:** automatic reconnect after a restart, `Alt+Shift+P`, local addresses always direct, credentials sent only
  to the configured proxy, and turning the proxy off after a rejected login.
- **Upgrading:** the proxy that was in use (or selected) is imported automatically; other profiles are dropped. The
  last version with profiles and options is the git tag `v3.3.0`.

## 3.3.0

- **New:** every connected proxy is saved automatically as a profile (named after its host), so the keyboard shortcut
  and the reconnect after a browser restart always work. "Unsaved proxy" is now "New proxy".
- **New:** rename a profile from the popup.
- **New (optional):** "Block traffic if the proxy login fails" keeps Chrome pointed at the proxy so requests fail
  instead of silently going out directly, and stops sending the wrong credentials to the provider.
- **New (optional):** "Block WebRTC IP leaks" restricts WebRTC UDP while the proxy is on. It uses the optional
  `privacy` permission, which Chrome asks for only when you enable the option.
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

## 3.2.0

**Release date:** July 29, 2026

- Made storage migrations one-time and kept `getStatus` read-only.
- Stored authentication state before applying proxy settings, with full rollback on failure.
- Verified that Chrome proxy settings remain controlled by this extension after connecting.
- Moved the connection test out of the blocking connect path.
- Added automatic profile names with numeric conflict suffixes and inline destructive-action confirmations.
- Added Enter-to-connect, shortcut error badges, and active-session filtering for proxy warnings.
- Set the minimum supported Chrome version to 108.

## 3.1.6

**Release date:** July 29, 2026

- Fixed saved proxy passwords disappearing after the first connection when the popup profile ID was temporarily unavailable.
- The background now safely matches the connected proxy to the selected saved profile before storing its password.

## 3.1.5

**Release date:** July 28, 2026

- Added a small, centered version label at the bottom of the popup.
- The displayed version is read directly from the installed extension manifest.

## 3.1.4

**Release date:** July 28, 2026

- Added distinct toolbar icons for proxy off and proxy on states.

## 3.1.3

**Release date:** July 28, 2026

- Updated all extension and toolbar icon sizes with the refined Proxy Switcher logo.

## 3.1.2

**Release date:** July 28, 2026

- Replaced the extension icon and toolbar states with the new Proxy Switcher logo.

## 3.1.1

**Release date:** July 28, 2026

- Removed password masking from the proxy field.
- Each saved profile now stores and restores its own password.
- Added safe migration from the legacy shared password.
- Passwords with reserved URL characters are displayed with correct percent-encoding.

## 3.1.0

**Release date:** July 21, 2026

- Removed SOCKS5 from the Chrome extension because authenticated SOCKS5 is not supported by Chrome extensions.
- Existing SOCKS5 profiles are removed during extension migration; HTTP/HTTPS profiles are preserved.
- Fixed parsing of explicit HTTPS port `443` and HTTP port `80`.
- Preserved specific Chrome proxy errors when a connection check fails.

## 3.0.1

**Release date:** July 16, 2026

Status and error messages rewritten in plain language: no raw `net::ERR_*` codes, no redundant "Connection test failed: Connection test timed out" phrasing. A working proxy shows `Working · N ms`; a dead one shows a short human explanation such as "The proxy is not responding."

## 3.0.0

Full popup redesign around a connect-and-go workflow: paste the proxy as one string, flip one toggle. The connection is verified automatically, the proxy reconnects after a browser restart, and a keyboard shortcut toggles it without opening the popup.

**Added**

- Single proxy field that accepts `scheme://user:pass@host:port`, `host:port`, `user:pass@host:port`, and the common seller format `host:port:user:pass`
- One on/off toggle instead of Connect / Disconnect / Test connection buttons
- Automatic connection test after turning the proxy on, with response time in the status line; click the status line to re-test
- Automatic reconnect after a browser restart when the proxy was left on
- `Alt+Shift+P` keyboard shortcut to toggle the proxy (configurable at `chrome://extensions/shortcuts`)
- The saved password is shown only masked (`******`) in the proxy string

**Changed**

- The password is now always stored locally in the Chrome profile (required for auto-reconnect); **Forget saved data** removes it. The **Remember password** checkbox is gone, and the disclaimer states the storage model up front
- The profile dropdown appears only when at least one profile is saved
- Forget saved data and profile actions are footer links instead of buttons
- Privacy policy updated: the connectivity check runs when the proxy is turned on and when the status line is clicked; no checks run while the proxy is off

**Removed**

- Connect, Disconnect, and Test connection buttons
- Separate host/port/username/password fields and the Show password button
- Remember password checkbox and session-only password mode

## 2.4.0

- Removed the direct connect (bypass) list UI; local addresses always connect directly
