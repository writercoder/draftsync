/**
 * Local Data Store
 *
 * SQLite-backed storage for the draftsync serve kanban board. The
 * database lives in ~/.draftsync/draftsync.db (override the directory
 * with DRAFTSYNC_DATA_DIR, mainly for tests). Projects are keyed by
 * their absolute directory path.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

/** Kanban stages, in board order */
export const STAGES = [
  { key: 'outline', label: 'Outline' },
  { key: 'drafting', label: 'Drafting' },
  { key: 'revision', label: 'Revision' },
  { key: 'beta', label: 'Beta' },
  { key: 'done', label: 'Done' }
];

const STAGE_KEYS = new Set(STAGES.map(s => s.key));

/**
 * Resolve the draftsync data directory
 *
 * @returns {string} Absolute path to the data directory
 */
export function getDataDir() {
  return process.env.DRAFTSYNC_DATA_DIR || path.join(homedir(), '.draftsync');
}

/**
 * Open (and migrate) the local store
 *
 * @param {string} [dataDir] - Directory for the database file
 * @returns {Store} Store instance
 */
export function openStore(dataDir = getDataDir()) {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'draftsync.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'drafting',
      notes TEXT NOT NULL DEFAULT '',
      file TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cards_project ON cards(project_id, stage, position);
  `);
  return new Store(db);
}

/**
 * SQLite-backed store for projects and kanban cards
 */
export class Store {
  /** @param {Database.Database} db - Open better-sqlite3 database */
  constructor(db) {
    this.db = db;
  }

  /**
   * Find or create the project for a directory
   *
   * @param {string} projectPath - Absolute project directory path
   * @param {string} [name] - Display name (defaults to directory basename)
   * @returns {Object} Project row
   */
  getOrCreateProject(projectPath, name = path.basename(projectPath)) {
    const existing = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath);
    if (existing) return existing;
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO projects (path, name) VALUES (?, ?)')
      .run(projectPath, name);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(lastInsertRowid);
  }

  /**
   * List a project's cards in board order
   *
   * @param {number} projectId - Project ID
   * @returns {Array<Object>} Card rows
   */
  listCards(projectId) {
    return this.db
      .prepare('SELECT * FROM cards WHERE project_id = ? ORDER BY stage, position')
      .all(projectId);
  }

  /**
   * Create a card at the end of a stage
   *
   * @param {number} projectId - Project ID
   * @param {Object} fields - Card fields
   * @param {string} fields.title - Card title
   * @param {string} [fields.stage='drafting'] - Stage key
   * @param {string} [fields.notes=''] - Notes
   * @param {string} [fields.file] - Linked content file path
   * @returns {Object} The created card
   */
  createCard(projectId, { title, stage = 'drafting', notes = '', file = null }) {
    if (!title || !title.trim()) throw new Error('title is required');
    if (!STAGE_KEYS.has(stage)) throw new Error(`unknown stage: ${stage}`);
    const { maxPos } = this.db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS maxPos FROM cards WHERE project_id = ? AND stage = ?'
      )
      .get(projectId, stage);
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO cards (project_id, title, stage, notes, file, position) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(projectId, title.trim(), stage, notes, file, maxPos + 1);
    return this.getCard(lastInsertRowid);
  }

  /**
   * Get one card by ID
   *
   * @param {number} id - Card ID
   * @returns {Object|undefined} Card row
   */
  getCard(id) {
    return this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  }

  /**
   * Update a card's editable fields
   *
   * @param {number} id - Card ID
   * @param {Object} fields - Any of title, notes, file
   * @returns {Object|undefined} Updated card
   */
  updateCard(id, fields) {
    const allowed = ['title', 'notes', 'file'];
    const updates = allowed.filter(k => fields[k] !== undefined);
    if (updates.length > 0) {
      const set = updates.map(k => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE cards SET ${set}, updated_at = datetime('now') WHERE id = ?`)
        .run(...updates.map(k => fields[k]), id);
    }
    return this.getCard(id);
  }

  /**
   * Move a card to a stage and index, reindexing the affected stage
   *
   * @param {number} id - Card ID
   * @param {string} stage - Target stage key
   * @param {number} index - Target index within the stage (clamped)
   * @returns {Object|undefined} Updated card
   */
  moveCard(id, stage, index) {
    if (!STAGE_KEYS.has(stage)) throw new Error(`unknown stage: ${stage}`);
    const card = this.getCard(id);
    if (!card) return undefined;

    const move = this.db.transaction(() => {
      const siblings = this.db
        .prepare(
          'SELECT id FROM cards WHERE project_id = ? AND stage = ? AND id != ? ORDER BY position'
        )
        .all(card.project_id, stage, id)
        .map(r => r.id);
      const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
      siblings.splice(at, 0, id);

      const setPos = this.db.prepare(
        `UPDATE cards SET stage = ?, position = ?, updated_at = datetime('now') WHERE id = ?`
      );
      siblings.forEach((cardId, pos) => setPos.run(stage, pos, cardId));

      // Close the gap left in the stage the card came from
      if (card.stage !== stage) {
        this.db
          .prepare('SELECT id FROM cards WHERE project_id = ? AND stage = ? ORDER BY position')
          .all(card.project_id, card.stage)
          .forEach((row, pos) => setPos.run(card.stage, pos, row.id));
      }
    });
    move();
    return this.getCard(id);
  }

  /**
   * Delete a card
   *
   * @param {number} id - Card ID
   * @returns {boolean} True if a card was deleted
   */
  deleteCard(id) {
    return this.db.prepare('DELETE FROM cards WHERE id = ?').run(id).changes > 0;
  }

  /**
   * File paths already linked to cards in a project
   *
   * @param {number} projectId - Project ID
   * @returns {Set<string>} Linked file paths
   */
  linkedFiles(projectId) {
    return new Set(
      this.db
        .prepare('SELECT file FROM cards WHERE project_id = ? AND file IS NOT NULL')
        .all(projectId)
        .map(r => r.file)
    );
  }

  /** Close the database */
  close() {
    this.db.close();
  }
}
