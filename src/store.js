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
  db.pragma('foreign_keys = ON');
  // Migrate pre-rename databases ("cards" -> "chapters") before the
  // schema exec, so CREATE IF NOT EXISTS doesn't create an empty
  // chapters table alongside the legacy one
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map(t => t.name);
  if (tables.includes('cards') && !tables.includes('chapters')) {
    db.exec(`
      ALTER TABLE cards RENAME TO chapters;
      DROP INDEX IF EXISTS idx_cards_project;
    `);
    for (const table of ['tasks', 'ai_events', 'edition_chapters']) {
      if (!tables.includes(table)) continue;
      const cols = db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map(c => c.name);
      if (cols.includes('card_id')) {
        db.exec(`ALTER TABLE ${table} RENAME COLUMN card_id TO chapter_id`);
      }
    }
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chapters (
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
    CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, stage, position);
    CREATE TABLE IF NOT EXISTS ai_events (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      file TEXT,
      provider TEXT NOT NULL,
      source TEXT NOT NULL,
      session_key TEXT NOT NULL,
      url TEXT,
      model TEXT,
      purpose TEXT NOT NULL DEFAULT 'other',
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      justification TEXT NOT NULL DEFAULT '',
      occurred_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, session_key)
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      text TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      done_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id, done);
    CREATE TABLE IF NOT EXISTS editions (
      id INTEGER PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(project_id, name)
    );
    CREATE TABLE IF NOT EXISTS edition_chapters (
      edition_id INTEGER NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
      chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (edition_id, chapter_id)
    );
    CREATE TABLE IF NOT EXISTS collections (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS collection_projects (
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (collection_id, project_id)
    );
    CREATE TABLE IF NOT EXISTS collection_editions (
      id INTEGER PRIMARY KEY,
      collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(collection_id, name)
    );
    CREATE TABLE IF NOT EXISTS collection_edition_projects (
      edition_id INTEGER NOT NULL REFERENCES collection_editions(id) ON DELETE CASCADE,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (edition_id, project_id)
    );
  `);
  // Migrations for columns added after the initial schema
  const projectCols = db
    .prepare('PRAGMA table_info(projects)')
    .all()
    .map(c => c.name);
  if (!projectCols.includes('label')) {
    db.exec('ALTER TABLE projects ADD COLUMN label TEXT');
  }
  return new Store(db);
}

/**
 * SQLite-backed store for projects and kanban chapters
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
   * Get one project by ID
   *
   * @param {number} id - Project ID
   * @returns {Object|undefined} Project row
   */
  getProject(id) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  }

  /**
   * List all projects with chapter counts, labeled first then by name
   *
   * @returns {Array<Object>} Project rows with chapterCount
   */
  listProjects() {
    return this.db
      .prepare(
        `SELECT p.*, COUNT(c.id) AS chapterCount
         FROM projects p LEFT JOIN chapters c ON c.project_id = p.id
         GROUP BY p.id
         ORDER BY p.label IS NULL, p.label, p.name`
      )
      .all();
  }

  /**
   * Update a project's editable fields (name, label)
   *
   * @param {number} id - Project ID
   * @param {Object} fields - Any of name, label (null clears the label)
   * @returns {Object|undefined} Updated project
   */
  updateProject(id, fields) {
    const allowed = ['name', 'label'];
    const updates = allowed.filter(k => fields[k] !== undefined);
    if (updates.length > 0) {
      const set = updates.map(k => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE projects SET ${set} WHERE id = ?`)
        .run(...updates.map(k => fields[k]), id);
    }
    return this.getProject(id);
  }

  /**
   * List a project's chapters in board order
   *
   * @param {number} projectId - Project ID
   * @returns {Array<Object>} Card rows
   */
  listChapters(projectId) {
    return this.db
      .prepare('SELECT * FROM chapters WHERE project_id = ? ORDER BY stage, position')
      .all(projectId);
  }

  /**
   * Create a chapter at the end of a stage
   *
   * @param {number} projectId - Project ID
   * @param {Object} fields - Card fields
   * @param {string} fields.title - Card title
   * @param {string} [fields.stage='drafting'] - Stage key
   * @param {string} [fields.notes=''] - Notes
   * @param {string} [fields.file] - Linked content file path
   * @returns {Object} The created chapter
   */
  createChapter(projectId, { title, stage = 'drafting', notes = '', file = null }) {
    if (!title || !title.trim()) throw new Error('title is required');
    if (!STAGE_KEYS.has(stage)) throw new Error(`unknown stage: ${stage}`);
    const { maxPos } = this.db
      .prepare(
        'SELECT COALESCE(MAX(position), -1) AS maxPos FROM chapters WHERE project_id = ? AND stage = ?'
      )
      .get(projectId, stage);
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO chapters (project_id, title, stage, notes, file, position) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(projectId, title.trim(), stage, notes, file, maxPos + 1);
    return this.getChapter(lastInsertRowid);
  }

  /**
   * Get one chapter by ID
   *
   * @param {number} id - Card ID
   * @returns {Object|undefined} Card row
   */
  getChapter(id) {
    return this.db.prepare('SELECT * FROM chapters WHERE id = ?').get(id);
  }

  /**
   * Update a chapter's editable fields
   *
   * @param {number} id - Card ID
   * @param {Object} fields - Any of title, notes, file
   * @returns {Object|undefined} Updated chapter
   */
  updateChapter(id, fields) {
    const allowed = ['title', 'notes', 'file'];
    const updates = allowed.filter(k => fields[k] !== undefined);
    if (updates.length > 0) {
      const set = updates.map(k => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE chapters SET ${set}, updated_at = datetime('now') WHERE id = ?`)
        .run(...updates.map(k => fields[k]), id);
    }
    return this.getChapter(id);
  }

  /**
   * Move a chapter to a stage and index, reindexing the affected stage
   *
   * @param {number} id - Card ID
   * @param {string} stage - Target stage key
   * @param {number} index - Target index within the stage (clamped)
   * @returns {Object|undefined} Updated chapter
   */
  moveChapter(id, stage, index) {
    if (!STAGE_KEYS.has(stage)) throw new Error(`unknown stage: ${stage}`);
    const chapter = this.getChapter(id);
    if (!chapter) return undefined;

    const move = this.db.transaction(() => {
      const siblings = this.db
        .prepare(
          'SELECT id FROM chapters WHERE project_id = ? AND stage = ? AND id != ? ORDER BY position'
        )
        .all(chapter.project_id, stage, id)
        .map(r => r.id);
      const at = Math.max(0, Math.min(index ?? siblings.length, siblings.length));
      siblings.splice(at, 0, id);

      const setPos = this.db.prepare(
        `UPDATE chapters SET stage = ?, position = ?, updated_at = datetime('now') WHERE id = ?`
      );
      siblings.forEach((chapterId, pos) => setPos.run(stage, pos, chapterId));

      // Close the gap left in the stage the chapter came from
      if (chapter.stage !== stage) {
        this.db
          .prepare('SELECT id FROM chapters WHERE project_id = ? AND stage = ? ORDER BY position')
          .all(chapter.project_id, chapter.stage)
          .forEach((row, pos) => setPos.run(chapter.stage, pos, row.id));
      }
    });
    move();
    return this.getChapter(id);
  }

  /**
   * Delete a chapter
   *
   * @param {number} id - Card ID
   * @returns {boolean} True if a chapter was deleted
   */
  deleteChapter(id) {
    return this.db.prepare('DELETE FROM chapters WHERE id = ?').run(id).changes > 0;
  }

  /**
   * File paths already linked to chapters in a project
   *
   * @param {number} projectId - Project ID
   * @returns {Set<string>} Linked file paths
   */
  linkedFiles(projectId) {
    return new Set(
      this.db
        .prepare('SELECT file FROM chapters WHERE project_id = ? AND file IS NOT NULL')
        .all(projectId)
        .map(r => r.file)
    );
  }

  /**
   * List a project's AI events, newest first
   *
   * @param {number} projectId - Project ID
   * @returns {Array<Object>} AI event rows
   */
  listAiEvents(projectId) {
    return this.db
      .prepare('SELECT * FROM ai_events WHERE project_id = ? ORDER BY occurred_at DESC, id DESC')
      .all(projectId);
  }

  /**
   * Insert an AI event, or update the existing one with the same
   * session_key (used by transcript ingestion to stay idempotent)
   *
   * @param {number} projectId - Project ID
   * @param {Object} fields - Event fields (see schema)
   * @returns {{event: Object, created: boolean}} The event row and whether
   *   it was newly created
   */
  upsertAiEvent(projectId, fields) {
    const {
      sessionKey,
      provider,
      source,
      chapterId = null,
      file = null,
      url = null,
      model = null,
      purpose = 'other',
      tokensIn = 0,
      tokensOut = 0,
      justification = '',
      occurredAt = null
    } = fields;
    if (!sessionKey) throw new Error('sessionKey is required');
    if (!provider) throw new Error('provider is required');
    if (!source) throw new Error('source is required');

    const existing = this.db
      .prepare('SELECT * FROM ai_events WHERE project_id = ? AND session_key = ?')
      .get(projectId, sessionKey);

    if (existing) {
      // Refresh volatile fields; keep user-entered ones (purpose,
      // justification, chapter link) as they are
      this.db
        .prepare(
          'UPDATE ai_events SET model = ?, tokens_in = ?, tokens_out = ?, occurred_at = ? WHERE id = ?'
        )
        .run(
          model ?? existing.model,
          tokensIn,
          tokensOut,
          occurredAt ?? existing.occurred_at,
          existing.id
        );
      return {
        event: this.db.prepare('SELECT * FROM ai_events WHERE id = ?').get(existing.id),
        created: false
      };
    }

    const { lastInsertRowid } = this.db
      .prepare(
        `INSERT INTO ai_events
           (project_id, chapter_id, file, provider, source, session_key, url, model,
            purpose, tokens_in, tokens_out, justification, occurred_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        projectId,
        chapterId,
        file,
        provider,
        source,
        sessionKey,
        url,
        model,
        purpose,
        tokensIn,
        tokensOut,
        justification,
        occurredAt
      );
    return {
      event: this.db.prepare('SELECT * FROM ai_events WHERE id = ?').get(lastInsertRowid),
      created: true
    };
  }

  /**
   * Get one AI event by ID
   *
   * @param {number} id - Event ID
   * @returns {Object|undefined} Event row
   */
  getAiEvent(id) {
    return this.db.prepare('SELECT * FROM ai_events WHERE id = ?').get(id);
  }

  /**
   * Delete an AI event
   *
   * @param {number} id - Event ID
   * @returns {boolean} True if an event was deleted
   */
  deleteAiEvent(id) {
    return this.db.prepare('DELETE FROM ai_events WHERE id = ?').run(id).changes > 0;
  }

  /**
   * List a project's tasks (open first, newest first within each group)
   *
   * @param {number} projectId - Project ID
   * @returns {Array<Object>} Task rows
   */
  listTasks(projectId) {
    return this.db
      .prepare('SELECT * FROM tasks WHERE project_id = ? ORDER BY done, id DESC')
      .all(projectId);
  }

  /**
   * List open tasks across all projects, with project and chapter names
   *
   * @returns {Array<Object>} Task rows joined with projectName/chapterTitle
   */
  listAllOpenTasks() {
    return this.db
      .prepare(
        `SELECT t.*, p.name AS projectName, p.id AS projectId, c.title AS chapterTitle
         FROM tasks t
         JOIN projects p ON p.id = t.project_id
         LEFT JOIN chapters c ON c.id = t.chapter_id
         WHERE t.done = 0
         ORDER BY t.id DESC`
      )
      .all();
  }

  /**
   * Create a task, optionally attached to a chapter
   *
   * @param {number} projectId - Project ID
   * @param {Object} fields - {text, chapterId}
   * @returns {Object} The created task
   */
  createTask(projectId, { text, chapterId = null }) {
    if (!text || !text.trim()) throw new Error('text is required');
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO tasks (project_id, chapter_id, text) VALUES (?, ?, ?)')
      .run(projectId, chapterId, text.trim());
    return this.getTask(lastInsertRowid);
  }

  /**
   * Get one task by ID
   *
   * @param {number} id - Task ID
   * @returns {Object|undefined} Task row
   */
  getTask(id) {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  }

  /**
   * Update a task (text and/or done state)
   *
   * @param {number} id - Task ID
   * @param {Object} fields - Any of text, done (boolean)
   * @returns {Object|undefined} Updated task
   */
  updateTask(id, fields) {
    if (fields.text !== undefined) {
      this.db.prepare('UPDATE tasks SET text = ? WHERE id = ?').run(fields.text, id);
    }
    if (fields.done !== undefined) {
      this.db
        .prepare(
          "UPDATE tasks SET done = ?, done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?"
        )
        .run(fields.done ? 1 : 0, fields.done ? 1 : 0, id);
    }
    return this.getTask(id);
  }

  /**
   * Delete a task
   *
   * @param {number} id - Task ID
   * @returns {boolean} True if a task was deleted
   */
  deleteTask(id) {
    return this.db.prepare('DELETE FROM tasks WHERE id = ?').run(id).changes > 0;
  }

  /**
   * List a project's editions with chapter counts
   *
   * @param {number} projectId - Project ID
   * @returns {Array<Object>} Edition rows with chapterCount
   */
  listEditions(projectId) {
    return this.db
      .prepare(
        `SELECT e.*, COUNT(ec.chapter_id) AS chapterCount
         FROM editions e LEFT JOIN edition_chapters ec ON ec.edition_id = e.id
         WHERE e.project_id = ?
         GROUP BY e.id ORDER BY e.name`
      )
      .all(projectId);
  }

  /**
   * Get one edition by ID
   *
   * @param {number} id - Edition ID
   * @returns {Object|undefined} Edition row
   */
  getEdition(id) {
    return this.db.prepare('SELECT * FROM editions WHERE id = ?').get(id);
  }

  /**
   * Find an edition by name within a project
   *
   * @param {number} projectId - Project ID
   * @param {string} name - Edition name
   * @returns {Object|undefined} Edition row
   */
  findEdition(projectId, name) {
    return this.db
      .prepare('SELECT * FROM editions WHERE project_id = ? AND name = ?')
      .get(projectId, name);
  }

  /**
   * Create an edition
   *
   * @param {number} projectId - Project ID
   * @param {Object} fields - {name, description}
   * @returns {Object} The created edition
   */
  createEdition(projectId, { name, description = '' }) {
    if (!name || !name.trim()) throw new Error('name is required');
    if (this.findEdition(projectId, name.trim())) {
      throw new Error(`edition "${name.trim()}" already exists`);
    }
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO editions (project_id, name, description) VALUES (?, ?, ?)')
      .run(projectId, name.trim(), description);
    return this.getEdition(lastInsertRowid);
  }

  /**
   * Update an edition's name/description
   *
   * @param {number} id - Edition ID
   * @param {Object} fields - Any of name, description
   * @returns {Object|undefined} Updated edition
   */
  updateEdition(id, fields) {
    const allowed = ['name', 'description'];
    const updates = allowed.filter(k => fields[k] !== undefined);
    if (updates.length > 0) {
      const set = updates.map(k => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE editions SET ${set} WHERE id = ?`)
        .run(...updates.map(k => fields[k]), id);
    }
    return this.getEdition(id);
  }

  /**
   * Delete an edition (membership rows cascade)
   *
   * @param {number} id - Edition ID
   * @returns {boolean} True if deleted
   */
  deleteEdition(id) {
    return this.db.prepare('DELETE FROM editions WHERE id = ?').run(id).changes > 0;
  }

  /**
   * The ordered chapters (chapters) of an edition
   *
   * @param {number} editionId - Edition ID
   * @returns {Array<Object>} Card rows in edition order
   */
  listEditionChapters(editionId) {
    return this.db
      .prepare(
        `SELECT c.*, ec.position AS editionPosition
         FROM edition_chapters ec JOIN chapters c ON c.id = ec.chapter_id
         WHERE ec.edition_id = ?
         ORDER BY ec.position`
      )
      .all(editionId);
  }

  /**
   * Replace an edition's ordered chapter membership
   *
   * @param {number} editionId - Edition ID
   * @param {Array<number>} chapterIds - Card IDs in the desired order
   * @returns {Array<Object>} The new ordered chapters
   */
  setEditionChapters(editionId, chapterIds) {
    const edition = this.getEdition(editionId);
    if (!edition) throw new Error('edition not found');
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM edition_chapters WHERE edition_id = ?').run(editionId);
      const insert = this.db.prepare(
        'INSERT INTO edition_chapters (edition_id, chapter_id, position) VALUES (?, ?, ?)'
      );
      chapterIds.forEach((chapterId, position) => {
        const chapter = this.getChapter(chapterId);
        if (!chapter || chapter.project_id !== edition.project_id) {
          throw new Error(`chapter ${chapterId} is not in this project`);
        }
        insert.run(editionId, chapterId, position);
      });
    });
    replace();
    return this.listEditionChapters(editionId);
  }

  /**
   * List all collections with member/edition counts
   *
   * @returns {Array<Object>} Collection rows with projectCount, editionCount
   */
  listCollections() {
    return this.db
      .prepare(
        `SELECT col.*,
           (SELECT COUNT(*) FROM collection_projects cp WHERE cp.collection_id = col.id) AS projectCount,
           (SELECT COUNT(*) FROM collection_editions ce WHERE ce.collection_id = col.id) AS editionCount
         FROM collections col ORDER BY col.name`
      )
      .all();
  }

  /**
   * Get one collection by ID
   *
   * @param {number} id - Collection ID
   * @returns {Object|undefined} Collection row
   */
  getCollection(id) {
    return this.db.prepare('SELECT * FROM collections WHERE id = ?').get(id);
  }

  /**
   * Create a collection
   *
   * @param {Object} fields - {name, description}
   * @returns {Object} The created collection
   */
  createCollection({ name, description = '' }) {
    if (!name || !name.trim()) throw new Error('name is required');
    const existing = this.db.prepare('SELECT id FROM collections WHERE name = ?').get(name.trim());
    if (existing) throw new Error(`collection "${name.trim()}" already exists`);
    const { lastInsertRowid } = this.db
      .prepare('INSERT INTO collections (name, description) VALUES (?, ?)')
      .run(name.trim(), description);
    return this.getCollection(lastInsertRowid);
  }

  /**
   * Update a collection's name/description
   *
   * @param {number} id - Collection ID
   * @param {Object} fields - Any of name, description
   * @returns {Object|undefined} Updated collection
   */
  updateCollection(id, fields) {
    const allowed = ['name', 'description'];
    const updates = allowed.filter(k => fields[k] !== undefined);
    if (updates.length > 0) {
      const set = updates.map(k => `${k} = ?`).join(', ');
      this.db
        .prepare(`UPDATE collections SET ${set} WHERE id = ?`)
        .run(...updates.map(k => fields[k]), id);
    }
    return this.getCollection(id);
  }

  /**
   * Delete a collection (membership and editions cascade)
   *
   * @param {number} id - Collection ID
   * @returns {boolean} True if deleted
   */
  deleteCollection(id) {
    return this.db.prepare('DELETE FROM collections WHERE id = ?').run(id).changes > 0;
  }

  /**
   * The ordered member projects of a collection
   *
   * @param {number} collectionId - Collection ID
   * @returns {Array<Object>} Project rows in collection order
   */
  listCollectionProjects(collectionId) {
    return this.db
      .prepare(
        `SELECT p.*, cp.position AS collectionPosition
         FROM collection_projects cp JOIN projects p ON p.id = cp.project_id
         WHERE cp.collection_id = ?
         ORDER BY cp.position`
      )
      .all(collectionId);
  }

  /**
   * Replace a collection's ordered project membership
   *
   * @param {number} collectionId - Collection ID
   * @param {Array<number>} projectIds - Project IDs in the desired order
   * @returns {Array<Object>} The new ordered member projects
   */
  setCollectionProjects(collectionId, projectIds) {
    if (!this.getCollection(collectionId)) throw new Error('collection not found');
    const replace = this.db.transaction(() => {
      this.db.prepare('DELETE FROM collection_projects WHERE collection_id = ?').run(collectionId);
      const insert = this.db.prepare(
        'INSERT INTO collection_projects (collection_id, project_id, position) VALUES (?, ?, ?)'
      );
      projectIds.forEach((projectId, position) => {
        if (!this.getProject(projectId)) throw new Error(`unknown project ${projectId}`);
        insert.run(collectionId, projectId, position);
      });
    });
    replace();
    return this.listCollectionProjects(collectionId);
  }

  /**
   * List a collection's editions with story counts
   *
   * @param {number} collectionId - Collection ID
   * @returns {Array<Object>} Edition rows with projectCount
   */
  listCollectionEditions(collectionId) {
    return this.db
      .prepare(
        `SELECT ce.*, COUNT(cep.project_id) AS projectCount
         FROM collection_editions ce
         LEFT JOIN collection_edition_projects cep ON cep.edition_id = ce.id
         WHERE ce.collection_id = ?
         GROUP BY ce.id ORDER BY ce.name`
      )
      .all(collectionId);
  }

  /**
   * Get one collection edition by ID
   *
   * @param {number} id - Collection edition ID
   * @returns {Object|undefined} Edition row
   */
  getCollectionEdition(id) {
    return this.db.prepare('SELECT * FROM collection_editions WHERE id = ?').get(id);
  }

  /**
   * Create a collection edition
   *
   * @param {number} collectionId - Collection ID
   * @param {Object} fields - {name, description}
   * @returns {Object} The created edition
   */
  createCollectionEdition(collectionId, { name, description = '' }) {
    if (!name || !name.trim()) throw new Error('name is required');
    const existing = this.db
      .prepare('SELECT id FROM collection_editions WHERE collection_id = ? AND name = ?')
      .get(collectionId, name.trim());
    if (existing) throw new Error(`edition "${name.trim()}" already exists`);
    const { lastInsertRowid } = this.db
      .prepare(
        'INSERT INTO collection_editions (collection_id, name, description) VALUES (?, ?, ?)'
      )
      .run(collectionId, name.trim(), description);
    return this.getCollectionEdition(lastInsertRowid);
  }

  /**
   * Delete a collection edition
   *
   * @param {number} id - Collection edition ID
   * @returns {boolean} True if deleted
   */
  deleteCollectionEdition(id) {
    return this.db.prepare('DELETE FROM collection_editions WHERE id = ?').run(id).changes > 0;
  }

  /**
   * The ordered stories (projects) of a collection edition
   *
   * @param {number} editionId - Collection edition ID
   * @returns {Array<Object>} Project rows in edition order
   */
  listCollectionEditionProjects(editionId) {
    return this.db
      .prepare(
        `SELECT p.*, cep.position AS editionPosition
         FROM collection_edition_projects cep JOIN projects p ON p.id = cep.project_id
         WHERE cep.edition_id = ?
         ORDER BY cep.position`
      )
      .all(editionId);
  }

  /**
   * Replace a collection edition's ordered story membership
   *
   * Only projects that are members of the parent collection are allowed.
   *
   * @param {number} editionId - Collection edition ID
   * @param {Array<number>} projectIds - Project IDs in the desired order
   * @returns {Array<Object>} The new ordered stories
   */
  setCollectionEditionProjects(editionId, projectIds) {
    const edition = this.getCollectionEdition(editionId);
    if (!edition) throw new Error('edition not found');
    const members = new Set(this.listCollectionProjects(edition.collection_id).map(prj => prj.id));
    const replace = this.db.transaction(() => {
      this.db
        .prepare('DELETE FROM collection_edition_projects WHERE edition_id = ?')
        .run(editionId);
      const insert = this.db.prepare(
        'INSERT INTO collection_edition_projects (edition_id, project_id, position) VALUES (?, ?, ?)'
      );
      projectIds.forEach((projectId, position) => {
        if (!members.has(projectId)) {
          throw new Error(`project ${projectId} is not in this collection`);
        }
        insert.run(editionId, projectId, position);
      });
    });
    replace();
    return this.listCollectionEditionProjects(editionId);
  }

  /** Close the database */
  close() {
    this.db.close();
  }
}
