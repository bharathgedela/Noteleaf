# Changelog

All notable changes to Noteleaf are documented here.

## 1.2.1 — 2026-09-03

- Updates TipTap and its ProseMirror dependencies to patched releases so the production dependency audit passes with zero known vulnerabilities.

## 1.2.0 — 2026-09-03

- Adds copyable protected text in the rich editor. Selected text can be locked with the shield button to prevent accidental typing, deletion, cutting, pasting, or formatting until it is explicitly unprotected.
- Automatically redacts protected text from MCP page reads and search results, and rejects AI content updates that could overwrite a page containing hidden protected content.

## 1.1.1 — 2026-08-28

- Replaces manual MCP configuration copying with one **Enable AI access** switch.
- Safely configures Claude Desktop automatically on Windows and macOS, preserving unrelated settings and MCP servers.
- Removes only Noteleaf's Claude connection when AI access is disabled and reports malformed Claude configuration without overwriting it.
- Adds clear per-provider status cards, a guided ChatGPT Secure MCP Tunnel action, a separate write-access opt-in, and collapsed technical details.
- Reconciles enabled AI access automatically when Noteleaf starts, so connected clients can query the library directly without per-question scripts.

## 1.1.0 — 2026-08-28

- Adds a built-in Model Context Protocol server for Claude, ChatGPT, Codex, and other compatible AI clients.
- Exposes scalable notebook discovery, section/page listing, full-text search, complete Markdown reads, and daily task status.
- Adds opt-in page and task creation/update tools, with read-only mode as the default and no destructive delete tools.
- Prevents stale AI writes by requiring the latest page revision before every update; supports replace, append, and prepend modes.
- Reads and safely updates linked external Markdown files at their original locations.
- Adds private stdio connections for local clients and a disabled-by-default, tokenized loopback Streamable HTTP endpoint for temporary HTTPS tunnels.
- Adds an **AI & MCP** settings panel with connection status, generated local-client configuration, endpoint copying, and private-link rotation.
- Refreshes clean open pages after MCP changes or when Noteleaf regains focus without discarding unsaved local typing.
- Upgrades Electron to patched release 39.8.10 and keeps the shipped production dependency audit clear; the remaining npm advisory is confined to Electron's development-time archive downloader.

## 1.0.5 — 2026-08-28

- Prevents notebook color collisions so the first eight visible notebooks always receive distinct colors on both macOS and Windows.

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
