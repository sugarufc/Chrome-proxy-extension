# Proxy Switcher

Chrome proxy switcher for user-provided HTTP/HTTPS proxies.

**Repository:** https://github.com/sugarufc/Chrome-proxy-extension  
**Privacy policy:** https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md (the same text on GitHub
Pages: https://sugarufc.github.io/Chrome-proxy-extension/privacy.html, from `docs/privacy.html`)

## Purpose

Proxy Switcher lets a user configure Chrome to use a proxy server that the user already controls or has been given access to by their provider.

The extension applies proxy settings locally inside Chrome. It does not provide proxy infrastructure, network services, or remote servers.

## What the extension does

- Accepts a proxy pasted as a single string: `scheme://user:pass@host:port`, `user:pass@host:port`, `host:port`, or `host:port:user:pass`
- Turns the proxy on and off with a single toggle (or the `Alt+Shift+P` keyboard shortcut)
- Reconnects the proxy automatically after a browser restart if it was on
- Always connects to local addresses (`localhost`, `127.0.0.1`, `<local>`) directly, without the proxy
- Answers proxy authentication challenges only for the configured proxy, and turns the proxy off after a rejected login
- Stores the proxy and its password locally on the user's device; **Forget saved data** removes everything

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

| Permission               | Why it is required                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------- |
| `proxy`                  | Apply and clear the user's proxy configuration in Chrome                                                             |
| `storage`                | Save proxy settings and local preferences on the device                                                              |
| `webRequest`             | Handle proxy authentication challenges for the configured proxy                                                      |
| `webRequestAuthProvider` | Provide username and password to the configured proxy when Chrome requests proxy authentication                      |
| `<all_urls>`             | Required by Chrome so proxy authentication callbacks can be handled for requests routed through the configured proxy |

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

- The proxy and its password are stored in `chrome.storage.local` in the Chrome profile, unencrypted
- The popup shows the saved proxy, including the password, in plain text
- Do not use the extension on shared or untrusted Chrome profiles where other people can open the popup
- Credentials are sent only to the configured proxy (matched by port), never to websites
- If another extension or a policy takes over Chrome's proxy settings, the proxy turns off and credentials are no
  longer sent
- The extension makes no network requests of its own

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
4. Flip the toggle on, open any website and check your IP
5. Try the `Alt+Shift+P` shortcut to toggle the proxy without opening the popup
6. Flip the toggle off and confirm the normal connection is back
7. Use [TEST_CHECKLIST.md](TEST_CHECKLIST.md) for full manual verification

## Files

- `manifest.json` — extension metadata, permissions, CSP
- `shared.js` — parsing and proxy configuration helpers
- `background.js` — applies the proxy, answers proxy logins, restores the proxy after a restart
- `popup.html`, `popup.css`, `popup.js` — extension UI
- `PRIVACY.md` — privacy policy
- `STORE_LISTING.md` — Chrome Web Store listing draft
- `TEST_CHECKLIST.md` — manual test checklist
- `scripts/build.sh` — ZIP build script

## License

[MIT](LICENSE)
