# Releasing Noteleaf

## Before packaging

1. Confirm `package.json` and `package-lock.json` use the intended semantic version.
2. Regenerate icons on Windows with `npm run icons` after changing `assets/noteleaf-logo.png`.
3. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run license:audit`, `npm run license:notices`, and `npm run build`.
4. Confirm generated notices have no uncommitted changes.
5. Review `git diff` and create an annotated `v<version>` tag from the release commit.

## Windows

Run `npm run dist:win` on Windows. Inspect `release/Noteleaf-Setup.exe`, install it, launch it, create/edit a note, create a backup, and verify the uninstaller does not remove application data.

## macOS

Run `npm run dist:mac` on Apple Silicon and `npm run dist:mac:x64` on Intel hardware (or equivalent macOS CI runners). Inspect `release/Noteleaf-arm64.dmg` and `release/Noteleaf-x64.dmg`, open the app, verify Command-key shortcuts and file associations, and smoke-test editing, Tasks, Markdown links, and backups.

Public macOS releases must be Developer ID signed, notarized, stapled, and validated. Apple private keys stay on the maintainer's Mac; do not upload them to GitHub. Use the local `noteleaf-notary` Keychain profile with `notarytool`. Never publish an unsigned macOS build.

Build the signed apps with Electron Builder, submit their ZIPs to Apple, then staple and validate the apps. Recreate ZIPs from the stapled apps. Build the final DMGs with Electron Builder's `--prepackaged` option from those same stapled apps, then submit, staple, and validate each DMG. Keep submission IDs and wait for `Accepted`; do not duplicate an in-progress submission. Validate the app inside each final mounted DMG with `codesign --verify --deep --strict`, `xcrun stapler validate`, and `spctl --assess --type execute` (must report `Notarized Developer ID`). Also run `hdiutil verify` and `xcrun stapler validate` on the final DMGs.

## Publish

Push the release commit and annotated tag only after CI succeeds. `.github/workflows/release.yml` builds Windows and creates a **draft**, not a public release. Build and notarize Apple Silicon and Intel assets locally from that exact tagged commit. Upload only the verified `Noteleaf-arm64.dmg`, `Noteleaf-arm64.zip`, `Noteleaf-x64.dmg`, and `Noteleaf-x64.zip` to the draft. Preserve these stable names because the install scripts use them.

Download the draft's Windows installer into the same asset directory. Generate `SHA256SUMS.txt` for all five final installers only after stapling and upload it. Confirm every asset, version, signature, Apple ticket, and checksum before publishing the draft as the latest release. The curl installer resolves `/releases/latest/download`; it cannot see draft releases, so users keep receiving the previous version until the verified release is published. Smoke-test the exact downloadable artifact before announcing it.
