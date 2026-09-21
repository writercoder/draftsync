/**
 * Unit tests for the SQLite store behind draftsync serve
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import Database from 'better-sqlite3';
import { openStore, STAGES } from '../src/store.js';

describe('Store Unit Tests', () => {
  let tempDir;
  let store;
  let project;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-store-'));
    store = openStore(tempDir);
    project = store.getOrCreateProject('/home/me/my-novel');
  });

  afterEach(() => {
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create the database file in the data directory', () => {
    expect(existsSync(join(tempDir, 'draftsync.db'))).toBe(true);
  });

  describe('projects', () => {
    it('should name the project after its directory', () => {
      expect(project.name).toBe('my-novel');
    });

    it('should return the same project for the same path', () => {
      const again = store.getOrCreateProject('/home/me/my-novel');
      expect(again.id).toBe(project.id);
    });

    it('should keep projects separate by path', () => {
      const other = store.getOrCreateProject('/home/me/other-book');
      expect(other.id).not.toBe(project.id);
    });
  });

  describe('chapters', () => {
    it('should create chapters at the end of a stage', () => {
      const a = store.createChapter(project.id, { title: 'Chapter 1' });
      const b = store.createChapter(project.id, { title: 'Chapter 2' });
      expect(a.stage).toBe('drafting');
      expect([a.position, b.position]).toEqual([0, 1]);
    });

    it('should reject empty titles and unknown stages', () => {
      expect(() => store.createChapter(project.id, { title: '  ' })).toThrow(/title/);
      expect(() => store.createChapter(project.id, { title: 'X', stage: 'nope' })).toThrow(
        /unknown stage/
      );
    });

    it('should update editable fields only', () => {
      const chapter = store.createChapter(project.id, { title: 'Ch 1' });
      const updated = store.updateChapter(chapter.id, {
        title: 'Chapter One',
        notes: 'needs a better opening',
        stage: 'done' // not an updateChapter field; must be ignored
      });
      expect(updated.title).toBe('Chapter One');
      expect(updated.notes).toBe('needs a better opening');
      expect(updated.stage).toBe('drafting');
    });

    it('should delete chapters', () => {
      const chapter = store.createChapter(project.id, { title: 'Ch 1' });
      expect(store.deleteChapter(chapter.id)).toBe(true);
      expect(store.getChapter(chapter.id)).toBeUndefined();
      expect(store.deleteChapter(chapter.id)).toBe(false);
    });

    it('should track linked files', () => {
      store.createChapter(project.id, { title: 'Ch 1', file: 'content/01.md' });
      store.createChapter(project.id, { title: 'Idea' });
      expect(store.linkedFiles(project.id)).toEqual(new Set(['content/01.md']));
    });
  });

  describe('moveChapter', () => {
    it('should move a chapter between stages and reindex positions', () => {
      const a = store.createChapter(project.id, { title: 'A' });
      store.createChapter(project.id, { title: 'B' });
      store.createChapter(project.id, { title: 'C', stage: 'revision' });

      store.moveChapter(a.id, 'revision', 0);

      const chapters = store.listChapters(project.id);
      const revision = chapters.filter(x => x.stage === 'revision').map(x => x.title);
      const drafting = chapters.filter(x => x.stage === 'drafting');
      expect(revision).toEqual(['A', 'C']);
      expect(drafting.map(x => x.title)).toEqual(['B']);
      expect(drafting[0].position).toBe(0);
    });

    it('should clamp the target index', () => {
      const a = store.createChapter(project.id, { title: 'A' });
      const moved = store.moveChapter(a.id, 'done', 99);
      expect(moved.stage).toBe('done');
      expect(moved.position).toBe(0);
    });

    it('should reorder within a stage', () => {
      const a = store.createChapter(project.id, { title: 'A' });
      store.createChapter(project.id, { title: 'B' });
      store.moveChapter(a.id, 'drafting', 1);
      const titles = store
        .listChapters(project.id)
        .filter(x => x.stage === 'drafting')
        .map(x => x.title);
      expect(titles).toEqual(['B', 'A']);
    });
  });

  describe('editions', () => {
    it('should create editions with unique names and ordered membership', () => {
      const a = store.createChapter(project.id, { title: 'A', file: 'content/a.md' });
      const b = store.createChapter(project.id, { title: 'B', file: 'content/b.md' });
      const c = store.createChapter(project.id, { title: 'C' });

      const edition = store.createEdition(project.id, { name: "Reader's" });
      expect(() => store.createEdition(project.id, { name: "Reader's" })).toThrow(/exists/);

      store.setEditionChapters(edition.id, [b.id, a.id, c.id]);
      const chapters = store.listEditionChapters(edition.id);
      expect(chapters.map(x => x.title)).toEqual(['B', 'A', 'C']);

      // Reorder + drop one
      store.setEditionChapters(edition.id, [a.id, b.id]);
      expect(store.listEditionChapters(edition.id).map(x => x.title)).toEqual(['A', 'B']);

      const listed = store.listEditions(project.id);
      expect(listed[0].chapterCount).toBe(2);
    });

    it('should reject chapters from other projects', () => {
      const other = store.getOrCreateProject('/home/me/other');
      const foreign = store.createChapter(other.id, { title: 'X' });
      const edition = store.createEdition(project.id, { name: 'E' });
      expect(() => store.setEditionChapters(edition.id, [foreign.id])).toThrow(/not in this/);
    });

    it('should cascade membership on edition delete and chapter delete', () => {
      const a = store.createChapter(project.id, { title: 'A' });
      const edition = store.createEdition(project.id, { name: 'E' });
      store.setEditionChapters(edition.id, [a.id]);

      store.deleteChapter(a.id);
      expect(store.listEditionChapters(edition.id)).toEqual([]);

      expect(store.deleteEdition(edition.id)).toBe(true);
      expect(store.findEdition(project.id, 'E')).toBeUndefined();
    });
  });

  describe('collections', () => {
    it('should aggregate projects with ordered membership', () => {
      const s1 = store.getOrCreateProject('/home/me/story-one');
      const s2 = store.getOrCreateProject('/home/me/story-two');
      const col = store.createCollection({ name: 'Short Stories Vol. 1' });
      expect(() => store.createCollection({ name: 'Short Stories Vol. 1' })).toThrow(/exists/);

      store.setCollectionProjects(col.id, [s2.id, s1.id]);
      expect(store.listCollectionProjects(col.id).map(x => x.name)).toEqual([
        'story-two',
        'story-one'
      ]);
      expect(store.listCollections()[0].projectCount).toBe(2);
    });

    it('should scope collection editions to member projects', () => {
      const s1 = store.getOrCreateProject('/home/me/story-one');
      const outsider = store.getOrCreateProject('/home/me/not-a-member');
      const col = store.createCollection({ name: 'Vol. 1' });
      store.setCollectionProjects(col.id, [s1.id]);

      const ed = store.createCollectionEdition(col.id, { name: 'Sampler' });
      store.setCollectionEditionProjects(ed.id, [s1.id]);
      expect(store.listCollectionEditionProjects(ed.id).map(x => x.name)).toEqual(['story-one']);
      expect(() => store.setCollectionEditionProjects(ed.id, [outsider.id])).toThrow(
        /not in this collection/
      );
    });

    it('should cascade editions and membership on collection delete', () => {
      const s1 = store.getOrCreateProject('/home/me/story-one');
      const col = store.createCollection({ name: 'Vol. 1' });
      store.setCollectionProjects(col.id, [s1.id]);
      const ed = store.createCollectionEdition(col.id, { name: 'Sampler' });

      expect(store.deleteCollection(col.id)).toBe(true);
      expect(store.getCollectionEdition(ed.id)).toBeUndefined();
    });
  });

  describe('legacy migration', () => {
    it('should rename cards to chapters in a pre-rename database', () => {
      store.close();
      rmSync(join(tempDir, 'draftsync.db'), { force: true });
      rmSync(join(tempDir, 'draftsync.db-wal'), { force: true });

      // Build a legacy-schema database by hand
      const legacy = new Database(join(tempDir, 'draftsync.db'));
      legacy.exec(`
        CREATE TABLE projects (id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), label TEXT);
        CREATE TABLE cards (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL,
          title TEXT NOT NULL, stage TEXT NOT NULL DEFAULT 'drafting', notes TEXT NOT NULL DEFAULT '',
          file TEXT, position INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE INDEX idx_cards_project ON cards(project_id, stage, position);
        CREATE TABLE tasks (id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL,
          card_id INTEGER, text TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT (datetime('now')), done_at TEXT);
        INSERT INTO projects (path, name) VALUES ('/old/proj', 'proj');
        INSERT INTO cards (project_id, title, stage) VALUES (1, 'Legacy Chapter', 'beta');
        INSERT INTO tasks (project_id, card_id, text) VALUES (1, 1, 'legacy task');
      `);
      legacy.close();

      store = openStore(tempDir);
      const chapters = store.listChapters(1);
      expect(chapters.map(c => c.title)).toEqual(['Legacy Chapter']);
      const tasks = store.listTasks(1);
      expect(tasks[0].chapter_id).toBe(1);
      // And the new tables exist alongside
      store.createEdition(1, { name: 'E' });
    });
  });

  it('should expose five stages in board order', () => {
    expect(STAGES.map(s => s.key)).toEqual(['outline', 'drafting', 'revision', 'beta', 'done']);
  });
});
