/**
 * Integration test for the filesystem watcher: a real fs.watch on a
 * temp project, a real file edit, a debounced hash-driven rescan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStore } from '../src/store.js';
import { scanProject } from '../src/core/operations.js';
import { startWatcher } from '../src/core/watcher.js';

describe('Watcher Integration Tests', () => {
  let tempDir;
  let store;
  let watcher;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-watch-'));
    store = openStore(join(tempDir, 'data'));
  });

  afterEach(() => {
    watcher?.stop();
    store.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should detect an edit via fs events and record the activity', async () => {
    const projectDir = join(tempDir, 'watched-novel');
    mkdirSync(join(projectDir, 'content'), { recursive: true });
    const file = join(projectDir, 'content', '01-ch.md');
    writeFileSync(file, '# Ch One\n\nOriginal words here.\n');

    const project = store.getOrCreateProject(projectDir);
    store.createChapter(project.id, {
      title: 'Ch One',
      stage: 'drafting',
      file: 'content/01-ch.md'
    });
    await scanProject(store, project); // baseline snapshot

    const changes = [];
    watcher = startWatcher({
      store,
      scanProject,
      onChange: (p, result) => changes.push({ project: p.name, result }),
      debounceMs: 120
    });
    expect(watcher.watchedCount()).toBe(1);

    // Real edit on disk — the watcher should notice without any request
    await new Promise(r => setTimeout(r, 150));
    writeFileSync(file, '# Ch One\n\nOriginal words here, and now several more of them.\n');

    await new Promise(r => setTimeout(r, 1200));
    expect(changes).toHaveLength(1);
    expect(changes[0].project).toBe('watched-novel');
    expect(changes[0].result.changed[0].wordDelta).toBe(6);

    const activity = store.listActivities(project.id).find(a => a.type === 'file_edited');
    expect(activity.data.linesAdded).toBe(1);
  });

  it('should skip projects without a content directory and stop cleanly', () => {
    store.getOrCreateProject(join(tempDir, 'no-content-here'));
    watcher = startWatcher({ store, scanProject, debounceMs: 50 });
    expect(watcher.watchedCount()).toBe(0);
    watcher.stop();
    expect(watcher.watchedCount()).toBe(0);
  });
});
