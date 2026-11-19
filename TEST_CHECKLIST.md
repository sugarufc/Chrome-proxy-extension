# Manual Test Checklist

Use this checklist before submitting to the Chrome Web Store.

## First run

- [ ] Load unpacked extension or install from ZIP
- [ ] The disclaimer appears and the toggle is unavailable until it is accepted

## Proxy input

- [ ] `scheme://user:pass@host:port`, `user:pass@host:port`, `host:port` and `host:port:user:pass` all work
- [ ] A password containing `@`, `:` or `/` works in `host:port:user:pass`
- [ ] Invalid input shows a clear error and the toggle snaps back to off
- [ ] Enter in the input field turns the proxy on

## Connection

- [ ] HTTP proxy without auth connects; websites load through it (check your IP)
- [ ] HTTP proxy with auth connects
- [ ] HTTPS proxy with auth connects
- [ ] An IPv6 proxy in brackets (`http://[2001:db8::1]:3128`) connects, if one is available
- [ ] SOCKS5 input is rejected
- [ ] Wrong password: the proxy turns off by itself, the icon shows `!` and the popup says why
- [ ] `localhost` and `127.0.0.1` are opened directly, without the proxy
- [ ] A website's own login prompt never receives the proxy credentials
- [ ] Another proxy extension taking over (enable it while connected): the proxy turns off and the popup says why

## Shortcut, icon and restart

- [ ] `Alt+Shift+P` turns the proxy on, and off again
- [ ] The toolbar icon shows the on/off state, including after the shortcut
- [ ] After a browser restart with the proxy on, it reconnects without a sign-in dialog
- [ ] After a browser restart with the proxy off, it stays off
- [ ] Updating from 3.x keeps the proxy that was in use

## Data

- [ ] The proxy survives closing and reopening the popup
- [ ] **Forget saved data** (two clicks) removes the proxy and shows the disclaimer again
- [ ] No credentials in the console

## Packaging

- [ ] `./scripts/build.sh` creates `dist/proxy-switcher.zip` with only runtime files
- [ ] No remote scripts and no network requests from extension code
