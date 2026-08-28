# Architecture

Noteleaf is a local-first Electron application with three explicit trust boundaries.

- The Electron main process owns SQLite, native dialogs, filesystem reads/writes, recovery drafts, attachments, window lifecycle, and safe external-link handling.
- A context-isolated preload exposes a narrow, typed API. Every request is validated again in the main process.
- The React renderer owns presentation, transient UI state, the ProseMirror-based editor, Markdown preview, tabs, and keyboard interaction. It has no Node.js access.

Internal notes are persisted as editor HTML plus clean Markdown. External Markdown remains raw source at its original path and is never silently imported. Search uses SQLite FTS5 with bounded queries and note bodies are loaded lazily.

Build output is split into `dist/main` and `dist/renderer`. Electron Builder produces macOS DMG/ZIP artifacts or a Windows NSIS installer and registers supported Markdown file associations.

The renderer uses platform-aware primary shortcuts: Ctrl on Windows and Command on macOS. Native menus use Electron's `CmdOrCtrl` accelerators. Platform-neutral system font stacks include Segoe UI on Windows and the system/SF families on macOS, while code stacks prefer Cascadia and fall back to SF Mono, Menlo, Monaco, Consolas, and Liberation Mono.

The MCP layer reuses the same repository and file services as the desktop IPC layer. It supports a bundled stdio process for private local clients and a disabled-by-default Streamable HTTP listener bound to loopback for tunnel-based remote clients. Read and write tools are registered separately, HTTP endpoints contain a random private token, and page mutations use optimistic revision checks. The renderer refreshes clean pages after MCP change notifications or when the Noteleaf window regains focus.

The 1.0 rebrand changes the Electron application identity from Notes to Noteleaf. Before opening SQLite, startup copies a legacy `Notes` application-data directory only when no Noteleaf database exists. It leaves the old directory intact and continues to recognize both legacy and current backup filenames.

Backups use a versioned gzip archive with per-entry SHA-256 checksums. SQLite's online backup API produces a consistent database snapshot while the app remains open. Restore extraction rejects absolute paths and path traversal, verifies each entry, runs SQLite `quick_check`, and confirms the required schema. A pending restore is applied during the next startup before the repository opens, with rollback copies retained until both the database and attachment replacement succeed.
