# Product specification

The V1 product is a calm macOS and Windows notebook and Markdown reader/editor. Its primary layout is a compact hierarchical sidebar plus a readable document surface. The app supports notebooks, sections, pages, soft deletion, favorites, recents, autosave, global search, and external Markdown in Preview, Edit, and Split modes.

The visual system prioritizes Segoe UI typography, whitespace, a restrained neutral palette, an 880px reading column, strong Markdown rhythm, and clearly separated code blocks. Light mode is primary; dark and system themes remain tasteful and low contrast.

Pages created explicitly with a section's `+` control are sidebar pages. Pages created with the editor's `/ → Page` command prompt for a name and become inline child pages: that name is both the page heading and inline link text. Child pages remain stored inside the same notebook and are searchable and backed up, but they do not appear in the section tree, Favorites, Recent, or Trash. Following an internal page link navigates within the current tab; Back and Forward return through that tab's page history.

Notebook and section overflow menus expose creation and permanent deletion. Deleting either container requires confirmation and cascades to both sidebar and inline child pages. Recent pages are collapsible.

Pasted and uploaded images are selectable editor nodes. Selecting an image reveals resize handles on its left and right edges and corners; dragging a handle changes the image width while preserving its aspect ratio. The responsive width is stored with the note and represented in its generated Markdown so Edit and Read modes remain consistent.

Slash commands are keyboard-first. Typing `/` opens a searchable command menu; continuing with a command name filters it, arrow keys change the selection, and Enter or Tab runs it. `/page` opens the child-page naming dialog immediately, while commands such as `/code`, `/divider`, `/image`, `/table`, headings, and lists insert their blocks directly.

Code blocks support explicit link marks in Edit mode. HTTP and HTTPS URLs inside code blocks are also detected and clickable in Read mode, where they open through the operating system browser.

Markdown documents opened from disk support links to other Markdown files. Relative paths are resolved from the current document's folder, URL-encoded filenames and heading fragments are accepted, and the target opens or activates as another tab inside Notes. Missing, moved, non-Markdown, and unsupported links show a clear error instead of opening an unsafe path.

Direct cloud accounts, live multi-device editing, collaboration, AI, databases, canvases, and other generalized productivity features are intentionally excluded. Disaster recovery is included through portable `.notesbackup` archives. Users can place these archives in OneDrive or Google Drive desktop-synced folders without giving Notes cloud credentials.

## Backup and recovery

- A backup is one compressed, integrity-checked file containing a consistent SQLite snapshot, settings, drafts, and all managed attachments.
- Users can create a backup immediately or schedule it daily or weekly while Notes is running.
- Retention is configurable from 5 to 50 backups; only files created by Notes are eligible for cleanup.
- Restore validates the archive and its database, creates a safety backup of the current library, then restarts and applies the replacement before SQLite opens.
- Backup folder detection labels OneDrive, Google Drive, and ordinary local folders. Cloud transfer is performed by the provider's desktop sync client.
