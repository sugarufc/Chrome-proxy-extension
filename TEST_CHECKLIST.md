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
- [ ] After connecting, closing and reopening the popup shows the connected proxy (also when it is not a saved profile)

## Proxy connection

- [ ] HTTP proxy without auth connects with the toggle
- [ ] HTTP proxy with auth connects with the toggle
- [ ] HTTPS proxy with auth connects with the toggle
- [ ] SOCKS5 input is rejected before Chrome proxy settings change
- [ ] Turning the proxy on changes the status to connected without starting a connection test
- [ ] Clicking the status line runs the optional connection test and shows latency
- [ ] Test failure shows a warning but keeps the proxy connected
- [ ] Switching the profile dropdown while connected keeps proxy auth working for the connected proxy
- [ ] Deleting a profile while connected keeps proxy auth working for the connected proxy
- [ ] Common proxy errors (e.g. `net::ERR_PROXY_CONNECTION_FAILED`) show a human-readable hint
- [ ] Wrong password shows a safe error, disconnects, and does not log credentials
- [ ] Select a saved profile, type a different proxy, connect: the saved profile keeps its password and the dropdown shows "Unsaved proxy"
- [ ] A failed check names the reason (stopped proxy, wrong host, refused connection) and never shows `net::` codes
- [ ] Right after a browser restart with the proxy on, no Chrome proxy sign-in dialog appears

## Options and profiles

- [ ] Connecting a proxy that is not saved creates a profile named after its host and selects it
- [ ] Rename changes the profile name (Enter saves, Escape cancels)
- [ ] "Block traffic if the proxy login fails": with a wrong password the status shows "Blocked", pages fail to load, and turning the proxy off restores direct browsing
- [ ] "Block WebRTC IP leaks" asks for the privacy permission, and a WebRTC leak test shows no real IP while the proxy is on and after turning it off shows the normal behavior again

## Keyboard shortcut

- [ ] `Alt+Shift+P` turns the proxy on using the saved settings
- [ ] `Alt+Shift+P` turns the proxy off when connected
- [ ] The toolbar icon reflects the state after using the shortcut

## Session and storage behavior

- [ ] Local addresses (`localhost`, `127.0.0.1`, `<local>`) always connect directly, without the proxy
- [ ] Existing single `proxyProfile` is migrated to a saved profile named after its host
- [ ] Existing SOCKS5 profiles are removed while HTTP/HTTPS profiles are preserved
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
- [ ] Regular website auth challenge does not receive proxy credentials
- [ ] Proxy auth challenge for a different host/port does not receive proxy credentials

## UI checks

- [ ] The toggle reflects the real connection state
- [ ] Status line shows `Working · N ms` after a successful check
- [ ] Failed checks show a short plain-language message without `net::` codes
- [ ] Profile dropdown appears only when at least one profile is saved
- [ ] Save as profile stores name, scheme, host, port, and username only (password is kept separately)
- [ ] With a saved profile selected the button says "Update profile"; with "Unsaved proxy" it says "Save as profile"
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
