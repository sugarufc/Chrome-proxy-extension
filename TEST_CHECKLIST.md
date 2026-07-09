# Manual Test Checklist

Use this checklist before submitting to the Chrome Web Store.

## Setup

- [ ] Load unpacked extension or install from ZIP
- [ ] Confirm disclaimer appears on first run
- [ ] Confirm **Connect** is unavailable until disclaimer is accepted

## Proxy connection

- [ ] HTTP proxy without auth connects successfully
- [ ] HTTP proxy with auth connects successfully
- [ ] HTTPS proxy with auth connects successfully
- [ ] SOCKS5 proxy with auth is blocked with a clear Chrome limitation message
- [ ] Saved profile connects with one profile selection plus **Connect**
- [ ] Switching the profile dropdown while connected keeps proxy auth working for the connected proxy
- [ ] Deleting a profile while connected keeps proxy auth working for the connected proxy
- [ ] **Test connection** returns OK only after explicit click
- [ ] **Test connection** reports whether it ran through the active proxy or a direct connection
- [ ] **Test connection** timeout/failure shows a safe error
- [ ] **Test connection** produces no CSP violation in the service worker console
- [ ] Common proxy errors (e.g. `net::ERR_PROXY_CONNECTION_FAILED`) show a human-readable hint
- [ ] Wrong password shows a safe error and does not log credentials
- [ ] Wrong host shows a safe error
- [ ] Wrong port shows a safe error

## Session and storage behavior

- [ ] Default password storage uses session only
- [ ] Local addresses (`localhost`, `127.0.0.1`, `<local>`) always connect directly, without the proxy
- [ ] Existing single `proxyProfile` is migrated to a `Default` saved profile
- [ ] Saved profile list survives popup close/reopen
- [ ] Deleting a saved profile removes it from the list without exposing passwords
- [ ] **Disconnect** clears session password and active auth state
- [ ] **Disconnect** keeps local saved password when Remember password is enabled
- [ ] **Disconnect** removes local saved password when Remember password is disabled
- [ ] **Forget saved data** clears local and session storage
- [ ] After browser restart with Remember password disabled, proxy is not auto-connected and password field is empty
- [ ] After browser restart with Remember password enabled, saved profile and password are restored in UI
- [ ] After browser restart with Remember password enabled, user must click **Connect** manually
- [ ] Connect works after restart using saved password without retyping it

## Security checks

- [ ] No full proxy URL with credentials is stored in `chrome.storage.local`
- [ ] Password appears in `chrome.storage.local` only when Remember password is enabled
- [ ] Console does not print password, auth object, or full storage state
- [ ] Error messages shown in UI do not expose credentials
- [ ] Regular website auth challenge does not receive proxy credentials
- [ ] Proxy auth challenge for a different host/port does not receive proxy credentials

## UI checks

- [ ] Scheme select supports `http`, `https`, `socks5`
- [ ] SOCKS5 with username/password is blocked with a clear Chrome limitation message
- [ ] SOCKS5 without credentials can connect
- [ ] Password field uses `type="password"`
- [ ] Show/Hide password works
- [ ] Remember password checkbox works
- [ ] Save as profile button stores name, scheme, host, port, and username only
- [ ] Delete profile button removes selected profile
- [ ] Remember password warning text is visible
- [ ] Connected state shows the active proxy summary line
- [ ] No Device PIN UI is shown
- [ ] Forget saved data button works

## Permissions and packaging

- [ ] Extension works with only required permissions
- [ ] CSP is present in manifest
- [ ] ZIP build excludes dev files, `.git`, `.DS_Store`, and secrets
- [ ] No remote scripts, analytics, or hidden network requests from extension code
- [ ] No connection test request is made until **Test connection** is clicked

## Documentation

- [ ] README is accurate
- [ ] PRIVACY.md is published at a public URL
- [ ] Store listing text matches actual behavior
