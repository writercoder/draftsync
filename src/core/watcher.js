/**
 * Filesystem Watcher — ambient edit detection for the serve engine
 *
 * Uses Node's fs.watch (FSEvents on macOS, inotify on Linux,
 * ReadDirectoryChangesW on Windows) on each project's content tree.
 * Events are not trusted individually: any event just schedules a
 * debounced project rescan, and the hash-driven scan decides what
 * actually changed — which neutralizes editor atomic-save quirks and
 * duplicate notifications.
 *
 * The project list is refreshed periodically so projects registered
 * while the server runs get watched without coupling to the routes.
 */

import { watch, existsSync } from 'fs';
import path from 'path';

/**
 * Start watching every project's content directory
 *
 * @param {Object} options
 * @param {import('../store.js').Store} options.store - Open store
 * @param {Function} options.scanProject - (store, project) => scan result
 * @param {Function} [options.onChange] - Called with (project, result)
 *   when a rescan found changes
 * @param {number} [options.debounceMs=800] - Quiet period after events
 * @param {number} [options.refreshMs=60000] - Project-list refresh cadence
 * @returns {{stop: () => void, watchedCount: () => number}} Controller
 */
export function startWatcher({
  store,
  scanProject,
  onChange,
  debounceMs = 800,
  refreshMs = 60000
}) {
  const watchers = new Map(); // project.id -> fs.FSWatcher
  const timers = new Map(); // project.id -> debounce timer
  let stopped = false;

  const scheduleScan = project => {
    clearTimeout(timers.get(project.id));
    timers.set(
      project.id,
      setTimeout(async () => {
        if (stopped) return;
        try {
          const fresh = store.getProject(project.id);
          if (!fresh) return;
          const result = await scanProject(store, fresh);
          if (result.changed.length > 0 && onChange) onChange(fresh, result);
        } catch {
          // A failed scan must never take the server down
        }
      }, debounceMs)
    );
  };

  const ensureWatched = project => {
    if (watchers.has(project.id)) return;
    const contentDir = path.join(project.path, 'content');
    if (!existsSync(contentDir)) return;
    try {
      const watcher = watch(contentDir, { recursive: true }, () => scheduleScan(project));
      watcher.on('error', () => {
        watcher.close();
        watchers.delete(project.id);
      });
      watchers.set(project.id, watcher);
    } catch {
      // Unwatchable directory (permissions, races) — skip, retry on refresh
    }
  };

  const refresh = () => {
    if (stopped) return;
    const projects = store.listProjects();
    const alive = new Set(projects.map(p => p.id));
    for (const [id, watcher] of watchers) {
      if (!alive.has(id)) {
        watcher.close();
        watchers.delete(id);
      }
    }
    for (const project of projects) ensureWatched(project);
  };

  refresh();
  const interval = setInterval(refresh, refreshMs);
  interval.unref?.();

  return {
    stop() {
      stopped = true;
      clearInterval(interval);
      for (const timer of timers.values()) clearTimeout(timer);
      for (const watcher of watchers.values()) watcher.close();
      watchers.clear();
    },
    watchedCount: () => watchers.size
  };
}
