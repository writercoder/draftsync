/**
 * Unit tests for the SQLite store behind draftsync serve
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
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

  describe('cards', () => {
    it('should create cards at the end of a stage', () => {
      const a = store.createCard(project.id, { title: 'Chapter 1' });
      const b = store.createCard(project.id, { title: 'Chapter 2' });
      expect(a.stage).toBe('drafting');
      expect([a.position, b.position]).toEqual([0, 1]);
    });

    it('should reject empty titles and unknown stages', () => {
      expect(() => store.createCard(project.id, { title: '  ' })).toThrow(/title/);
      expect(() => store.createCard(project.id, { title: 'X', stage: 'nope' })).toThrow(
        /unknown stage/
      );
    });

    it('should update editable fields only', () => {
      const card = store.createCard(project.id, { title: 'Ch 1' });
      const updated = store.updateCard(card.id, {
        title: 'Chapter One',
        notes: 'needs a better opening',
        stage: 'done' // not an updateCard field; must be ignored
      });
      expect(updated.title).toBe('Chapter One');
      expect(updated.notes).toBe('needs a better opening');
      expect(updated.stage).toBe('drafting');
    });

    it('should delete cards', () => {
      const card = store.createCard(project.id, { title: 'Ch 1' });
      expect(store.deleteCard(card.id)).toBe(true);
      expect(store.getCard(card.id)).toBeUndefined();
      expect(store.deleteCard(card.id)).toBe(false);
    });

    it('should track linked files', () => {
      store.createCard(project.id, { title: 'Ch 1', file: 'content/01.md' });
      store.createCard(project.id, { title: 'Idea' });
      expect(store.linkedFiles(project.id)).toEqual(new Set(['content/01.md']));
    });
  });

  describe('moveCard', () => {
    it('should move a card between stages and reindex positions', () => {
      const a = store.createCard(project.id, { title: 'A' });
      store.createCard(project.id, { title: 'B' });
      store.createCard(project.id, { title: 'C', stage: 'revision' });

      store.moveCard(a.id, 'revision', 0);

      const cards = store.listCards(project.id);
      const revision = cards.filter(x => x.stage === 'revision').map(x => x.title);
      const drafting = cards.filter(x => x.stage === 'drafting');
      expect(revision).toEqual(['A', 'C']);
      expect(drafting.map(x => x.title)).toEqual(['B']);
      expect(drafting[0].position).toBe(0);
    });

    it('should clamp the target index', () => {
      const a = store.createCard(project.id, { title: 'A' });
      const moved = store.moveCard(a.id, 'done', 99);
      expect(moved.stage).toBe('done');
      expect(moved.position).toBe(0);
    });

    it('should reorder within a stage', () => {
      const a = store.createCard(project.id, { title: 'A' });
      store.createCard(project.id, { title: 'B' });
      store.moveCard(a.id, 'drafting', 1);
      const titles = store
        .listCards(project.id)
        .filter(x => x.stage === 'drafting')
        .map(x => x.title);
      expect(titles).toEqual(['B', 'A']);
    });
  });

  it('should expose five stages in board order', () => {
    expect(STAGES.map(s => s.key)).toEqual(['outline', 'drafting', 'revision', 'beta', 'done']);
  });
});
