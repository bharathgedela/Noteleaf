# Noteleaf

<p align="center">
  <img src="assets/noteleaf-logo.png" alt="Noteleaf page-and-leaf logo" width="144">
</p>

Noteleaf is a polished, local-first notebook, daily task tracker, and Markdown workspace for Windows and macOS. Notes stay on your computer, save automatically, and can be protected with portable backups in a local, OneDrive, or Google Drive-synced folder.

Current release: **1.0.1**

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Highlights

- Organize notes into draggable notebooks, sections, sidebar pages, and linked child pages.
- Write rich notes with headings, lists, tables, links, code blocks, colored text, and edge-resizable images.
- Open individual Markdown files or browse a complete folder tree from a collapsible explorer.
- Follow safe relative links between Markdown documents directly inside Noteleaf.
- Navigate page history and open tabs with working Back and Forward controls.
- Plan daily work in a dedicated Tasks workspace with To do, In progress, and Done states.
- Search across the local library, use focus mode, and switch efficiently from the keyboard.
- Create one-click backups and schedule hourly, daily, or weekly backups with configurable retention.
- Restore integrity-checked `.notesbackup` archives after an automatic safety backup.

## Keyboard shortcuts

| Action | Windows | macOS |
| --- | --- | --- |
| Search notes | `Ctrl+F` | `Command+F` |
| Toggle Tasks / notes | `Ctrl+T` | `Command+T` |
| Switch open tabs | `Ctrl+Tab` | `Command+Tab` |
| Toggle focus mode | `Ctrl+Shift+F` | `Command+Shift+F` |
| Open Settings | `Ctrl+,` | `Command+,` |
| Save external Markdown | `Ctrl+S` | `Command+S` |

## Development

Requirements: Node.js 22 and npm 10 or newer.

```sh
npm ci
npm run dev
```

Run the complete local verification suite:

```sh
npm run typecheck
npm run lint
npm test
npm run license:audit
npm run build
```

## Build installers

Windows x64 (run on Windows):

```powershell
npm run dist:win
```

macOS Apple Silicon or Intel (run on the corresponding Mac):

```sh
npm run dist:mac
npm run dist:mac:x64
```

Artifacts are written to `release/`. macOS distribution outside the developer's machine requires Apple Developer ID signing and notarization. See [docs/releasing.md](docs/releasing.md) for the complete release checklist.

## Upgrading from Notes

Version 1.0.0 introduces the Noteleaf name and application identity. On first launch, Noteleaf copies an existing `Notes` data directory when a Noteleaf library does not already exist. The old directory remains untouched as a recovery copy. Backups named either `Notes-backup-…` or `Noteleaf-backup-…` remain discoverable and restorable.

## Open source and licensing

Noteleaf source code, documentation, and the original logo artwork are licensed under the [Apache License 2.0](LICENSE). Third-party dependency declarations are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), with supplied license and notice texts in `THIRD_PARTY_LICENSES.txt`.

Before changing dependencies, run `npm run license:audit` and regenerate the inventory with `npm run license:notices`. See [docs/licensing.md](docs/licensing.md) for the project's compliance process. This repository's licensing material is engineering guidance and is not legal advice.

Contributions are welcome; read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md) first.
