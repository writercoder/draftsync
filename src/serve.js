/**
 * Local Draftsync Server
 *
 * Global (not per-workspace): serves a home view of every registered
 * project — grouped by label — and a kanban board per project, from the
 * single SQLite store in ~/.draftsync. Binds to localhost only.
 *
 * Routes: `/` home, `/p/:id` board, `/api/projects` registry, and
 * project-scoped APIs under `/api/p/:id/...` (board, cards, import,
 * ai-events, ai-ingest, export, metadata).
 */

import http from 'http';
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import chalk from 'chalk';
import { openStore, getDataDir, STAGES } from './store.js';
import { getAllMarkdownFiles, filterExcludedFiles, getFilesToBuild } from './file-filter.js';
import { AI_PURPOSES, providerFromUrl, ingestClaudeCode } from './ai-audit.js';
import {
  convertMarkdownFilesToDocx,
  convertMarkdownFilesToPdf,
  convertMarkdownToEpub
} from './pandoc.js';

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');

const EXPORT_TYPES = {
  epub: { mime: 'application/epub+zip', ext: 'epub' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx'
  },
  pdf: { mime: 'application/pdf', ext: 'pdf' }
};

/**
 * Read and JSON-parse a request body (up to 1MB)
 *
 * @param {http.IncomingMessage} req - Request
 * @returns {Promise<Object>} Parsed body ({} when empty)
 */
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Derive a card title from a Markdown file (first H1, else basename)
 *
 * @param {string} filePath - Path to the Markdown file
 * @returns {Promise<string>} Title
 */
async function titleFromFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) return h1[1].trim();
  } catch {
    // fall through to basename
  }
  return path.basename(filePath, '.md');
}

/**
 * Read a project's draftsync manifest (empty shape when missing)
 *
 * @param {string} projectPath - Absolute project directory
 * @returns {Promise<Object>} Manifest object
 */
async function readProjectManifest(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, '.draftsync.json'), 'utf8'));
  } catch {
    return { files: {}, config: {} };
  }
}

/**
 * Build the manuscript in the requested format, returning the output path
 *
 * @param {Object} project - Project row (path, name)
 * @param {string} format - 'epub', 'docx', or 'pdf'
 * @returns {Promise<string>} Absolute path of the built file
 */
