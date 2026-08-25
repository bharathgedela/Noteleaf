# Implementation plan

1. Establish Electron/Vite/React/TypeScript, secure preload IPC, SQLite migrations, and packaging.
2. Implement repositories and IPC for the notebook/section/page tree, soft deletion, favorites, and recents.
3. Build the sidebar, tabs, Tiptap editor, autosave status, and empty state.
4. Build GFM preview and distinct Shiki code blocks, then external Markdown open/edit/split/save/recovery and internal import/export.
5. Add FTS search, quick open, shortcuts, settings, themes, native menus, and filesystem launch handling.
6. Test persistence, Markdown conversion, external file edge cases, recovery, search, migrations, production builds, and Windows packaging.
