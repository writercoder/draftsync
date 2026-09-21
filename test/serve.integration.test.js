/**
 * Integration tests for the global draftsync server
 *
 * Runs the real server on an ephemeral port against a temp-dir store
 * and project, exercising the home/board APIs with fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStore } from '../src/store.js';
import { createDraftsyncServer, looksLikeProject } from '../src/serve.js';

describe('Serve Integration Tests', () => {
  let tempDir;
  let projectDir;
  let store;
  let project;
  let server;
  let base;
  let p; // project-scoped API prefix

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-serve-'));
    projectDir = join(tempDir, 'my-novel');
    mkdirSync(join(projectDir, 'content', 'drafts'), { recursive: true });
    writeFileSync(join(projectDir, 'content', '01-opening.md'), '# The Opening\n\nText.\n');
    writeFileSync(join(projectDir, 'content', '02-middle.md'), 'No heading here.\n');
    writeFileSync(join(projectDir, 'content', 'drafts', 'scrap.md'), '# Scrap\n');
    writeFileSync(
      join(projectDir, '.draftsync.json'),
      JSON.stringify({
        version: '1.0',
        files: { 'content/01-opening.md': { gdocId: 'gdoc-123' } },
        config: { driveFolderId: 'folder-77' }
      })
    );

    store = openStore(join(tempDir, 'data'));
    project = store.getOrCreateProject(projectDir);
    server = createDraftsyncServer({ store });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    p = `/api/p/${project.id}`;
  });

  afterEach(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const api = async (path, method = 'GET', body) => {
    const res = await fetch(base + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  describe('pages and registry', () => {
    it('should serve the home page at / and the board at /p/:id', async () => {
      const home = await fetch(base + '/');
      expect(home.status).toBe(200);
      expect(await home.text()).toContain('all projects');

      const board = await fetch(`${base}/p/${project.id}`);
      expect(board.status).toBe(200);
      expect(await board.text()).toContain('draftsync board');
    });

    it('should list, register, and label projects', async () => {
      const list = await api('/api/projects');
      expect(list.body.projects.map(x => x.name)).toContain('my-novel');

      const otherDir = join(tempDir, 'short-story');
      mkdirSync(otherDir);
      const created = await api('/api/projects', 'POST', { path: otherDir });
      expect(created.status).toBe(201);

      const labeled = await api(`/api/projects/${created.body.id}`, 'PATCH', {
        label: 'Short stories'
      });
      expect(labeled.body.label).toBe('Short stories');

      const bad = await api('/api/projects', 'POST', { path: join(tempDir, 'nope') });
      expect(bad.status).toBe(400);
    });

    it('should detect project directories', async () => {
      expect(await looksLikeProject(projectDir)).toBe(true);
      expect(await looksLikeProject(tempDir)).toBe(false);
    });
  });

  describe('board and cards', () => {
    it('should return the board with stages, links, and counts', async () => {
      const { status, body } = await api(`${p}/board`);
      expect(status).toBe(200);
      expect(body.project.name).toBe('my-novel');
      expect(body.stages).toHaveLength(5);
      expect(body.project.driveFolderUrl).toBe('https://drive.google.com/drive/folders/folder-77');
    });

    it('should create, move, and delete a card', async () => {
      const created = await api(`${p}/cards`, 'POST', { title: 'Chapter 1', stage: 'outline' });
      expect(created.status).toBe(201);

      const moved = await api(`${p}/cards/${created.body.id}`, 'PATCH', {
        stage: 'revision',
        index: 0
      });
      expect(moved.body.stage).toBe('revision');

      const deleted = await api(`${p}/cards/${created.body.id}`, 'DELETE');
      expect(deleted.body.deleted).toBe(true);
    });

    it('should import chapters idempotently with Doc links', async () => {
      const first = await api(`${p}/import`, 'POST');
      expect(first.body.imported).toBe(2);
      const again = await api(`${p}/import`, 'POST');
      expect(again.body.imported).toBe(0);

      const board = await api(`${p}/board`);
      const opening = board.body.cards.find(c => c.file === 'content/01-opening.md');
      expect(opening.gdocUrl).toBe('https://docs.google.com/document/d/gdoc-123/edit');
    });

    it('should 404 for unknown projects and cards', async () => {
      expect((await api('/api/p/999/board')).status).toBe(404);
      expect((await api(`${p}/cards/999`, 'PATCH', { notes: 'x' })).status).toBe(404);
    });
  });

  describe('tasks', () => {
    it('should manage tasks per card and show open counts on the board', async () => {
      const card = await api(`${p}/cards`, 'POST', { title: 'Chapter 1' });
      const task = await api(`${p}/tasks`, 'POST', {
        text: 'Fix pacing per editor notes',
        card_id: card.body.id
      });
      expect(task.status).toBe(201);
      await api(`${p}/tasks`, 'POST', { text: 'Project-wide: choose an epigraph' });

      const board = await api(`${p}/board`);
      expect(board.body.tasks.openByCard[card.body.id]).toBe(1);

      const done = await api(`${p}/tasks/${task.body.id}`, 'PATCH', { done: true });
      expect(done.body.done).toBe(1);
      expect(done.body.done_at).toBeTruthy();

      const list = await api(`${p}/tasks`);
      expect(list.body.tasks).toHaveLength(2);

      const removed = await api(`${p}/tasks/${task.body.id}`, 'DELETE');
      expect(removed.body.deleted).toBe(true);
    });

    it('should aggregate open tasks globally with project and card names', async () => {
      const card = await api(`${p}/cards`, 'POST', { title: 'Chapter 1' });
      await api(`${p}/tasks`, 'POST', { text: 'Open one', card_id: card.body.id });
      const closed = await api(`${p}/tasks`, 'POST', { text: 'Done one' });
      await api(`${p}/tasks/${closed.body.id}`, 'PATCH', { done: true });

      const global = await api('/api/tasks');
      expect(global.body.tasks).toHaveLength(1);
      expect(global.body.tasks[0]).toMatchObject({
        text: 'Open one',
        projectName: 'my-novel',
        cardTitle: 'Chapter 1'
      });
    });

    it('should reject empty tasks and unknown cards', async () => {
      expect((await api(`${p}/tasks`, 'POST', { text: '  ' })).status).toBe(400);
      expect((await api(`${p}/tasks`, 'POST', { text: 'x', card_id: 999 })).status).toBe(400);
    });
  });

  describe('editions', () => {
    it('should manage editions and build an edition-scoped export', async () => {
      await api(`${p}/import`, 'POST');
      const board = await api(`${p}/board`);
      const opening = board.body.cards.find(c => c.file === 'content/01-opening.md');
      const middle = board.body.cards.find(c => c.file === 'content/02-middle.md');
      const placeholder = await api(`${p}/cards`, 'POST', { title: 'Planned chapter' });

      const edition = await api(`${p}/editions`, 'POST', {
        name: "Reader's Edition",
        description: 'Just the opening'
      });
      expect(edition.status).toBe(201);

      const set = await api(`${p}/editions/${edition.body.id}/chapters`, 'PUT', {
        card_ids: [middle.id, opening.id, placeholder.body.id]
      });
      expect(set.body.chapters.map(c => c.title)).toEqual([
        '02-middle',
        'The Opening',
        'Planned chapter'
      ]);

      // Edition export uses edition order; the placeholder (no file) is skipped
      const res = await fetch(`${base}${p}/export/docx?edition=${edition.body.id}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain("my-novel - Reader's Edition");

      const renamed = await api(`${p}/editions/${edition.body.id}`, 'PATCH', { name: 'RE' });
      expect(renamed.body.name).toBe('RE');

      const removed = await api(`${p}/editions/${edition.body.id}`, 'DELETE');
      expect(removed.body.deleted).toBe(true);
      expect((await api(`${p}/export/docx?edition=${edition.body.id}`)).status).toBe(404);
    });

    it('should reject invalid membership payloads and empty-file editions', async () => {
      const edition = await api(`${p}/editions`, 'POST', { name: 'Empty' });
      expect(
        (await api(`${p}/editions/${edition.body.id}/chapters`, 'PUT', { card_ids: 'nope' })).status
      ).toBe(400);
      expect((await api(`${p}/export/epub?edition=${edition.body.id}`)).status).toBe(500);
      expect((await api(`${p}/editions`, 'POST', { name: 'Empty' })).status).toBe(400);
    });
  });

  describe('metadata', () => {
    it('should round-trip metadata.yaml through the API', async () => {
      const before = await api(`${p}/metadata`);
      expect(before.body).toEqual({ content: '', exists: false });

      const saved = await api(`${p}/metadata`, 'PUT', { content: 'title: "My Novel"\n' });
      expect(saved.body.saved).toBe(true);
      expect(await readFile(join(projectDir, 'templates', 'metadata.yaml'), 'utf8')).toBe(
        'title: "My Novel"\n'
      );

      const after = await api(`${p}/metadata`);
      expect(after.body).toEqual({ content: 'title: "My Novel"\n', exists: true });

      expect((await api(`${p}/metadata`, 'PUT', { content: 42 })).status).toBe(400);
    });
  });

  describe('exports', () => {
    it('should build and download DOCX and EPUB exports', async () => {
      for (const [fmt, mime] of [
        ['docx', 'wordprocessingml'],
        ['epub', 'application/epub+zip']
      ]) {
        const res = await fetch(`${base}${p}/export/${fmt}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain(mime);
        const bytes = new Uint8Array(await res.arrayBuffer());
        expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
      }
    });

    it('should reject unknown export formats', async () => {
      expect((await api(`${p}/export/mobi`)).status).toBe(404);
    });
  });

  describe('AI events', () => {
    it('should manage AI events with provider auto-detection', async () => {
      const card = await api(`${p}/cards`, 'POST', { title: 'Chapter 1' });
      const created = await api(`${p}/ai-events`, 'POST', {
        url: 'https://claude.ai/chat/abc',
        purpose: 'critique',
        card_id: card.body.id,
        justification: 'asked for pacing feedback'
      });
      expect(created.status).toBe(201);
      expect(created.body.provider).toBe('anthropic');

      const board = await api(`${p}/board`);
      expect(board.body.ai.byCard[card.body.id]).toBe(1);

      const removed = await api(`${p}/ai-events/${created.body.id}`, 'DELETE');
      expect(removed.body.deleted).toBe(true);
    });

    it('should enforce the AI policy', async () => {
      const noJustification = await api(`${p}/ai-events`, 'POST', {
        provider: 'openai',
        purpose: 'prose-suggestion'
      });
      expect(noJustification.status).toBe(400);
      expect(noJustification.body.error).toMatch(/justification/);
    });
  });
});
