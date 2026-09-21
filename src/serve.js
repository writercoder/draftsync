/**
 * Local Draftsync Server — thin HTTP adapter over the operation
 * registry (ADR 0001)
 *
 * Serves the web app pages, resource-style routes for the UI, a
 * generic RPC endpoint (POST /api/op/{name}) exposing every operation,
 * and an OpenAPI document generated from the registry schemas.
 * Binds to localhost only.
 */

import http from 'http';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { openStore, getDataDir } from './store.js';
import { execute, buildOpenApiDocument, OperationError } from './core/registry.js';
import './core/operations.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');

const EXPORT_MIME = {
  epub: 'application/epub+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf'
};

/**
 * Read and JSON-parse a request body (up to 16MB — review file uploads)
 *
 * @param {http.IncomingMessage} req - Request
 * @returns {Promise<Object>} Parsed body ({} when empty)
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 16e6) reject(new OperationError('body too large', 400));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new OperationError('invalid JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Does a directory look like a draftsync project?
 *
 * @param {string} dir - Directory to check
 * @returns {Promise<boolean>} True when a manifest or content/ exists
 */
export async function looksLikeProject(dir) {
  for (const marker of ['.draftsync.json', 'content']) {
    try {
      await fs.access(path.join(dir, marker));
      return true;
    } catch {
      // keep looking
    }
  }
  return false;
}

/**
 * Create the global draftsync HTTP server
 *
 * @param {Object} options
 * @param {import('./store.js').Store} options.store - Open store
 * @returns {http.Server} Configured server (not yet listening)
 */
