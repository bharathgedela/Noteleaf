# Changelog

All notable changes to Noteleaf are documented here.

## 1.0.5 — 2026-08-28

- Prevents notebook color collisions so the first eight visible notebooks always receive distinct colors on both macOS and Windows.
- Adds a checksum-verified raw-content fallback for Windows networks and virtual machines that cannot reach GitHub's release-asset host.

## 1.0.4 — 2026-08-28

- Shows a stable numeric percentage and downloaded/total size while the one-command macOS installer fetches the Noteleaf DMG, using GitHub release metadata so macOS responses without `Content-Length` still report progress.
- Shows the same numeric percentage and downloaded/total size while the one-command Windows installer fetches Noteleaf Setup.
- Improves homepage readability with larger card headings, descriptions, note rows, timestamps, tips, actions, shortcuts, and footer links.
- Keeps generated third-party notices synchronized with the application version in CI.

## 1.0.3 — 2026-08-28

- Fixes tagged release packaging by preventing Electron Builder from attempting an implicit publish in each platform job; one dedicated workflow job now publishes the verified artifacts.
- Updates the GitHub checkout and Node setup actions to their Node 24-compatible major versions.

## 1.0.2 — 2026-08-28

- Adds linked Markdown shortcuts to notebook sections, preserving the source file and its relative links instead of copying rendered content into an internal page.
- Adds **Add to notebook** to open Markdown documents and **Add Markdown file…** to section menus.
- Uses one tab-free notebook workspace for sidebar pages, reserves tabs for external Markdown files, moves sidebar collapse beside the notebook `+`, and adds an always-available Home button.
- Keeps external Markdown actions visible beside a compact, ellipsized file path; the full source path remains available on hover.
- Adds checksum-verified one-command installers and an automated Windows/macOS GitHub release workflow.

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
