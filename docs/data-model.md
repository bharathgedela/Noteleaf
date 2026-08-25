# Data model

Schema changes are versioned in ordered migrations.

- `notebooks`: stable ID, name, position, timestamps.
- `sections`: stable ID, notebook foreign key, name, position, timestamps.
- `pages`: stable ID, section foreign key, optional parent-page foreign key, title, editor HTML, Markdown, position, sidebar-visibility/favorite/deleted flags, timestamps and last-opened time. Inline child pages use `sidebar_visible = 0`.
- `tags` and `page_tags`: normalized page metadata.
- `recent_files`: external path, filename, last-opened time, preferred view mode.
- `external_drafts`: crash-recovery source keyed by path and updated time.
- `settings`: compact key/value application preferences.
- `pages_fts`: FTS5 index for page title and Markdown body, maintained by triggers.

Notebook and section deletion are guarded by confirmation and cascade to their children. Page deletion is soft by default.
