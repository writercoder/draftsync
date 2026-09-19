/**
 * Integration tests for the kanban HTTP server
 *
 * Runs the real server on an ephemeral port against a temp-dir store
 * and project, exercising the API with fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStore } from '../src/store.js';
import { createKanbanServer } from '../src/serve.js';

describe('Serve Integration Tests', () => {
  let tempDir;
  let projectDir;
  let store;
  let server;
  let base;

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
    server = createKanbanServer({ store, projectPath: projectDir });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
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

  it('should serve the board UI at /', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('draftsync board');
  });

  it('should return the empty board with stages and project info', async () => {
    const { status, body } = await api('/api/board');
    expect(status).toBe(200);
    expect(body.project.name).toBe('my-novel');
    expect(body.stages).toHaveLength(5);
    expect(body.cards).toEqual([]);
  });

  it('should create, move, and delete a card through the API', async () => {
    const created = await api('/api/cards', 'POST', { title: 'Chapter 1', stage: 'outline' });
    expect(created.status).toBe(201);

    const moved = await api(`/api/cards/${created.body.id}`, 'PATCH', {
      stage: 'revision',
      index: 0
    });
    expect(moved.body.stage).toBe('revision');

    const edited = await api(`/api/cards/${created.body.id}`, 'PATCH', { notes: 'tighten pacing' });
    expect(edited.body.notes).toBe('tighten pacing');

    const deleted = await api(`/api/cards/${created.body.id}`, 'DELETE');
    expect(deleted.body.deleted).toBe(true);

    const board = await api('/api/board');
    expect(board.body.cards).toEqual([]);
  });

  it('should reject bad input with 400', async () => {
    const noTitle = await api('/api/cards', 'POST', { stage: 'outline' });
    expect(noTitle.status).toBe(400);
    const badStage = await api('/api/cards', 'POST', { title: 'X', stage: 'nope' });
    expect(badStage.status).toBe(400);
  });

  it('should reject malformed JSON bodies with 400', async () => {
    const res = await fetch(base + '/api/cards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json'
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid JSON/);
  });

  it('should 404 unknown cards and routes', async () => {
    expect((await api('/api/cards/999', 'PATCH', { notes: 'x' })).status).toBe(404);
    expect((await api('/api/nope')).status).toBe(404);
  });

  it('should expose Google Doc links and the Drive folder from the manifest', async () => {
    await api('/api/import', 'POST');
    const board = await api('/api/board');

    expect(board.body.project.driveFolderUrl).toBe(
      'https://drive.google.com/drive/folders/folder-77'
    );
    const opening = board.body.cards.find(c => c.file === 'content/01-opening.md');
    expect(opening.gdocUrl).toBe('https://docs.google.com/document/d/gdoc-123/edit');
    const middle = board.body.cards.find(c => c.file === 'content/02-middle.md');
    expect(middle.gdocUrl).toBeUndefined();
  });

  it('should build and download a DOCX export', async () => {
    const res = await fetch(base + '/api/export/docx');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('wordprocessingml');
    expect(res.headers.get('content-disposition')).toContain('my-novel.docx');
    const bytes = new Uint8Array(await res.arrayBuffer());
    // DOCX files are ZIP archives: PK magic bytes
    expect([bytes[0], bytes[1]]).toEqual([0x50, 0x4b]);
  });

  it('should manage AI events over the API with provider auto-detection', async () => {
    const card = await api('/api/cards', 'POST', { title: 'Chapter 1' });

    const created = await api('/api/ai-events', 'POST', {
      url: 'https://claude.ai/chat/abc',
      purpose: 'critique',
      card_id: card.body.id,
      justification: 'asked for pacing feedback'
    });
    expect(created.status).toBe(201);
    expect(created.body.provider).toBe('anthropic');
    expect(created.body.card_id).toBe(card.body.id);

    const board = await api('/api/board');
    expect(board.body.ai.total).toBe(1);
    expect(board.body.ai.byCard[card.body.id]).toBe(1);

    const listed = await api('/api/ai-events');
    expect(listed.body.events).toHaveLength(1);
    expect(listed.body.purposes).toContain('prose-suggestion');

    const removed = await api(`/api/ai-events/${created.body.id}`, 'DELETE');
    expect(removed.body.deleted).toBe(true);
  });

  it('should enforce the AI policy and provider requirements', async () => {
    const noProvider = await api('/api/ai-events', 'POST', { purpose: 'other' });
    expect(noProvider.status).toBe(400);

    const noJustification = await api('/api/ai-events', 'POST', {
      provider: 'openai',
      purpose: 'prose-suggestion'
    });
    expect(noJustification.status).toBe(400);
    expect(noJustification.body.error).toMatch(/justification/);

    const badPurpose = await api('/api/ai-events', 'POST', {
      provider: 'openai',
      purpose: 'vibes'
    });
    expect(badPurpose.status).toBe(400);
  });

  it('should import chapters from content/, excluding drafts, idempotently', async () => {
    const first = await api('/api/import', 'POST');
    expect(first.body.imported).toBe(2);

    const board = await api('/api/board');
    const titles = board.body.cards.map(c => c.title).sort();
    expect(titles).toEqual(['02-middle', 'The Opening']);
    expect(board.body.cards.every(c => c.stage === 'drafting')).toBe(true);
    expect(board.body.cards.map(c => c.file).sort()).toEqual([
      'content/01-opening.md',
      'content/02-middle.md'
    ]);

    const again = await api('/api/import', 'POST');
    expect(again.body.imported).toBe(0);
  });
});
