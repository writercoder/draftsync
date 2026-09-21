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
import { Buffer } from 'buffer';
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

  describe('board and chapters', () => {
    it('should return the board with stages, links, and counts', async () => {
      const { status, body } = await api(`${p}/board`);
      expect(status).toBe(200);
      expect(body.project.name).toBe('my-novel');
      expect(body.stages).toHaveLength(5);
      expect(body.project.driveFolderUrl).toBe('https://drive.google.com/drive/folders/folder-77');
    });

    it('should create, move, and delete a chapter', async () => {
      const created = await api(`${p}/chapters`, 'POST', { title: 'Chapter 1', stage: 'outline' });
      expect(created.status).toBe(201);

      const moved = await api(`${p}/chapters/${created.body.id}`, 'PATCH', {
        stage: 'revision',
        index: 0
      });
      expect(moved.body.stage).toBe('revision');

      const deleted = await api(`${p}/chapters/${created.body.id}`, 'DELETE');
      expect(deleted.body.deleted).toBe(true);
    });

    it('should import chapters idempotently with Doc links', async () => {
      const first = await api(`${p}/import`, 'POST');
      expect(first.body.imported).toBe(2);
      const again = await api(`${p}/import`, 'POST');
      expect(again.body.imported).toBe(0);

      const board = await api(`${p}/board`);
      const opening = board.body.chapters.find(c => c.file === 'content/01-opening.md');
      expect(opening.gdocUrl).toBe('https://docs.google.com/document/d/gdoc-123/edit');
    });

    it('should 404 for unknown projects and chapters', async () => {
      expect((await api('/api/p/999/board')).status).toBe(404);
      expect((await api(`${p}/chapters/999`, 'PATCH', { notes: 'x' })).status).toBe(404);
    });
  });

  describe('tasks', () => {
    it('should manage tasks per chapter and show open counts on the board', async () => {
      const chapter = await api(`${p}/chapters`, 'POST', { title: 'Chapter 1' });
      const task = await api(`${p}/tasks`, 'POST', {
        text: 'Fix pacing per editor notes',
        chapter_id: chapter.body.id
      });
      expect(task.status).toBe(201);
      await api(`${p}/tasks`, 'POST', { text: 'Project-wide: choose an epigraph' });

      const board = await api(`${p}/board`);
      expect(board.body.tasks.openByChapter[chapter.body.id]).toBe(1);

      const done = await api(`${p}/tasks/${task.body.id}`, 'PATCH', { done: true });
      expect(done.body.done).toBe(1);
      expect(done.body.done_at).toBeTruthy();

      const list = await api(`${p}/tasks`);
      expect(list.body.tasks).toHaveLength(2);

      const removed = await api(`${p}/tasks/${task.body.id}`, 'DELETE');
      expect(removed.body.deleted).toBe(true);
    });

    it('should aggregate open tasks globally with project and chapter names', async () => {
      const chapter = await api(`${p}/chapters`, 'POST', { title: 'Chapter 1' });
      await api(`${p}/tasks`, 'POST', { text: 'Open one', chapter_id: chapter.body.id });
      const closed = await api(`${p}/tasks`, 'POST', { text: 'Done one' });
      await api(`${p}/tasks/${closed.body.id}`, 'PATCH', { done: true });

      const global = await api('/api/tasks');
      expect(global.body.tasks).toHaveLength(1);
      expect(global.body.tasks[0]).toMatchObject({
        text: 'Open one',
        projectName: 'my-novel',
        chapterTitle: 'Chapter 1'
      });
    });

    it('should reject empty tasks and unknown chapters', async () => {
      expect((await api(`${p}/tasks`, 'POST', { text: '  ' })).status).toBe(400);
      expect((await api(`${p}/tasks`, 'POST', { text: 'x', chapter_id: 999 })).status).toBe(404);
    });
  });

  describe('editions', () => {
    it('should manage editions and build an edition-scoped export', async () => {
      await api(`${p}/import`, 'POST');
      const board = await api(`${p}/board`);
      const opening = board.body.chapters.find(c => c.file === 'content/01-opening.md');
      const middle = board.body.chapters.find(c => c.file === 'content/02-middle.md');
      const placeholder = await api(`${p}/chapters`, 'POST', { title: 'Planned chapter' });

      const edition = await api(`${p}/editions`, 'POST', {
        name: "Reader's Edition",
        description: 'Just the opening'
      });
      expect(edition.status).toBe(201);

      const set = await api(`${p}/editions/${edition.body.id}/chapters`, 'PUT', {
        chapter_ids: [middle.id, opening.id, placeholder.body.id]
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
        (await api(`${p}/editions/${edition.body.id}/chapters`, 'PUT', { chapter_ids: 'nope' }))
          .status
      ).toBe(400);
      expect((await api(`${p}/export/epub?edition=${edition.body.id}`)).status).toBe(500);
      expect((await api(`${p}/editions`, 'POST', { name: 'Empty' })).status).toBe(400);
    });
  });

  describe('collections', () => {
    it('should manage collections, membership, editions, and anthology export', async () => {
      // A second story project
      const storyDir = join(tempDir, 'story-two');
      mkdirSync(join(storyDir, 'content'), { recursive: true });
      writeFileSync(join(storyDir, 'content', '01-story.md'), '# Story Two\n\nOnce more.\n');
      const other = await api('/api/projects', 'POST', { path: storyDir });

      const col = await api('/api/collections', 'POST', {
        name: 'Vol. 1',
        description: 'Two tales'
      });
      expect(col.status).toBe(201);
      expect((await api('/api/collections', 'POST', { name: 'Vol. 1' })).status).toBe(400);

      const set = await api(`/api/collections/${col.body.id}/projects`, 'PUT', {
        project_ids: [other.body.id, project.id]
      });
      expect(set.body.projects.map(x => x.name)).toEqual(['story-two', 'my-novel']);

      const detail = await api(`/api/collections/${col.body.id}`);
      expect(detail.body.projects).toHaveLength(2);
      expect(detail.body.allProjects.length).toBeGreaterThanOrEqual(2);

      // Anthology export concatenates member stories in order
      const res = await fetch(`${base}/api/collections/${col.body.id}/export/docx`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-disposition')).toContain('Vol. 1.docx');

      // Edition scoped to a subset
      const ed = await api(`/api/collections/${col.body.id}/editions`, 'POST', {
        name: 'Sampler'
      });
      await api(`/api/collections/${col.body.id}/editions/${ed.body.id}/projects`, 'PUT', {
        project_ids: [other.body.id]
      });
      const edRes = await fetch(
        `${base}/api/collections/${col.body.id}/export/epub?edition=${ed.body.id}`
      );
      expect(edRes.status).toBe(200);
      expect(edRes.headers.get('content-disposition')).toContain('Vol. 1 - Sampler');

      const gone = await api(`/api/collections/${col.body.id}`, 'DELETE');
      expect(gone.body.deleted).toBe(true);
      expect((await api(`/api/collections/${col.body.id}`)).status).toBe(404);
    });

    it('should serve the collection page', async () => {
      const col = await api('/api/collections', 'POST', { name: 'Page Test' });
      const page = await fetch(`${base}/c/${col.body.id}`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('draftsync collection');
    });
  });

  describe('text stats and scan', () => {
    it('should import with stats and detect file edits with diff magnitude', async () => {
      await api(`${p}/import`, 'POST');
      let board = await api(`${p}/board`);
      const opening = board.body.chapters.find(c => c.file === 'content/01-opening.md');
      expect(opening.title).toBe('The Opening');
      expect(opening.word_count).toBe(1);
      expect(opening.excerpt).toBe('Text.');

      // First scan: nothing changed
      const clean = await api(`${p}/scan`, 'POST');
      expect(clean.body.changed).toEqual([]);

      // Edit the file, scan again
      writeFileSync(
        join(projectDir, 'content', '01-opening.md'),
        '# The Opening\n\nText.\n\nA whole new paragraph of five words.\n'
      );
      const scan = await api(`${p}/scan`, 'POST');
      expect(scan.body.changed).toHaveLength(1);
      expect(scan.body.changed[0]).toMatchObject({ chapter_id: opening.id, linesAdded: 2 });

      board = await api(`${p}/board`);
      expect(board.body.chapters.find(c => c.id === opening.id).word_count).toBe(8);

      const timeline = await api(`${p}/timeline`);
      const edited = timeline.body.activities.find(a => a.type === 'file_edited');
      expect(edited).toMatchObject({ chapter_id: opening.id, chapterTitle: 'The Opening' });
      expect(edited.data.linesAdded).toBe(2);
    });
  });

  describe('reviews and timeline', () => {
    it('should receive chapter and edition reviews, with files, on the timeline', async () => {
      const chapter = await api(`${p}/chapters`, 'POST', { title: 'Ch 1' });
      const edition = await api(`${p}/editions`, 'POST', { name: 'RE' });

      const r1 = await api(`${p}/reviews`, 'POST', {
        chapter_id: chapter.body.id,
        reviewer_name: 'Sarah',
        reviewer_email: 'sarah@example.com',
        body: 'The pacing drags in the middle.'
      });
      expect(r1.status).toBe(201);

      const r2 = await api(`${p}/reviews`, 'POST', {
        edition_id: edition.body.id,
        reviewer_name: 'Tom',
        reviewer_email: 'tom@example.com',
        file_name: 'notes.txt',
        file_base64: Buffer.from('typed feedback file').toString('base64')
      });
      expect(r2.status).toBe(201);
      expect(r2.body.file).toMatch(/^reviews\//);

      const list = await api(`${p}/reviews`);
      expect(list.body.reviews).toHaveLength(2);
      expect(list.body.reviews.map(r => r.reviewer_name).sort()).toEqual(['Sarah', 'Tom']);
      expect(list.body.reviews.find(r => r.chapter_id).chapterTitle).toBe('Ch 1');
      expect(list.body.reviews.find(r => r.edition_id).editionName).toBe('RE');

      const timeline = await api(`${p}/timeline`);
      const types = timeline.body.activities.map(a => a.type);
      expect(types.filter(t => t === 'review_received')).toHaveLength(2);
      expect(types).toContain('chapter_created');
      expect(types).toContain('edition_created');

      // Task activities: created and completed
      const task = await api(`${p}/tasks`, 'POST', {
        text: 'Fix pacing',
        chapter_id: chapter.body.id
      });
      await api(`${p}/tasks/${task.body.id}`, 'PATCH', { done: true });
      const after = await api(`${p}/timeline?chapter=${chapter.body.id}`);
      const chTypes = after.body.activities.map(a => a.type);
      expect(chTypes).toContain('task_created');
      expect(chTypes).toContain('task_completed');
    });

    it('should reject reviews without exactly one target or without contact', async () => {
      const both = await api(`${p}/reviews`, 'POST', {
        reviewer_name: 'X',
        reviewer_email: 'x@example.com'
      });
      expect(both.status).toBe(400);
      const noEmail = await api(`${p}/reviews`, 'POST', {
        chapter_id: 1,
        reviewer_name: 'X'
      });
      expect(noEmail.status).toBe(400);
    });
  });

  describe('operation RPC and OpenAPI', () => {
    it('should execute any operation via POST /api/op/{name}', async () => {
      const created = await api('/api/op/chapter.create', 'POST', {
        project_id: project.id,
        title: 'Via RPC'
      });
      expect(created.status).toBe(200);
      expect(created.body.title).toBe('Via RPC');

      const bad = await api('/api/op/chapter.create', 'POST', { project_id: project.id });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toContain('title');

      expect((await api('/api/op/nope.nothing', 'POST', {})).status).toBe(404);
    });

    it('should serve the OpenAPI document', async () => {
      const doc = await api('/api/openapi.json');
      expect(doc.status).toBe(200);
      expect(doc.body.openapi).toBe('3.1.0');
      expect(doc.body.paths['/api/op/review.create']).toBeDefined();
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
      const chapter = await api(`${p}/chapters`, 'POST', { title: 'Chapter 1' });
      const created = await api(`${p}/ai-events`, 'POST', {
        url: 'https://claude.ai/chat/abc',
        purpose: 'critique',
        chapter_id: chapter.body.id,
        justification: 'asked for pacing feedback'
      });
      expect(created.status).toBe(201);
      expect(created.body.provider).toBe('anthropic');

      const board = await api(`${p}/board`);
      expect(board.body.ai.byChapter[chapter.body.id]).toBe(1);

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
