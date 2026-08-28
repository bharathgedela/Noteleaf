# Releasing Noteleaf

## Before packaging

1. Confirm `package.json` and `package-lock.json` use the intended semantic version.
2. Regenerate icons on Windows with `npm run icons` after changing `assets/noteleaf-logo.png`.
3. Run `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run license:audit`, `npm run license:notices`, and `npm run build`.
4. Confirm generated notices have no uncommitted changes.
5. Review `git diff` and create an annotated `v<version>` tag from the release commit.

## Windows

Run `npm run dist:win` on Windows. Inspect `release/Noteleaf-<version>-Setup.exe`, install it, launch it, create/edit a note, create a backup, and verify the uninstaller does not remove application data.

## macOS

Run `npm run dist:mac` on Apple Silicon and `npm run dist:mac:x64` on Intel hardware (or equivalent macOS CI runners). Open the app, verify Command-key shortcuts and file associations, and smoke-test editing, Tasks, Markdown links, and backups.

Unsigned local builds can be used on the build Mac. Public distribution should use a Developer ID Application certificate and Apple notarization credentials supported by Electron Builder. macOS artifacts must be built on macOS; the Windows release job cannot produce a trustworthy signed/notarized DMG.

## Publish

Push the release commit and annotated tag. Attach the verified Windows installer, macOS DMG files, and macOS ZIP files to a GitHub release. Include a short changelog plus checksums for every artifact.
