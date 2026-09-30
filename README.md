# Proxy Switcher

Chrome proxy switcher for user-provided HTTP/HTTPS proxies.

**Repository:** https://github.com/sugarufc/Chrome-proxy-extension  
**Privacy policy:** https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Purpose

Proxy Switcher lets a user configure Chrome to use a proxy server that the user already controls or has been given access to by their provider.

The extension applies proxy settings locally inside Chrome. It does not provide proxy infrastructure, network services, or remote servers.

## What the extension does

- Accepts a proxy pasted as a single string: `scheme://user:pass@host:port`, `host:port`, or `host:port:user:pass`
- Turns the proxy on and off with a single toggle (or the `Alt+Shift+P` keyboard shortcut)
- Tests the connection on demand (click the status line) and shows the response time or the reason it failed
- Reconnects the proxy automatically after a browser restart if it was on
- Saves every connected proxy as a named profile (named after its host, renameable)
- Optionally blocks traffic instead of falling back to a direct connection when the proxy login fails
- Optionally blocks WebRTC IP leaks while the proxy is on (asks for the optional `privacy` permission first)
- Applies the proxy configuration to Chrome through the Chrome Proxy API
- Always connects to local addresses (`localhost`, `127.0.0.1`, `<local>`) directly, without the proxy
- Explains common Chrome proxy errors in plain language
- Responds to proxy authentication challenges only for the configured proxy
- Stores proxy settings and the password locally on the user's device; **Forget saved data** removes everything

## What the extension does not do

- Does not provide proxy servers
- Does not provide network infrastructure
- Does not collect browsing history
- Does not collect visited URLs
- Does not collect traffic content
- Does not collect the user's IP address
- Does not send user data to the developer
- Does not include analytics, tracking, or remote configuration
- Does not load remote scripts or remote code

## Permissions explained

| Permission               | Why it is required                                                                                                     |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `proxy`                  | Apply and clear the user's proxy configuration in Chrome                                                               |
| `storage`                | Save proxy settings and local preferences on the device                                                                |
| `webRequest`             | Handle proxy authentication challenges for the configured proxy                                                        |
| `webRequestAuthProvider` | Provide username and password to the configured proxy when Chrome requests proxy authentication                        |
| `privacy` (optional)     | Only if you enable "Block WebRTC IP leaks": restrict WebRTC UDP so it cannot reveal your real IP while the proxy is on |
| `<all_urls>`             | Required by Chrome so proxy authentication callbacks can be handled for requests routed through the configured proxy   |

These permissions are not used to collect browsing history or transmit user data to the developer.

## Privacy model

- No data collection by the developer
- No analytics
- No third-party sharing
- No remote code
- Proxy credentials stay on the device only
- The password is stored locally in the Chrome profile so the proxy can reconnect after a browser restart
- The user can delete all saved data with **Forget saved data**

See [PRIVACY.md](PRIVACY.md).

## User responsibility

The user confirms that they:

- provide their own proxy details
- are responsible for complying with applicable laws
- are responsible for complying with website terms of service
- are responsible for complying with their proxy provider's terms
- use the extension only to configure Chrome networking settings locally

## Security model

- Full proxy URLs with credentials are never stored
- The password is stored in `chrome.storage.local` in the Chrome profile (and mirrored to `chrome.storage.session` while connected)
- Storage access limited to trusted extension contexts when supported by Chrome
- Sensitive values are not logged; the popup displays the saved password in plain text in the proxy field
- Do not use the extension on shared or untrusted Chrome profiles where other people can open the popup
- Stored error messages are sanitized before display
- If the proxy was on when the browser closed, it reconnects automatically on the next start
- Not intended for shared or untrusted devices — the disclaimer states this before first use

## Build instructions

### Local development

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

### Production ZIP

```bash
./scripts/build.sh
```

This creates `dist/proxy-switcher.zip` with only runtime files.

## How to test locally

1. Load the extension unpacked or from the ZIP
2. Accept the disclaimer
3. Paste a proxy string (for example `http://user:pass@host:port` or `host:port:user:pass`)
4. Flip the toggle on and confirm the status changes to connected
5. Click the status line to run an optional connection test
6. Optionally click **Save as profile** to store the current proxy as a named profile
7. Try the `Alt+Shift+P` shortcut to toggle the proxy without opening the popup
8. Flip the toggle off and confirm behavior
9. Use [TEST_CHECKLIST.md](TEST_CHECKLIST.md) for full manual verification

## Files

- `manifest.json` — extension metadata, permissions, CSP
- `shared.js` — parsing and proxy configuration helpers
- `storage-manager.js` — local/session credential storage
- `background.js` — proxy authentication and session restore logic
- `popup.html`, `popup.css`, `popup.js` — extension UI
- `PRIVACY.md` — privacy policy
- `STORE_LISTING.md` — Chrome Web Store listing draft
- `TEST_CHECKLIST.md` — manual test checklist
- `scripts/build.sh` — ZIP build script
