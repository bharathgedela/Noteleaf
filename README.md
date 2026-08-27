# Notes Desktop

A local-first notebook and Markdown reader/editor for macOS and Windows.

## Features

- Organize local notes into notebooks, sections, and linked child pages
- Scroll large notebook trees independently while keeping search and Trash accessible
- Empty every trashed page at once after a safety confirmation
- Open, preview, edit, and save Markdown files
- Browse every Markdown file in a folder from a collapsible tree
- Follow relative links between Markdown documents inside Notes
- Move between linked pages or adjacent open tabs with the back and forward arrows
- Back up the local notes library to a local or synced folder

## Requirements

- Node.js 22
- npm 10 or newer
- macOS on Apple Silicon for the default Mac package

## Development

```sh
npm ci
npm run dev
```

## Verification

```sh
npm run typecheck
npm run lint
npm test
```

## Build for macOS

Build the Apple Silicon app, DMG installer, and ZIP archive:

```sh
npm run dist:mac
```

Artifacts are written to `release/`. For an Intel Mac, use
`npm run dist:mac:x64` instead.

Electron Builder signs automatically when a Developer ID certificate is
available. Distribution to other Macs also requires Apple notarization
credentials; local builds work without notarization.

## Build for Windows

```sh
npm run dist:win
```
