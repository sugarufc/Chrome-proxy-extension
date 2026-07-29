# Remove SOCKS5 From the Chrome Extension

## Goal

Make Proxy Switcher an HTTP/HTTPS-only Chrome extension. SOCKS5 remains available on the user's proxy server for Telegram and other compatible clients; this change affects only the extension.

## User-facing behavior

- Accept `http://` and `https://` proxy URLs and the existing scheme-less HTTP formats.
- Reject `socks5://` with a concise message that the extension supports only HTTP and HTTPS.
- Remove all SOCKS5 wording and the SOCKS5 authentication warning from the popup.
- Describe the extension as supporting HTTP and HTTPS in its manifest and documentation.

## Stored-data migration

- On extension startup or update, remove saved profiles whose scheme is `socks5`.
- If the selected or active profile is SOCKS5, disconnect it and clear the associated active/session state.
- Preserve all HTTP/HTTPS profiles, credentials, preferences, and disclaimer state.

This prevents an old SOCKS5 profile from remaining selectable after the feature is removed.

## Code changes

- Restrict the shared supported-scheme set to `http` and `https`.
- Remove SOCKS5-specific validation and UI code.
- Add a focused storage migration for legacy SOCKS5 profiles and active state.
- Update runtime copy, README, manifest description, and relevant release documentation.
- Keep the remote SOCKS5 service and the separate proxy-server workspace unchanged.

## Testing

- Parser tests prove HTTP/HTTPS still work and SOCKS5 is rejected.
- Popup source tests prove the SOCKS5 notice is absent.
- Storage tests prove legacy SOCKS5 profiles are removed without affecting HTTP/HTTPS profiles.
- Existing authentication, connection, persistence, lint, formatting, and build checks remain green.

## Non-goals

- Do not remove or reconfigure the SOCKS5 listener on the VPS.
- Do not add a local forwarder or another application.
- Do not change HTTP/HTTPS proxy behavior while removing SOCKS5.
