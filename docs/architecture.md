# Architecture

Notes is a local-first Electron application with three explicit trust boundaries.

- The Electron main process owns SQLite, native dialogs, filesystem reads/writes, recovery drafts, attachments, window lifecycle, and safe external-link handling.
- A context-isolated preload exposes a narrow, typed API. Every request is validated again in the main process.
- The React renderer owns presentation, transient UI state, the ProseMirror-based editor, Markdown preview, tabs, and keyboard interaction. It has no Node.js access.

Internal notes are persisted as editor HTML plus clean Markdown. External Markdown remains raw source at its original path and is never silently imported. Search uses SQLite FTS5 with bounded queries and note bodies are loaded lazily.

Build output is split into `dist/main` and `dist/renderer`. Electron Builder produces the Windows NSIS installer and an optional `.md` file association.

Backups use a versioned gzip archive with per-entry SHA-256 checksums. SQLite's online backup API produces a consistent database snapshot while the app remains open. Restore extraction rejects absolute paths and path traversal, verifies each entry, runs SQLite `quick_check`, and confirms the required schema. A pending restore is applied during the next startup before the repository opens, with rollback copies retained until both the database and attachment replacement succeed.
