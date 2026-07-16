# Manual Test Checklist

Use this checklist before submitting to the Chrome Web Store.

## Setup

- [ ] Load unpacked extension or install from ZIP
- [ ] Confirm disclaimer appears on first run
- [ ] Confirm the toggle is unavailable until disclaimer is accepted

## Proxy input

- [ ] Pasting `scheme://user:pass@host:port` parses correctly
- [ ] Pasting `host:port` parses as HTTP without auth
- [ ] Pasting `user:pass@host:port` parses as HTTP with auth
- [ ] Pasting `host:port:user:pass` (seller format) parses correctly
- [ ] Invalid input shows a clear error and the toggle snaps back to off
- [ ] After connecting, the input shows the password masked as `******`
- [ ] Reconnecting with the masked string uses the real saved password

## Proxy connection

- [ ] HTTP proxy without auth connects with the toggle
- [ ] HTTP proxy with auth connects with the toggle
- [ ] HTTPS proxy with auth connects with the toggle
- [ ] SOCKS5 proxy with credentials shows the Chrome limitation notice
- [ ] SOCKS5 without credentials can connect
- [ ] The connection test runs automatically after turning the proxy on and shows latency
- [ ] Clicking the status line re-runs the connection test
- [ ] Test failure shows a warning but keeps the proxy connected
- [ ] Switching the profile dropdown while connected keeps proxy auth working for the connected proxy
- [ ] Deleting a profile while connected keeps proxy auth working for the connected proxy
- [ ] Common proxy errors (e.g. `net::ERR_PROXY_CONNECTION_FAILED`) show a human-readable hint
- [ ] Wrong password shows a safe error and does not log credentials

## Keyboard shortcut

- [ ] `Alt+Shift+P` turns the proxy on using the saved settings
- [ ] `Alt+Shift+P` turns the proxy off when connected
- [ ] The toolbar icon reflects the state after using the shortcut

## Session and storage behavior

- [ ] Local addresses (`localhost`, `127.0.0.1`, `<local>`) always connect directly, without the proxy
- [ ] Existing single `proxyProfile` is migrated to a `Default` saved profile
- [ ] Saved profile list survives popup close/reopen
- [ ] Deleting a saved profile removes it from the list without exposing passwords
- [ ] Turning the toggle off clears the session but keeps the saved password
- [ ] After a browser restart with the proxy on, it reconnects automatically
- [ ] After a browser restart with the proxy off, it stays off
- [ ] **Forget saved data** clears local and session storage and shows the disclaimer again

## Security checks

- [ ] No full proxy URL with credentials is stored in `chrome.storage.local`
- [ ] Console does not print password, auth object, or full storage state
- [ ] Error messages shown in UI do not expose credentials
- [ ] The popup never renders the saved password in clear text
- [ ] Regular website auth challenge does not receive proxy credentials
- [ ] Proxy auth challenge for a different host/port does not receive proxy credentials

## UI checks

- [ ] The toggle reflects the real connection state
- [ ] Status line shows `Working · N ms` after a successful check
- [ ] Failed checks show a short plain-language message without `net::` codes
- [ ] Profile dropdown appears only when at least one profile is saved
- [ ] Save as profile stores name, scheme, host, port, and username only
- [ ] Delete profile removes the selected profile
- [ ] Forget saved data link works

## Permissions and packaging

- [ ] Extension works with only required permissions
- [ ] CSP is present in manifest
- [ ] ZIP build excludes dev files, `.git`, `.DS_Store`, and secrets
- [ ] No remote scripts, analytics, or hidden network requests from extension code
- [ ] No connection test request is made while the proxy is off

## Documentation

- [ ] README is accurate
- [ ] PRIVACY.md is published at a public URL
- [ ] Store listing text matches actual behavior
