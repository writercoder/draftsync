/**
 * Local Kanban Server
 *
 * Serves a web-based kanban board for tracking the current project's
 * writing pipeline. Data lives in the SQLite store (~/.draftsync);
 * the server binds to localhost only.
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

const EXPORT_TYPES = {
  epub: { mime: 'application/epub+zip', ext: 'epub' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ext: 'docx'
  },
  pdf: { mime: 'application/pdf', ext: 'pdf' }
};

/**
 * Read the project's draftsync manifest (empty shape when missing)
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
 * @param {string} projectPath - Absolute project directory
 * @param {string} format - 'epub', 'docx', or 'pdf'
 * @param {string} projectName - Used for the output file name
 * @returns {Promise<string>} Absolute path of the built file
 */
async function buildExport(projectPath, format, projectName) {
  const metadataPath = path.join(projectPath, 'templates', 'metadata.yaml');
  const mdFiles = await getFilesToBuild({
    contentDir: path.join(projectPath, 'content'),
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
  const output = path.join(projectPath, 'dist', `${projectName}.${EXPORT_TYPES[format].ext}`);

  if (format === 'docx') {
    await convertMarkdownFilesToDocx(mdFiles, output, { metadata });
  } else if (format === 'pdf') {
    await convertMarkdownFilesToPdf(mdFiles, output, { metadata });
  } else {
    const css = path.join(projectPath, 'templates', 'epub.css');
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

const UI_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui', 'kanban.html');

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
 * Create the kanban HTTP server for a project directory
 *
 * @param {Object} options
 * @param {import('./store.js').Store} options.store - Open store
 * @param {string} options.projectPath - Absolute project directory
 * @returns {http.Server} Configured server (not yet listening)
 */
export function createKanbanServer({ store, projectPath }) {
  const project = store.getOrCreateProject(projectPath);

  return http.createServer(async (req, res) => {
    const send = (status, body, type = 'application/json') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(type === 'application/json' ? JSON.stringify(body) : body);
    };

    try {
      const url = new URL(req.url, 'http://localhost');
      const cardMatch = url.pathname.match(/^\/api\/cards\/(\d+)$/);

      if (req.method === 'GET' && url.pathname === '/') {
        const html = await fs.readFile(UI_PATH, 'utf8');
        return send(200, html, 'text/html; charset=utf-8');
      }

      if (req.method === 'GET' && url.pathname === '/api/board') {
        const aiEvents = store.listAiEvents(project.id);
        const aiCounts = {};
        for (const e of aiEvents) {
          if (e.card_id) aiCounts[e.card_id] = (aiCounts[e.card_id] || 0) + 1;
        }
        const manifest = await readProjectManifest(projectPath);
        const cards = store.listCards(project.id).map(card => {
          const gdocId = card.file && manifest.files?.[card.file]?.gdocId;
          return gdocId
            ? { ...card, gdocUrl: `https://docs.google.com/document/d/${gdocId}/edit` }
            : card;
        });
        const driveFolderId = manifest.config?.driveFolderId;
        return send(200, {
          project: {
            name: project.name,
            path: project.path,
            driveFolderUrl: driveFolderId
              ? `https://drive.google.com/drive/folders/${driveFolderId}`
              : null
          },
          stages: STAGES,
          cards,
          ai: { total: aiEvents.length, byCard: aiCounts }
        });
      }

      const exportMatch = url.pathname.match(/^\/api\/export\/(epub|docx|pdf)$/);
      if (req.method === 'GET' && exportMatch) {
        const format = exportMatch[1];
        try {
          const filePath = await buildExport(projectPath, format, project.name);
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

      if (req.method === 'GET' && url.pathname === '/api/ai-events') {
        return send(200, { events: store.listAiEvents(project.id), purposes: AI_PURPOSES });
      }

      if (req.method === 'POST' && url.pathname === '/api/ai-events') {
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

      const aiMatch = url.pathname.match(/^\/api\/ai-events\/(\d+)$/);
      if (req.method === 'DELETE' && aiMatch) {
        const event = store.getAiEvent(Number(aiMatch[1]));
        if (!event || event.project_id !== project.id) {
          return send(404, { error: 'event not found' });
        }
        store.deleteAiEvent(event.id);
        return send(200, { deleted: true });
      }

      if (req.method === 'POST' && url.pathname === '/api/ai-ingest') {
        const result = await ingestClaudeCode(store, project.id, projectPath);
        return send(200, result);
      }

      if (req.method === 'POST' && url.pathname === '/api/cards') {
        const body = await readBody(req);
        const card = store.createCard(project.id, body);
        return send(201, card);
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

      if (req.method === 'POST' && url.pathname === '/api/import') {
        const contentDir = path.join(projectPath, 'content');
        let files;
        try {
          files = filterExcludedFiles(await getAllMarkdownFiles(contentDir));
        } catch {
          return send(400, { error: 'no content/ directory in this project' });
        }
        const linked = store.linkedFiles(project.id);
        const imported = [];
        for (const file of files) {
          const relative = path.relative(projectPath, file);
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

      return send(404, { error: 'not found' });
    } catch (error) {
      return send(400, { error: error.message });
    }
  });
}

/**
 * `draftsync serve` command: start the board for the current project
 *
 * @param {Object} options - CLI options
 * @param {string} [options.port='8787'] - Port to listen on
 * @returns {Promise<void>}
 */
export async function serveCommand(options = {}) {
  const port = Number(options.port || 8787);
  const store = openStore();
  const server = createKanbanServer({ store, projectPath: process.cwd() });

  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}`;
    console.log(chalk.blue.bold('\ndraftsync board\n'));
    console.log(chalk.green(`✓ Serving ${path.basename(process.cwd())} at ${url}`));
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
