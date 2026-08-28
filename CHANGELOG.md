# Changelog

All notable changes to Noteleaf are documented here.

## Unreleased

- Adds linked Markdown shortcuts to notebook sections, preserving the source file and its relative links instead of copying rendered content into an internal page.
- Adds **Add to notebook** to open Markdown documents and **Add Markdown file…** to section menus.
- Uses one tab-free notebook workspace for sidebar pages, reserves tabs for external Markdown files, moves sidebar collapse beside the notebook `+`, and adds an always-available Home button.
- Keeps external Markdown actions visible beside a compact, ellipsized file path; the full source path remains available on hover.

## 1.0.1 — 2026-08-28

- Reworks the Noteleaf icon with a deep emerald tile, warm off-white page, and saturated green leaf for strong contrast in the Windows taskbar and macOS Dock.
- Enlarges and simplifies the central mark so it remains recognizable at 16–32 px.
- Preserves source aspect ratio while generating Windows PNG/ICO and macOS PNG icon sizes.

## 1.0.0 — 2026-08-28

First public Noteleaf release.

- Introduces the Noteleaf name, original page-and-leaf logo, application icons, homepage, and installer identity.
- Preserves pre-1.0 Notes libraries through a non-destructive first-launch migration and retains legacy backup compatibility.
- Provides notebooks, sections, linked child pages, rich editing, code formatting, resizable images, and drag ordering.
- Adds Markdown file/folder workflows, safe relative document links, tab history, and collapsible navigation.
- Adds daily Tasks, Trash management, one-click backups, hourly automatic backup, cloud-synced-folder support, and validated restore.
- Adds Windows and macOS keyboard behavior, platform font fallbacks, packaging instructions, and dual-platform CI.
- Publishes under Apache License 2.0 with dependency auditing, generated notices, contribution guidance, and a security policy.
