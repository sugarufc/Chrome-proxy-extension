# Chrome Web Store Listing Draft

## Positioning

Chrome proxy switcher for user-provided HTTP/HTTPS proxies.

## Short description

Configure Chrome to use your own HTTP or HTTPS proxy.

## Full description

For version 4.1.0 and later. Paste the block below into the store as is (plain text, `•` bullets).

```text
Proxy Switcher is a single-purpose Chrome extension for applying a user-provided proxy configuration inside Chrome.

What it does:
• Accepts your proxy as a single string: scheme://user:pass@host:port, user:pass@host:port, host:port, or host:port:user:pass
• Turns the proxy on and off with one toggle or the Alt+Shift+P keyboard shortcut
• Reconnects the proxy automatically after a browser restart if it was on
• Always connects local addresses (localhost, 127.0.0.1) directly
• Sends your proxy login only to your proxy, never to websites
• Turns the proxy off and shows "!" on its icon if the login is rejected or another extension takes over Chrome's proxy settings
• Follows your system's light or dark theme
• Stores the proxy and its password locally on your device, unencrypted; "Forget saved data" removes everything. Do not use on shared computers.

What it does not do:
• It does not provide proxy servers
• It does not collect browsing history
• It does not send your credentials to the developer
• It does not include analytics or remote code
• It makes no network requests of its own

You are responsible for complying with applicable laws, website terms of service, and your proxy provider's terms.

Supported proxy types: HTTP and HTTPS. SOCKS is not supported.
```

## Single purpose

Configure Chrome to use a user-provided HTTP or HTTPS proxy.

## Category

Productivity

## Permissions justification

### proxy

Required to apply and clear the user's proxy configuration in Chrome.

### storage

Required to save proxy settings and locally stored credentials/preferences on the user's device.

### webRequest

Required to handle proxy authentication challenges for the configured proxy.

### webRequestAuthProvider

Required to provide username and password to the configured proxy when Chrome requests proxy authentication.

### Host permission: `<all_urls>`

Required because Chrome proxy authentication callbacks can occur for requests routed through the configured proxy across websites loaded in the browser.

This permission is not used to collect browsing history or transmit user data to the developer.

## Chrome Web Store Privacy Practices

Use these answers in the Chrome Web Store developer dashboard.

| Question                        | Answer  |
| ------------------------------- | ------- |
| Developer collects user data    | **No**  |
| Extension stores data locally   | **Yes** |
| Data sharing with third parties | **No**  |
| Analytics                       | **No**  |
| Remote servers / remote code    | **No**  |
| Browsing history collection     | **No**  |
| Visited URLs collection         | **No**  |
| Traffic content collection      | **No**  |

### Locally stored data

- proxy scheme
- proxy host
- proxy port
- proxy username
- proxy password (stored locally so the proxy can reconnect after a browser restart)

The developer does not receive, transmit, sell, or store this data on external servers.

## Privacy practices summary

- Developer does not collect user data
- Local-only credential storage on the user's device
- No analytics
- No remote code

Publish `PRIVACY.md` at a public URL and link it in the store listing before submission.

- Privacy policy URL: https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Support / contact

Before publishing, you may replace this with a dedicated support inbox or privacy-policy domain.

- Support email: asiatabd03@gmail.com
- Privacy policy URL: https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md
- Repository: https://github.com/sugarufc/Chrome-proxy-extension

## Disclaimer for store listing

This extension only configures Chrome to use the proxy you provide. It does not provide proxy servers, network infrastructure, or access to restricted services. You are responsible for using your proxy in compliance with applicable laws, website terms, and your proxy provider's rules.

## Store graphics

All images show the current 4.0 popup.

| Asset            | File                                               | Size     | Use in Chrome Web Store |
| ---------------- | -------------------------------------------------- | -------- | ----------------------- |
| Overview         | `store-assets/screenshot-1-overview-1280x800.png`  | 1280×800 | Screenshot #1           |
| Connected        | `store-assets/screenshot-2-connected-1280x800.png` | 1280×800 | Screenshot #2           |
| Disclaimer       | `store-assets/screenshot-disclaimer-1280x800.png`  | 1280×800 | Screenshot #3           |
| Marquee promo    | `store-assets/promo-marquee-1400x560.png`          | 1400×560 | Marquee promo tile      |
| Small promo tile | `store-assets/promo-small-440x280.png`             | 440×280  | Small promo tile        |

## Screenshot captions

1. Overview — Paste a proxy, flip the switch. HTTP and HTTPS, reconnects after a browser restart.
2. Connected — The status line shows the proxy in use; the toggle turns it off again.
3. Disclaimer — Review the disclaimer and user responsibility notice before first use.

## Prohibited marketing phrases

Do not use wording that suggests hidden identity, restriction evasion, or access to blocked services.

## Approved positioning sentence

Chrome proxy switcher for user-provided HTTP/HTTPS proxies.