export function createDraftsyncServer({ store }) {
  const ctx = { store };

  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const sendPage = async file =>
      send(200, await fs.readFile(path.join(UI_DIR, file), 'utf8'), 'text/html; charset=utf-8');
    const run = (name, input) => execute(name, ctx, input);
    const streamExport = async (name, input) => {
      const result = await run(name, input);
      const data = await fs.readFile(result.path);
      res.writeHead(200, {
        'Content-Type': EXPORT_MIME[result.format],
        'Content-Disposition': `attachment; filename="${result.filename}"`
      });
      res.end(data);
    };

    try {
      const url = new URL(req.url, 'http://localhost');
      const p = url.pathname;
      const m = pattern => p.match(pattern);

      // Pages
      if (req.method === 'GET' && p === '/') return await sendPage('home.html');
      if (req.method === 'GET' && m(/^\/p\/\d+$/)) return await sendPage('kanban.html');
      if (req.method === 'GET' && m(/^\/c\/\d+$/)) return await sendPage('collection.html');

      // Generic RPC + OpenAPI — every operation, one endpoint shape
      const opCall = m(/^\/api\/op\/([a-z_]+\.[a-z_]+)$/);
      if (opCall && req.method === 'POST') {
        return send(200, await run(opCall[1], await readBody(req)));
      }
      if (req.method === 'GET' && p === '/api/openapi.json') {
        return send(200, buildOpenApiDocument());
      }

      // Global
      if (req.method === 'GET' && p === '/api/tasks') return send(200, await run('task.list_open'));
      if (req.method === 'GET' && p === '/api/projects') {
        return send(200, await run('project.list'));
      }
      if (req.method === 'POST' && p === '/api/projects') {
        return send(201, await run('project.register', await readBody(req)));
      }
      let x;
      if ((x = m(/^\/api\/projects\/(\d+)$/)) && req.method === 'PATCH') {
        return send(
          200,
          await run('project.update', { project_id: x[1], ...(await readBody(req)) })
        );
      }

      // Collections
      if (req.method === 'GET' && p === '/api/collections') {
        return send(200, await run('collection.list'));
      }
      if (req.method === 'POST' && p === '/api/collections') {
        return send(201, await run('collection.create', await readBody(req)));
      }
      if ((x = m(/^\/api\/collections\/(\d+)$/))) {
        const collection_id = x[1];
        if (req.method === 'GET') return send(200, await run('collection.get', { collection_id }));
        if (req.method === 'PATCH') {
          return send(
            200,
            await run('collection.update', { collection_id, ...(await readBody(req)) })
          );
        }
        if (req.method === 'DELETE') {
          return send(200, await run('collection.delete', { collection_id }));
        }
      }
      if ((x = m(/^\/api\/collections\/(\d+)\/projects$/)) && req.method === 'PUT') {
        return send(
          200,
          await run('collection.set_projects', { collection_id: x[1], ...(await readBody(req)) })
        );
      }
      if ((x = m(/^\/api\/collections\/(\d+)\/editions$/)) && req.method === 'POST') {
        return send(
          201,
          await run('collection.create_edition', { collection_id: x[1], ...(await readBody(req)) })
        );
      }
      if ((x = m(/^\/api\/collections\/(\d+)\/editions\/(\d+)$/))) {
        const input = { collection_id: x[1], edition_id: x[2] };
        if (req.method === 'GET') return send(200, await run('collection.get_edition', input));
        if (req.method === 'DELETE') {
          return send(200, await run('collection.delete_edition', input));
        }
      }
      if (
        (x = m(/^\/api\/collections\/(\d+)\/editions\/(\d+)\/projects$/)) &&
        req.method === 'PUT'
      ) {
        return send(
          200,
          await run('collection.set_edition_projects', {
            collection_id: x[1],
            edition_id: x[2],
            ...(await readBody(req))
          })
        );
      }
      if ((x = m(/^\/api\/collections\/(\d+)\/export\/(epub|docx|pdf)$/)) && req.method === 'GET') {
        return await streamExport('export.collection', {
          collection_id: x[1],
          format: x[2],
          edition_id: url.searchParams.get('edition') || undefined
        });
      }

      // Project-scoped
      const scoped = m(/^\/api\/p\/(\d+)(\/.*)$/);
      if (!scoped) return send(404, { error: 'not found' });
      const project_id = scoped[1];
      const route = scoped[2];
      const r = pattern => route.match(pattern);

      if (req.method === 'GET' && route === '/board') {
        return send(200, await run('board.get', { project_id }));
      }
      if (req.method === 'POST' && route === '/scan') {
        return send(200, await run('project.scan', { project_id }));
      }
      if (req.method === 'POST' && route === '/import') {
        return send(200, await run('chapter.import', { project_id }));
      }
      if (req.method === 'POST' && route === '/chapters') {
        return send(201, await run('chapter.create', { project_id, ...(await readBody(req)) }));
      }
      if ((x = r(/^\/chapters\/(\d+)$/))) {
        const chapter_id = x[1];
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          const { stage, index, ...fields } = body;
          let chapter = null;
          if (Object.keys(fields).length > 0) {
            chapter = await run('chapter.update', { project_id, chapter_id, ...fields });
          }
          if (stage !== undefined || index !== undefined) {
            const current = ctx.store.getChapter(Number(chapter_id));
            chapter = await run('chapter.move', {
              project_id,
              chapter_id,
              stage: stage ?? current?.stage,
              index
            });
          }
          return send(200, chapter ?? ctx.store.getChapter(Number(chapter_id)));
        }
        if (req.method === 'DELETE') {
          return send(200, await run('chapter.delete', { project_id, chapter_id }));
        }
      }
      if (req.method === 'GET' && route === '/tasks') {
        return send(200, await run('task.list', { project_id }));
      }
      if (req.method === 'POST' && route === '/tasks') {
        return send(201, await run('task.create', { project_id, ...(await readBody(req)) }));
      }
      if ((x = r(/^\/tasks\/(\d+)$/))) {
        const task_id = x[1];
        if (req.method === 'PATCH') {
          return send(
            200,
            await run('task.update', { project_id, task_id, ...(await readBody(req)) })
          );
        }
        if (req.method === 'DELETE') {
          return send(200, await run('task.delete', { project_id, task_id }));
        }
      }
      if (req.method === 'GET' && route === '/editions') {
        return send(200, await run('edition.list', { project_id }));
      }
      if (req.method === 'POST' && route === '/editions') {
        return send(201, await run('edition.create', { project_id, ...(await readBody(req)) }));
      }
      if ((x = r(/^\/editions\/(\d+)\/chapters$/)) && req.method === 'PUT') {
        return send(
          200,
          await run('edition.set_chapters', {
            project_id,
            edition_id: x[1],
            ...(await readBody(req))
          })
        );
      }
      if ((x = r(/^\/editions\/(\d+)$/))) {
        const edition_id = x[1];
        if (req.method === 'GET') {
          return send(200, await run('edition.get', { project_id, edition_id }));
        }
        if (req.method === 'PATCH') {
          return send(
            200,
            await run('edition.update', { project_id, edition_id, ...(await readBody(req)) })
          );
        }
        if (req.method === 'DELETE') {
          return send(200, await run('edition.delete', { project_id, edition_id }));
        }
      }
      if ((x = r(/^\/export\/(epub|docx|pdf)$/)) && req.method === 'GET') {
        return await streamExport('export.project', {
          project_id,
          format: x[1],
          edition_id: url.searchParams.get('edition') || undefined
        });
      }
      if (route === '/metadata') {
        if (req.method === 'GET') return send(200, await run('metadata.get', { project_id }));
        if (req.method === 'PUT') {
          return send(200, await run('metadata.set', { project_id, ...(await readBody(req)) }));
        }
      }
      if (req.method === 'GET' && route === '/reviews') {
        return send(200, await run('review.list', { project_id }));
      }
      if (req.method === 'POST' && route === '/reviews') {
        return send(201, await run('review.create', { project_id, ...(await readBody(req)) }));
      }
      if ((x = r(/^\/reviews\/(\d+)$/)) && req.method === 'DELETE') {
        return send(200, await run('review.delete', { project_id, review_id: x[1] }));
      }
      if (req.method === 'GET' && route === '/timeline') {
        return send(
          200,
          await run('timeline.list', {
            project_id,
            chapter_id: url.searchParams.get('chapter') || undefined,
            limit: url.searchParams.get('limit') || undefined
          })
        );
      }
      if (req.method === 'GET' && route === '/ai-events') {
        return send(200, await run('ai.list_events', { project_id }));
      }
      if (req.method === 'POST' && route === '/ai-events') {
        return send(201, await run('ai.log_event', { project_id, ...(await readBody(req)) }));
      }
      if ((x = r(/^\/ai-events\/(\d+)$/)) && req.method === 'DELETE') {
        return send(200, await run('ai.delete_event', { project_id, event_id: x[1] }));
      }
      if (req.method === 'POST' && route === '/ai-ingest') {
        return send(200, await run('ai.ingest_claude', { project_id }));
      }

      return send(404, { error: 'not found' });
    } catch (error) {
      const status = error instanceof OperationError ? error.status : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  });
}

