import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NotesRepository } from './repository.js';

describe('NotesRepository', () => {
  let directory: string;
  let repository: NotesRepository | undefined;

  beforeEach(() => {
    directory = join(process.cwd(), `.test-notes-${randomUUID()}`);
    mkdirSync(directory, { recursive: true });
    repository = new NotesRepository(join(directory, 'notes.db'));
  });

  afterEach(() => {
    repository?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('runs migrations and seeds the first-run onboarding guide once', () => {
    const navigation = repository!.navigation();
    expect(navigation.notebooks[0]?.name).toBe('Welcome');
    expect(navigation.notebooks[0]?.sections[0]?.name).toBe('Getting Started');
    expect(navigation.notebooks[0]?.sections[0]?.pages[0]?.title).toBe('Welcome to Noteleaf');
    expect(repository!.getPage(navigation.notebooks[0].sections[0].pages[0].id).contentMarkdown).toContain('Essential shortcuts');
    const migration = repository!.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number };
    expect(migration.version).toBe(4);
  });

  it('supports notebook, section, and page CRUD with autosave content', () => {
    const notebook = repository!.createNotebook('Personal');
    const section = repository!.createSection(notebook.id, 'Ideas');
    repository!.renameNotebook(notebook.id, 'Personal notes');
    repository!.renameSection(section.id, 'Product ideas');
    const renamedNotebook = repository!.navigation().notebooks.find((item) => item.id === notebook.id);
    expect(renamedNotebook?.name).toBe('Personal notes');
    expect(renamedNotebook?.sections[0]?.name).toBe('Product ideas');
    const created = repository!.createPage(section.id, 'App idea');
    const saved = repository!.savePage(created.id, {
      title: 'Calm notes app',
      contentHtml: '<h2>Fast</h2><p>Local first.</p>',
      contentMarkdown: '## Fast\n\nLocal first.',
    });
    expect(saved.title).toBe('Calm notes app');
    expect(repository!.getPage(created.id).contentMarkdown).toContain('Local first');
    repository!.renamePage(created.id, 'Renamed');
    expect(repository!.getPage(created.id).title).toBe('Renamed');
    repository!.removeSection(section.id);
    expect(() => repository!.getPage(created.id)).toThrow('Page not found');
  });

  it('indexes saved content with FTS5 and excludes trashed pages', () => {
    const seededSection = repository!.navigation().notebooks[0].sections[0];
    const created = repository!.createPage(seededSection.id, 'Glue pipeline');
    repository!.savePage(created.id, { title: 'Glue pipeline', contentHtml: '<p>incremental ingestion control</p>', contentMarkdown: 'incremental ingestion control' });
    expect(repository!.fullSearch('incremental ingestion')).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id })]));
    repository!.trashPage(created.id);
    expect(repository!.fullSearch('incremental ingestion').some((item) => item.id === created.id)).toBe(false);
    repository!.restorePage(created.id);
    expect(repository!.fullSearch('incremental ingestion').some((item) => item.id === created.id)).toBe(true);
  });

  it('moves pages, toggles favorites, and permanently removes trash', () => {
    const notebook = repository!.createNotebook('Move target');
    const section = repository!.createSection(notebook.id, 'Destination');
    const sourcePage = repository!.navigation().notebooks[0].sections[0].pages[0];
    repository!.movePage(sourcePage.id, section.id, 0);
    expect(repository!.getPage(sourcePage.id).sectionId).toBe(section.id);
    repository!.toggleFavorite(sourcePage.id);
    expect(repository!.navigation().favorites.some((item) => item.id === sourcePage.id)).toBe(true);
    repository!.trashPage(sourcePage.id);
    repository!.removePage(sourcePage.id);
    expect(() => repository!.getPage(sourcePage.id)).toThrow();
  });

  it('persists drag ordering for notebooks, sections, and sidebar pages', () => {
    const notebook = repository!.createNotebook('Reorder me');
    const otherNotebook = repository!.createNotebook('Move sections here');
    repository!.moveNotebook(otherNotebook.id, 0);
    expect(repository!.navigation().notebooks[0].id).toBe(otherNotebook.id);

    const firstSection = repository!.createSection(notebook.id, 'First');
    const secondSection = repository!.createSection(notebook.id, 'Second');
    repository!.moveSection(secondSection.id, notebook.id, 0);
    expect(repository!.navigation().notebooks.find((item) => item.id === notebook.id)?.sections[0].id).toBe(secondSection.id);
    repository!.moveSection(secondSection.id, otherNotebook.id, 0);
    expect(repository!.navigation().notebooks.find((item) => item.id === otherNotebook.id)?.sections[0].id).toBe(secondSection.id);

    const firstPage = repository!.createPage(firstSection.id, 'First page');
    const secondPage = repository!.createPage(firstSection.id, 'Second page');
    repository!.movePage(secondPage.id, firstSection.id, 0);
    expect(repository!.navigation().notebooks.find((item) => item.id === notebook.id)?.sections.find((item) => item.id === firstSection.id)?.pages[0].id).toBe(secondPage.id);
    repository!.movePage(firstPage.id, secondSection.id, 0);
    expect(repository!.navigation().notebooks.find((item) => item.id === otherNotebook.id)?.sections[0].pages[0].id).toBe(firstPage.id);
  });

  it('permanently removes every trashed page at once', () => {
    const section = repository!.navigation().notebooks[0].sections[0];
    const first = repository!.createPage(section.id, 'Old draft');
    const second = repository!.createPage(section.id, 'Old checklist');
    const kept = repository!.createPage(section.id, 'Keep me');
    repository!.trashPage(first.id);
    repository!.trashPage(second.id);

    expect(repository!.emptyTrash()).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(repository!.navigation().trash).toHaveLength(0);
    expect(() => repository!.getPage(first.id)).toThrow();
    expect(() => repository!.getPage(second.id)).toThrow();
    expect(repository!.getPage(kept.id).title).toBe('Keep me');
  });

  it('keeps inline child pages out of sidebar navigation and recents', () => {
    const section = repository!.navigation().notebooks[0].sections[0];
    const parent = section.pages[0];
    const child = repository!.createPage(section.id, 'Inline child', { sidebarVisible: false, parentPageId: parent.id });
    expect(child).toMatchObject({ isSidebarVisible: false, parentPageId: parent.id });
    expect(repository!.navigation().notebooks[0].sections[0].pages.some((item) => item.id === child.id)).toBe(false);
    expect(repository!.navigation().recent.some((item) => item.id === child.id)).toBe(false);
    expect(repository!.getPage(child.id).title).toBe('Inline child');
  });

  it('tracks daily tasks independently from notes', () => {
    const first = repository!.createTask('Review ingestion alerts', '2026-08-27');
    const second = repository!.createTask('Prepare stand-up notes', '2026-08-27');
    expect(repository!.tasksForDate('2026-08-27')).toHaveLength(2);
    expect(repository!.updateTask(first.id, { status: 'in_progress' })).toMatchObject({ status: 'in_progress', completedAt: null });
    expect(repository!.updateTask(first.id, { status: 'done' }).completedAt).toBeTruthy();
    repository!.updateTask(second.id, { title: 'Prepare daily update', taskDate: '2026-08-28' });
    expect(repository!.tasksForDate('2026-08-27')).toEqual([expect.objectContaining({ id: first.id, status: 'done' })]);
    expect(repository!.tasksForDate('2026-08-28')[0]).toMatchObject({ id: second.id, title: 'Prepare daily update' });
    repository!.removeTask(first.id);
    expect(repository!.tasksForDate('2026-08-27')).toHaveLength(0);
  });

  it('persists settings, recent file modes, and external recovery drafts', () => {
    expect(repository!.getSettings().theme).toBe('light');
    expect(repository!.getSettings().backupFrequency).toBe('hourly');
    expect(repository!.updateSettings({ theme: 'dark', lineWidth: 920 })).toMatchObject({ theme: 'dark', lineWidth: 920 });
    repository!.rememberFile('C:\\notes\\architecture.md', 'architecture.md', 'split');
    expect(repository!.recentFiles()[0]).toMatchObject({ filename: 'architecture.md', viewMode: 'split' });
    repository!.saveDraft('C:\\notes\\architecture.md', '# Recovered');
    expect(repository!.getDraft('C:\\notes\\architecture.md')).toBe('# Recovered');
    repository!.clearDraft('C:\\notes\\architecture.md');
    expect(repository!.getDraft('C:\\notes\\architecture.md')).toBeUndefined();
  });
});
