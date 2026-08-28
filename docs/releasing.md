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

Unsigned local builds can be used on the build Mac. Public distribution should use a Developer ID Application certificate and Apple notarization credentials supported by Electron Builder. macOS artifacts must be built on macOS; the Windows release job cannot produce a trustworthy signed/notarized DMG.

## Publish

Push the release commit and annotated tag. `.github/workflows/release.yml` builds Windows, Apple Silicon, and Intel assets, generates `SHA256SUMS.txt`, and publishes them to the tag's GitHub release. Confirm the workflow succeeds and smoke-test the README installation commands before announcing the release.
