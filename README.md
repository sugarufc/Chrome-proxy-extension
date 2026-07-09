# Proxy Switcher

Chrome proxy switcher for user-provided HTTP/HTTPS/SOCKS5 proxies.

**Repository:** https://github.com/sugarufc/Chrome-proxy-extension  
**Privacy policy:** https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Purpose

Proxy Switcher lets a user configure Chrome to use a proxy server that the user already controls or has been given access to by their provider.

The extension applies proxy settings locally inside Chrome. It does not provide proxy infrastructure, network services, or remote servers.

## What the extension does

- Accepts proxy type, host, port, username, and password entered by the user
- Saves multiple named proxy profiles
- Applies the proxy configuration to Chrome through the Chrome Proxy API
- Always connects to local addresses (`localhost`, `127.0.0.1`, `<local>`) directly, without the proxy
- Provides an optional manual connection test using `https://www.gstatic.com/generate_204`
- Shows which proxy is currently connected and explains common Chrome proxy errors
- Disconnects Chrome from that proxy when the user chooses
- Responds to proxy authentication challenges only for the configured proxy
- Stores proxy settings locally on the user's device
- Keeps the proxy password in the current browser session by default
- Optionally stores the password locally in the Chrome profile if the user enables **Remember password on this device**

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
- Password is session-only by default
- If the user enables **Remember password on this device**, the password is stored locally in the Chrome profile
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
- Default password storage: `chrome.storage.session`
- Optional remembered password: `chrome.storage.local` in the Chrome profile when the user opts in
- Storage access limited to trusted extension contexts when supported by Chrome
- Sensitive values are not logged
- Stored error messages are sanitized before display
- After browser restart, the proxy is not reconnected automatically
- The user must click **Connect** again

## SOCKS5 with username and password

Chrome extensions cannot send SOCKS5 credentials. This is a Chrome engine limitation, not a bug in this extension. If you connect a SOCKS5 proxy with a username or password, Chrome may show **Connected** but browsing will fail.

**What to do instead:**

1. Ask your proxy provider for an **HTTP** or **HTTPS** endpoint on the same account.
2. Or run a local HTTP forwarder and connect the extension to `127.0.0.1`:

```bash
brew install gost
gost -L=http://127.0.0.1:18080 -F=socks5://USERNAME:PASSWORD@HOST:PORT
```

Then in the extension use **HTTP**, host `127.0.0.1`, port `18080`, with no username or password.

SOCKS5 without authentication is supported.

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
3. Enter proxy settings manually
4. Optionally click **Save as profile** to store the current proxy as a named profile
5. Click **Connect**
6. Optionally click **Test connection**
7. Click **Disconnect** and confirm behavior
8. Use [TEST_CHECKLIST.md](TEST_CHECKLIST.md) for full manual verification

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
