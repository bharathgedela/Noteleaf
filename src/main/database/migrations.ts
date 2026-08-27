import type Database from 'better-sqlite3';

interface Migration {
  version: number;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE notebooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sections (
        id TEXT PRIMARY KEY,
        notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE pages (
        id TEXT PRIMARY KEY,
        section_id TEXT NOT NULL REFERENCES sections(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        content_html TEXT NOT NULL DEFAULT '<p></p>',
        content_markdown TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        is_favorite INTEGER NOT NULL DEFAULT 0,
        is_deleted INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT
      );
      CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE);
      CREATE TABLE page_tags (
        page_id TEXT NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (page_id, tag_id)
      );
      CREATE TABLE recent_files (
        path TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        last_opened_at TEXT NOT NULL,
        view_mode TEXT NOT NULL DEFAULT 'preview'
      );
      CREATE TABLE external_drafts (
        path TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE VIRTUAL TABLE pages_fts USING fts5(
        page_id UNINDEXED,
        title,
        body,
        tokenize='unicode61 remove_diacritics 2'
      );
      CREATE TRIGGER pages_fts_insert AFTER INSERT ON pages WHEN new.is_deleted = 0 BEGIN
        INSERT INTO pages_fts(page_id, title, body) VALUES (new.id, new.title, new.content_markdown);
      END;
      CREATE TRIGGER pages_fts_update AFTER UPDATE ON pages BEGIN
        DELETE FROM pages_fts WHERE page_id = old.id;
        INSERT INTO pages_fts(page_id, title, body)
          SELECT new.id, new.title, new.content_markdown WHERE new.is_deleted = 0;
      END;
      CREATE TRIGGER pages_fts_delete AFTER DELETE ON pages BEGIN
        DELETE FROM pages_fts WHERE page_id = old.id;
      END;
      CREATE INDEX sections_notebook_position ON sections(notebook_id, position);
      CREATE INDEX pages_section_position ON pages(section_id, position);
      CREATE INDEX pages_recent ON pages(is_deleted, last_opened_at DESC);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE pages ADD COLUMN sidebar_visible INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE pages ADD COLUMN parent_page_id TEXT REFERENCES pages(id) ON DELETE SET NULL;
      UPDATE pages AS child
      SET sidebar_visible = 0,
          parent_page_id = (
            SELECT parent.id FROM pages AS parent
            WHERE parent.id <> child.id
              AND parent.content_html LIKE '%notes://page/' || child.id || '%'
            ORDER BY parent.created_at
            LIMIT 1
          )
      WHERE EXISTS (
        SELECT 1 FROM pages AS parent
        WHERE parent.id <> child.id
          AND parent.content_html LIKE '%notes://page/' || child.id || '%'
      );
      CREATE INDEX pages_parent ON pages(parent_page_id);
      CREATE INDEX pages_sidebar ON pages(section_id, sidebar_visible, is_deleted, position);
    `,
  },
  {
    version: 3,
    sql: `
      UPDATE settings
      SET value = '"hourly"'
      WHERE key = 'backupFrequency'
        AND value = '"off"'
        AND EXISTS (
          SELECT 1 FROM settings
          WHERE key = 'backupFolder'
            AND value NOT IN ('""', 'null')
        );
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const current = db.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as { version: number };
  const apply = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(migration.version, new Date().toISOString());
  });
  for (const migration of migrations) {
    if (migration.version > current.version) apply(migration);
  }
}