async function buildExport(project, format) {
  const metadataPath = path.join(project.path, 'templates', 'metadata.yaml');
  const mdFiles = await getFilesToBuild({
    contentDir: path.join(project.path, 'content'),
    metadataPath
  });
  if (mdFiles.length === 0) {
    throw new Error('no Markdown files to build in content/');
  }
  let metadata = null;
  try {
    await fs.access(metadataPath);
    metadata = metadataPath;
  } catch {
    // optional
  }
  const output = path.join(project.path, 'dist', `${project.name}.${EXPORT_TYPES[format].ext}`);

  if (format === 'docx') {
    await convertMarkdownFilesToDocx(mdFiles, output, { metadata });
  } else if (format === 'pdf') {
    await convertMarkdownFilesToPdf(mdFiles, output, { metadata });
  } else {
    const css = path.join(project.path, 'templates', 'epub.css');
    let cssFile = null;
    try {
      await fs.access(css);
      cssFile = css;
    } catch {
      // optional
    }
    await convertMarkdownToEpub(mdFiles, output, { metadata, css: cssFile, tocDepth: 3 });
  }
  return output;
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
  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };
    const sendPage = async file => {
      const html = await fs.readFile(path.join(UI_DIR, file), 'utf8');
      return send(200, html, 'text/html; charset=utf-8');
    };

    try {
      const url = new URL(req.url, 'http://localhost');

      // Pages
      if (req.method === 'GET' && url.pathname === '/') return sendPage('home.html');
      if (req.method === 'GET' && /^\/p\/\d+$/.test(url.pathname)) return sendPage('kanban.html');

      // Global open-tasks overview
      if (req.method === 'GET' && url.pathname === '/api/tasks') {
        return send(200, { tasks: store.listAllOpenTasks() });
      }

      // Project registry
      if (req.method === 'GET' && url.pathname === '/api/projects') {
        return send(200, { projects: store.listProjects() });
      }
      if (req.method === 'POST' && url.pathname === '/api/projects') {
        const body = await readBody(req);
        const projectPath = path.resolve(body.path || '');
        let stat;
        try {
          stat = await fs.stat(projectPath);
        } catch {
          return send(400, { error: `not a directory: ${projectPath}` });
        }
        if (!stat.isDirectory()) {
          return send(400, { error: `not a directory: ${projectPath}` });
        }
        return send(201, store.getOrCreateProject(projectPath));
      }
      const projectEdit = url.pathname.match(/^\/api\/projects\/(\d+)$/);
      if (req.method === 'PATCH' && projectEdit) {
        const project = store.getProject(Number(projectEdit[1]));
        if (!project) return send(404, { error: 'project not found' });
        const body = await readBody(req);
        return send(200, store.updateProject(project.id, body));
      }

      // Project-scoped API
      const scoped = url.pathname.match(/^\/api\/p\/(\d+)(\/.*)$/);
      if (!scoped) return send(404, { error: 'not found' });
      const project = store.getProject(Number(scoped[1]));
      if (!project) return send(404, { error: 'project not found' });
      const route = scoped[2];
      const cardMatch = route.match(/^\/cards\/(\d+)$/);
      const taskMatch = route.match(/^\/tasks\/(\d+)$/);
      const aiMatch = route.match(/^\/ai-events\/(\d+)$/);
      const exportMatch = route.match(/^\/export\/(epub|docx|pdf)$/);

      if (req.method === 'GET' && route === '/board') {
        const aiEvents = store.listAiEvents(project.id);
        const aiCounts = {};
        for (const e of aiEvents) {
          if (e.card_id) aiCounts[e.card_id] = (aiCounts[e.card_id] || 0) + 1;
        }
        const manifest = await readProjectManifest(project.path);
        const cards = store.listCards(project.id).map(card => {
          const gdocId = card.file && manifest.files?.[card.file]?.gdocId;
          return gdocId
            ? { ...card, gdocUrl: `https://docs.google.com/document/d/${gdocId}/edit` }
            : card;
        });
        const taskCounts = {};
        for (const t of store.listTasks(project.id)) {
          if (!t.done && t.card_id) taskCounts[t.card_id] = (taskCounts[t.card_id] || 0) + 1;
        }
        const driveFolderId = manifest.config?.driveFolderId;
        return send(200, {
          project: {
            id: project.id,
            name: project.name,
            path: project.path,
            label: project.label,
            driveFolderUrl: driveFolderId
              ? `https://drive.google.com/drive/folders/${driveFolderId}`
              : null
          },
          stages: STAGES,
          cards,
          tasks: { openByCard: taskCounts },
          ai: { total: aiEvents.length, byCard: aiCounts }
        });
      }

      if (req.method === 'GET' && route === '/tasks') {
        return send(200, { tasks: store.listTasks(project.id) });
      }
      if (req.method === 'POST' && route === '/tasks') {
        const body = await readBody(req);
        if (body.card_id) {
          const card = store.getCard(Number(body.card_id));
          if (!card || card.project_id !== project.id) {
            return send(400, { error: 'unknown card' });
          }
        }
        return send(
          201,
          store.createTask(project.id, {
            text: body.text,
            cardId: body.card_id ? Number(body.card_id) : null
          })
        );
      }
      if ((req.method === 'PATCH' || req.method === 'DELETE') && taskMatch) {
        const task = store.getTask(Number(taskMatch[1]));
        if (!task || task.project_id !== project.id) {
          return send(404, { error: 'task not found' });
        }
        if (req.method === 'DELETE') {
          store.deleteTask(task.id);
          return send(200, { deleted: true });
        }
        const body = await readBody(req);
        return send(200, store.updateTask(task.id, body));
      }

      if (req.method === 'GET' && exportMatch) {
        const format = exportMatch[1];
        try {
          const filePath = await buildExport(project, format);
          const data = await fs.readFile(filePath);
          res.writeHead(200, {
            'Content-Type': EXPORT_TYPES[format].mime,
            'Content-Disposition': `attachment; filename="${path.basename(filePath)}"`
          });
          return res.end(data);
        } catch (error) {
          return send(500, { error: error.message });
        }
      }

      if (req.method === 'GET' && route === '/metadata') {
        const metadataPath = path.join(project.path, 'templates', 'metadata.yaml');
        try {
          return send(200, { content: await fs.readFile(metadataPath, 'utf8'), exists: true });
        } catch {
          return send(200, { content: '', exists: false });
        }
      }
      if (req.method === 'PUT' && route === '/metadata') {
        const body = await readBody(req);
        if (typeof body.content !== 'string') {
          return send(400, { error: 'content (string) is required' });
        }
        const templatesDir = path.join(project.path, 'templates');
        await fs.mkdir(templatesDir, { recursive: true });
        await fs.writeFile(path.join(templatesDir, 'metadata.yaml'), body.content, 'utf8');
        return send(200, { saved: true });
      }

      if (req.method === 'POST' && route === '/cards') {
        const body = await readBody(req);
        return send(201, store.createCard(project.id, body));
      }

      if (req.method === 'PATCH' && cardMatch) {
        const id = Number(cardMatch[1]);
        const existing = store.getCard(id);
        if (!existing || existing.project_id !== project.id) {
          return send(404, { error: 'card not found' });
        }
        const body = await readBody(req);
        let card = store.updateCard(id, body);
        if (body.stage !== undefined || body.index !== undefined) {
          card = store.moveCard(id, body.stage ?? card.stage, body.index);
        }
        return send(200, card);
      }

      if (req.method === 'DELETE' && cardMatch) {
        const id = Number(cardMatch[1]);
        const existing = store.getCard(id);
        if (!existing || existing.project_id !== project.id) {
          return send(404, { error: 'card not found' });
        }
        store.deleteCard(id);
        return send(200, { deleted: true });
      }

      if (req.method === 'POST' && route === '/import') {
        const contentDir = path.join(project.path, 'content');
        let files;
        try {
          files = filterExcludedFiles(await getAllMarkdownFiles(contentDir));
        } catch {
          return send(400, { error: 'no content/ directory in this project' });
        }
        const linked = store.linkedFiles(project.id);
        const imported = [];
        for (const file of files) {
          const relative = path.relative(project.path, file);
          if (linked.has(relative)) continue;
          imported.push(
            store.createCard(project.id, {
              title: await titleFromFile(file),
              stage: 'drafting',
              file: relative
            })
          );
        }
        return send(200, { imported: imported.length, cards: imported });
      }

      if (req.method === 'GET' && route === '/ai-events') {
        return send(200, { events: store.listAiEvents(project.id), purposes: AI_PURPOSES });
      }

      if (req.method === 'POST' && route === '/ai-events') {
        const body = await readBody(req);
        const provider = body.provider || (body.url && providerFromUrl(body.url));
        if (!provider) {
          return send(400, { error: 'provider required (or a claude.ai / chatgpt.com URL)' });
        }
        if (!AI_PURPOSES.includes(body.purpose)) {
          return send(400, { error: `purpose must be one of: ${AI_PURPOSES.join(', ')}` });
        }
        if (body.purpose === 'prose-suggestion' && !body.justification) {
          return send(400, { error: 'prose-suggestion requires a justification (AI policy)' });
        }
        let file = body.file || null;
        if (body.card_id) {
          const card = store.getCard(Number(body.card_id));
          if (!card || card.project_id !== project.id) {
            return send(400, { error: 'unknown card' });
          }
          file = file || card.file;
        }
        const { event } = store.upsertAiEvent(project.id, {
          sessionKey: body.url || `manual:${crypto.randomUUID()}`,
          provider,
          source: body.url ? 'chat-link' : 'manual',
          url: body.url || null,
          model: body.model || null,
          cardId: body.card_id ? Number(body.card_id) : null,
          file,
          purpose: body.purpose,
          justification: body.justification || ''
        });
        return send(201, event);
      }

      if (req.method === 'DELETE' && aiMatch) {
        const event = store.getAiEvent(Number(aiMatch[1]));
        if (!event || event.project_id !== project.id) {
          return send(404, { error: 'event not found' });
        }
        store.deleteAiEvent(event.id);
        return send(200, { deleted: true });
      }

      if (req.method === 'POST' && route === '/ai-ingest') {
        const result = await ingestClaudeCode(store, project.id, project.path);
        return send(200, result);
      }

      return send(404, { error: 'not found' });
    } catch (error) {
      return send(400, { error: error.message });
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
