# Privacy Policy

**Effective date:** June 30, 2026

**Extension name:** Proxy Switcher

## Summary

Proxy Switcher does not collect, transmit, sell, or share user data with the developer or with third parties.

All proxy settings and credentials entered by the user are stored only on the user's device inside the Chrome profile.

## What this extension does

Proxy Switcher allows a user to configure Chrome to use a proxy server that the user provides. The extension applies local proxy settings inside Chrome and can supply proxy authentication credentials to the configured proxy when Chrome requests them.

This extension does not provide proxy servers or network infrastructure.

## Data we collect

We do not collect:

- proxy credentials
- browsing history
- visited URLs
- page content
- traffic content
- IP addresses
- device identifiers for analytics
- usage analytics
- crash reports sent to the developer

## Data stored locally on your device

The extension may store the following locally in Chrome extension storage on your device:

- proxy type, host, port, and username
- proxy password in `chrome.storage.session` by default
- proxy password in `chrome.storage.local` only if you enable **Remember password on this device**
- connection state and local error messages required for the extension to function
- a disclaimer acceptance flag

This information is not transmitted to the developer.

The extension does not store full proxy URLs containing credentials.

## Password storage behavior

- Default: password stays in the current browser session only and is cleared when the browser session ends
- Optional: if you enable **Remember password on this device**, the password is stored locally in your Chrome profile
- Remembered passwords are not encrypted by the extension
- Do not enable Remember password on shared or untrusted devices
- After browser restart, the proxy is not connected automatically; you must click **Connect** again

## Data sharing

We do not share user data with third parties.

The extension does not include analytics SDKs, advertising SDKs, or remote configuration services.

## Connection test

The **Test connection** button is optional and runs only when you click it. When clicked, the extension requests
`https://www.gstatic.com/generate_204` from the background service worker and treats HTTP 204 as success.

This check is never automatic. It does not send proxy settings, credentials, profile names, browsing history, or any
data to the developer.

## Remote code

The extension does not load remote code. All extension code is packaged locally with the extension.

## Permissions

The extension requests Chrome permissions only to:

- apply and clear the user's proxy configuration
- store user preferences and credentials locally
- respond to proxy authentication challenges for the configured proxy

These permissions are not used to collect browsing history or monitor website activity for the developer.

## User responsibility

You are responsible for:

- providing your own proxy server details
- complying with applicable laws
- complying with website terms of service
- complying with your proxy provider's terms

## Data deletion

You can remove locally stored proxy settings and credentials at any time using **Forget saved data** in the extension popup.

Uninstalling the extension removes extension storage from your browser profile.

## Children

This extension is not directed to children under 13, and we do not knowingly collect personal information from children.

## Changes

If this privacy policy changes, the updated version will be included with the extension package and published with future releases.

## Contact

**Support contact:** asiatabd03@gmail.com  
**Repository:** https://github.com/sugarufc/Chrome-proxy-extension
