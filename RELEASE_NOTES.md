# Release Notes — 2.2.0

**Release date:** June 30, 2026

**Package:** `dist/proxy-switcher.zip`

## Summary

Simplified password storage model. Removed Device PIN and local encryption. Remember password now stores the password locally in the Chrome profile when the user opts in.

## Changes

### Removed

- Device PIN UI and validation
- PBKDF2 / AES-GCM password encryption
- `crypto.js`
- Encrypted password blob storage
- Security-theater encryption claims in docs

### Added / changed

- **Remember password off:** password stays in `chrome.storage.session` only
- **Remember password on:** password stored in `chrome.storage.local` in the Chrome profile
- UI warning: saved passwords are stored locally; do not use on shared devices
- After browser restart, saved profile/password can be restored in UI, but user must click **Connect** manually
- Legacy encryption keys are removed on install/update

## Pre-upload checklist

- [x] Version bumped to `2.2.0`
- [x] ZIP rebuilt without `crypto.js`
- [x] Privacy policy updated honestly
- [x] Publish `PRIVACY.md` at a public URL before store submission — https://github.com/sugarufc/Chrome-proxy-extension/blob/main/PRIVACY.md

## Support

Before public launch, you may replace this with a dedicated support inbox.

**Support contact:** asiatabd03@gmail.com
