# Licensing and redistribution

Noteleaf is distributed under Apache License 2.0. The canonical license text is in `LICENSE`, and project attribution is in `NOTICE`.

## Release compliance checklist

1. Keep `license: "Apache-2.0"` in `package.json`.
2. Run `npm run license:audit` after every dependency change. The check fails on a missing or unapproved production dependency license.
3. Run `npm run license:notices` and commit the generated `THIRD_PARTY_NOTICES.md` and `THIRD_PARTY_LICENSES.txt` files.
4. Confirm the installer contains `licenses/LICENSE`, `licenses/NOTICE`, `licenses/THIRD_PARTY_NOTICES.md`, and `licenses/THIRD_PARTY_LICENSES.txt`.
5. Preserve Electron's bundled `LICENSE` and `LICENSES.chromium.html` files.
6. Preserve upstream copyright, patent, trademark, and attribution notices when modifying or redistributing third-party code.
7. Mark modified third-party source files prominently when Apache License 2.0 section 4(b) applies.

The production dependency audit currently accepts Apache-2.0, MIT, ISC, BSD-2-Clause, and BSD-3-Clause. It also accepts an SPDX `OR` expression when at least one listed choice is in that set. This is a technical policy gate, not a substitute for legal review.

## Logo and project name

The original Noteleaf logo artwork and generated icon variants are part of the Apache-2.0-licensed Work. Apache License 2.0 does not itself grant trademark rights except for reasonable and customary use in describing the Work's origin.

## Internal compatibility names

Some internal identifiers intentionally retain `notes`, including the SQLite filename, `.notesbackup` extension, preload API name, browser protocol, and saved preference keys. They are not user-facing branding; retaining them prevents data loss and preserves compatibility with pre-1.0 libraries and backups.