/**
 * `draftsync serve` command: start the global board server
 *
 * Works from anywhere. When run inside a directory that looks like a
 * draftsync project, that project is registered and its board opens;
 * otherwise the projects home opens.
 *
 * @param {Object} options - CLI options
 * @param {string} [options.port='8787'] - Port to listen on
 * @returns {Promise<void>}
 */
export async function serveCommand(options = {}) {
  const port = Number(options.port || 8787);
  const store = openStore();
  const server = createDraftsyncServer({ store });

  let startPath = '/';
  if (await looksLikeProject(process.cwd())) {
    const project = store.getOrCreateProject(process.cwd());
    startPath = `/p/${project.id}`;
  }

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}${startPath}`;
    console.log(chalk.blue.bold('\ndraftsync\n'));
    console.log(chalk.green(`✓ Serving all projects at http://localhost:${port}`));
    console.log(chalk.gray(`  Opening ${url}`));
    console.log(chalk.gray(`  API: http://localhost:${port}/api/openapi.json`));
    console.log(chalk.gray(`  Data: ${path.join(getDataDir(), 'draftsync.db')}`));
    console.log(chalk.gray('  Press Ctrl+C to stop\n'));
    const opener =
      process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  });

  server.on('error', error => {
    console.error(chalk.red(`✗ Could not start server: ${error.message}`));
    if (error.code === 'EADDRINUSE') {
      console.log(chalk.gray(`  Port ${port} is in use — try --port ${port + 1}`));
    }
    process.exitCode = 1;
  });
}
