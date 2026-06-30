# Chrome Web Store Listing Draft

## Positioning

Chrome proxy switcher for user-provided HTTP/HTTPS/SOCKS5 proxies.

## Short description

Configure Chrome to use your own HTTP, HTTPS, or SOCKS5 proxy.

## Full description

Proxy Switcher is a single-purpose Chrome extension for applying a user-provided proxy configuration inside Chrome.

What it does:

- lets you enter proxy type, host, port, username, and password
- connects Chrome to the proxy server you provide
- disconnects Chrome from that proxy when you choose
- stores proxy settings locally on your device
- keeps the password in the current browser session by default
- optionally stores the password locally in your Chrome profile if you enable Remember password

What it does not do:

- it does not provide proxy servers
- it does not collect browsing history
- it does not send your credentials to the developer
- it does not include analytics or remote code

You are responsible for complying with applicable laws, website terms of service, and your proxy provider's terms.

Supported proxy types:

- HTTP
- HTTPS
- SOCKS5

## Single purpose

Configure Chrome to use a user-provided HTTP, HTTPS, or SOCKS5 proxy.

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

| Question | Answer |
|---|---|
| Developer collects user data | **No** |
| Extension stores data locally | **Yes** |
| Data sharing with third parties | **No** |
| Analytics | **No** |
| Remote servers / remote code | **No** |
| Browsing history collection | **No** |
| Visited URLs collection | **No** |
| Traffic content collection | **No** |

### Locally stored data

- proxy scheme
- proxy host
- proxy port
- proxy username
- proxy password only if the user enables **Remember password on this device**

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

## Screenshot captions

1. Enter your proxy settings locally in Chrome.
2. Connect or disconnect with one click.
3. Review the disclaimer and user responsibility notice.
4. Forget saved data any time.

## Prohibited marketing phrases

Do not use wording that suggests hidden identity, restriction evasion, or access to blocked services.

## Approved positioning sentence

Chrome proxy switcher for user-provided HTTP/HTTPS/SOCKS5 proxies.
