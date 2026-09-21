/**
 * draftsync CLI - Main command router
 *
 * Handles all CLI commands and routes them to the appropriate handlers.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import { authenticate, revokeToken, SCOPES } from './auth.js';
import { createDoc, updateDoc, exportDocAsDocx, ensureProjectFolder } from './drive.js';
import { formatDocument } from './docs.js';
import { convertMarkdownToDocx, convertDocxToMarkdown } from './pandoc.js';
import { buildEpub, checkEpub } from './build/epub.js';
import { buildDocx } from './build/docx.js';
import { serveCommand } from './serve.js';
import { openStore } from './store.js';
import { execute, listOperations } from './core/registry.js';
import './core/operations.js';
import { AI_PURPOSES, providerFromUrl, ingestClaudeCode, buildAiReport } from './ai-audit.js';
import { buildWeb } from './build/web.js';
import { previewKdp } from './build/kdp.js';

const MANIFEST_FILE = '.draftsync.json';

/**
 * Load the draftsync manifest file
 */
async function loadManifest() {
  try {
    const data = await fs.readFile(MANIFEST_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { files: {} };
    }
    throw error;
  }
}

/**
 * Save the draftsync manifest file
 */
async function saveManifest(manifest) {
  await fs.writeFile(MANIFEST_FILE, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Initialize a new draftsync project
 */
async function initCommand() {
  console.log(chalk.blue('Initializing draftsync project...'));

  const manifest = {
    version: '1.0',
    files: {},
    config: {
      contentDir: 'content',
      distDir: 'dist',
      templatesDir: 'templates'
    }
  };

  await saveManifest(manifest);

  // Create directories if they don't exist
  const dirs = ['content', 'dist', 'templates'];
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      console.log(chalk.green(`✓ Created ${dir}/`));
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }

  console.log(chalk.green('\n✓ Initialized draftsync project'));
  console.log(chalk.gray('\nNext steps:'));
  console.log(chalk.gray('  1. Place your Markdown files in content/'));
  console.log(chalk.gray('  2. Run "draftsync push <file.md>" to sync to Google Docs'));
  console.log(chalk.gray('  3. Run "draftsync build:epub" to generate an EPUB'));
}

/**
 * Link a local file to a Google Doc ID
 */
async function linkCommand(filePath, gdocId) {
  console.log(chalk.blue(`Linking ${filePath} to Google Doc ${gdocId}...`));

  const manifest = await loadManifest();
  manifest.files[filePath] = {
    gdocId,
    lastSync: new Date().toISOString()
  };

  await saveManifest(manifest);
  console.log(chalk.green('✓ File linked successfully'));
}

/**
 * Push a Markdown file to Google Docs
 */
async function pushCommand(filePath, options) {
  console.log(chalk.blue(`Pushing ${filePath} to Google Docs...`));

  // Dry-run mode: just print what would happen
  if (options.dryRun) {
    console.log(chalk.yellow('[DRY RUN] Would perform the following steps:'));
    console.log('  1. Read Markdown file');
    console.log('  2. Would convert MD → DOCX using Pandoc');
    if (options.refdoc) {
      console.log(`  3. Would apply reference document: ${options.refdoc}`);
    }
    console.log('  4. Would authenticate with Google API');
    if (options.folderId) {
      console.log(`  5. Would create Google Doc in folder: ${options.folderId}`);
    } else {
      console.log('  5. Would create Google Doc in root');
    }
    if (options.format) {
      console.log('  6. Would apply formatting (double-space, margins, headers)');
    }
    return;
  }

  // Simulate the workflow
  try {
    const auth = await authenticate();
    console.log(chalk.green('✓ Authenticated with Google'));

    const docxPath = await convertMarkdownToDocx(filePath, options.refdoc);
    console.log(chalk.green(`✓ Converted to DOCX: ${docxPath}`));

    const manifest = await loadManifest();
    const fileInfo = manifest.files[filePath];

    let docId;
    if (fileInfo && fileInfo.gdocId) {
      // Update existing doc
      docId = fileInfo.gdocId;
      await updateDoc(auth, docId, docxPath);
      console.log(chalk.green(`✓ Updated existing Google Doc: ${docId}`));

      manifest.files[filePath].lastSync = new Date().toISOString();
      await saveManifest(manifest);
    } else {
      // Resolve the Drive folder: --folder-id flag, then configured folder,
      // then find-or-create the nested draftsync/<project-name>/ folder
      let folderId = options.folderId || manifest.config?.driveFolderId;
      if (!folderId) {
        const projectName = path.basename(process.cwd());
        const folder = await ensureProjectFolder(auth, projectName);
        folderId = folder.id;
        console.log(
          folder.created
            ? chalk.green(`✓ Created Drive folder draftsync/${projectName} (${folderId})`)
            : chalk.gray(`  Using Drive folder draftsync/${projectName} (${folderId})`)
        );
        manifest.config = { ...manifest.config, driveFolderId: folderId };
      }

      // Create new doc
      docId = await createDoc(auth, path.basename(filePath, '.md'), docxPath, folderId);
      console.log(chalk.green(`✓ Created new Google Doc: ${docId}`));

      // Update manifest
      manifest.files[filePath] = {
        gdocId: docId,
        lastSync: new Date().toISOString()
      };
      await saveManifest(manifest);
    }

    if (options.format) {
      await formatDocument(auth, docId);
      console.log(chalk.green('✓ Applied formatting'));
    }

    console.log(chalk.green(`\n✓ Successfully pushed ${filePath}`));
    console.log(chalk.gray(`  View at: https://docs.google.com/document/d/${docId}/edit`));
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    if (error.message.includes('invalid_grant')) {
      console.log(chalk.gray('  Your Google token may have expired — run "draftsync login"'));
    }
    process.exitCode = 1;
  }
}

/**
 * Pull a Google Doc to Markdown
 */
async function pullCommand(filePath, options = {}) {
  console.log(chalk.blue(`Pulling ${filePath} from Google Docs...`));

  const manifest = await loadManifest();
  const fileInfo = manifest.files[filePath];

  if (!fileInfo || !fileInfo.gdocId) {
    console.error(chalk.red(`✗ No Google Doc linked to ${filePath}`));
    console.log(chalk.gray('  Run "draftsync link <file> <gdoc-id>" first'));
    return;
  }

  // Dry-run mode: just print what would happen
  if (options.dryRun) {
    console.log(chalk.yellow('[DRY RUN] Would perform the following steps:'));
    console.log('  1. Would authenticate with Google API');
    console.log(`  2. Would export Google Doc ${fileInfo.gdocId} as DOCX`);
    console.log('  3. Would convert DOCX → MD using Pandoc');
    console.log(`  4. Would save to ${filePath}`);
    return;
  }

  try {
    const auth = await authenticate();
    console.log(chalk.green('✓ Authenticated with Google'));

    await fs.mkdir('dist', { recursive: true });
    const docxPath = path.join('dist', `${path.basename(filePath, '.md')}.docx`);
    await exportDocAsDocx(auth, fileInfo.gdocId, docxPath);
    console.log(chalk.green(`✓ Exported Google Doc to ${docxPath}`));

    await convertDocxToMarkdown(docxPath, filePath);
    console.log(chalk.green(`✓ Converted to Markdown: ${filePath}`));

    manifest.files[filePath].lastSync = new Date().toISOString();
    await saveManifest(manifest);

    console.log(chalk.green(`\n✓ Successfully pulled ${filePath}`));
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
    if (error.message.includes('invalid_grant')) {
      console.log(chalk.gray('  Your Google token may have expired — run "draftsync login"'));
    }
    process.exitCode = 1;
  }
}

/**
 * Run the interactive Google login flow
 */
async function loginCommand() {
  try {
    await authenticate({ forceLogin: true });
    console.log(chalk.green('\n✓ Logged in to Google'));
    console.log(chalk.gray('  Granted scopes:'));
    SCOPES.forEach(s => console.log(chalk.gray(`    - ${s}`)));
    console.log(chalk.gray('  Token cached in .token.json'));
  } catch (error) {
    console.error(chalk.red(`✗ Login failed: ${error.message}`));
    process.exitCode = 1;
  }
}

/**
 * Revoke Google access and delete the cached token
 */
async function logoutCommand() {
  try {
    const { hadToken, revoked } = await revokeToken();
    if (!hadToken) {
      console.log(chalk.gray('Not logged in — no token to revoke.'));
      return;
    }
    if (revoked) {
      console.log(chalk.green('✓ Token revoked with Google and deleted locally'));
    } else {
      console.log(chalk.yellow('✓ Local token deleted (Google revocation failed or not needed)'));
    }
  } catch (error) {
    console.error(chalk.red(`✗ Logout failed: ${error.message}`));
    process.exitCode = 1;
  }
}

/**
 * Show sync status of all files
 */
async function statusCommand() {
  console.log(chalk.blue('draftsync status\n'));

  const manifest = await loadManifest();
  const files = Object.entries(manifest.files);

  if (files.length === 0) {
    console.log(chalk.gray('No files linked yet.'));
    console.log(chalk.gray('Run "draftsync link <file> <gdoc-id>" to link files.'));
    return;
  }

  console.log(chalk.bold('Linked files:\n'));
  for (const [filePath, info] of files) {
    console.log(chalk.cyan(`  ${filePath}`));
    console.log(chalk.gray(`    Google Doc: ${info.gdocId}`));
    console.log(chalk.gray(`    Last sync:  ${new Date(info.lastSync).toLocaleString()}`));
    console.log(
      chalk.gray(`    URL:        https://docs.google.com/document/d/${info.gdocId}/edit`)
    );
    console.log();
  }
}

/**
 * Resolve an edition name (for the cwd project) to its ordered file list
 *
 * @param {string} editionName - Edition name as shown on the board
 * @returns {Promise<string[]>} Ordered relative file paths
 */
async function resolveEditionFiles(editionName) {
  const store = openStore();
  try {
    const project = store.getOrCreateProject(process.cwd());
    const edition = store.findEdition(project.id, editionName);
    if (!edition) {
      const names = store.listEditions(project.id).map(e => e.name);
      throw new Error(
        `no edition named "${editionName}"` +
          (names.length ? `. Available: ${names.join(', ')}` : ' (none defined yet)')
      );
    }
    const chapters = store.listEditionChapters(edition.id);
    const skipped = chapters.filter(c => !c.file);
    if (skipped.length > 0) {
      console.warn(
        chalk.yellow(
          `Warning: skipping ${skipped.length} chapter(s) with no linked file: ` +
            skipped.map(c => c.title).join(', ')
        )
      );
    }
    const files = chapters.filter(c => c.file).map(c => c.file);
    if (files.length === 0) {
      throw new Error(`edition "${editionName}" has no chapters with linked files`);
    }
    return files;
  } finally {
    store.close();
  }
}

/**
 * Wrap a build action so --edition resolves to an explicit file list
 *
 * @param {Function} build - Build function accepting options
 * @returns {Function} Commander action
 */
function withEdition(build) {
  return async options => {
    if (options.edition) {
      try {
        options.files = await resolveEditionFiles(options.edition);
      } catch (error) {
        console.error(chalk.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
    }
    return build(options);
  };
}

/**
 * Log an AI usage event against this project
 */
async function aiLogCommand(options) {
  const store = openStore();
  try {
    const project = store.getOrCreateProject(process.cwd());
    const provider = options.provider || (options.url && providerFromUrl(options.url));
    if (!provider) {
      console.error(chalk.red('✗ Provide --provider, or a --url from claude.ai / chatgpt.com'));
      process.exitCode = 1;
      return;
    }
    const purpose = options.purpose || 'other';
    if (!AI_PURPOSES.includes(purpose)) {
      console.error(chalk.red(`✗ Unknown purpose "${purpose}". One of: ${AI_PURPOSES.join(', ')}`));
      process.exitCode = 1;
      return;
    }
    if (purpose === 'prose-suggestion' && !options.justification) {
      console.error(
        chalk.red('✗ prose-suggestion events require --justification (project AI policy)')
      );
      process.exitCode = 1;
      return;
    }
    const { event } = store.upsertAiEvent(project.id, {
      sessionKey: options.url || `manual:${Date.now()}`,
      provider,
      source: options.url ? 'chat-link' : 'manual',
      url: options.url || null,
      model: options.model || null,
      file: options.file || null,
      purpose,
      justification: options.justification || ''
    });
    console.log(chalk.green(`✓ Logged AI event #${event.id} (${provider}, ${purpose})`));
  } finally {
    store.close();
  }
}

/**
 * Ingest local Claude Code transcripts into the AI ledger
 */
async function aiIngestCommand() {
  const store = openStore();
  try {
    const project = store.getOrCreateProject(process.cwd());
    const result = await ingestClaudeCode(store, project.id, process.cwd());
    if (result.found === 0) {
      console.log(chalk.gray('No Claude Code transcripts found for this project.'));
      return;
    }
    console.log(
      chalk.green(
        `✓ Ingested ${result.found} Claude Code session(s): ${result.created} new, ${result.updated} refreshed`
      )
    );
    console.log(
      chalk.gray('  Sessions default to purpose "tooling" — reclassify any that touched prose.')
    );
  } finally {
    store.close();
  }
}

/**
 * Print (or write) the AI disclosure report
 */
async function aiReportCommand(options) {
  const store = openStore();
  try {
    const project = store.getOrCreateProject(process.cwd());
    const report = buildAiReport(store, project);
    if (options.output) {
      await fs.writeFile(options.output, report, 'utf8');
      console.log(chalk.green(`✓ Wrote AI disclosure report to ${options.output}`));
    } else {
      console.log(report);
    }
  } finally {
    store.close();
  }
}

/**
 * Run any registry operation from the CLI: draftsync op <name> [json]
 */
async function opCommand(name, json, options) {
  if (options.list || !name) {
    console.log(chalk.blue.bold('\nOperations\n'));
    for (const op of listOperations()) {
      console.log(`  ${chalk.cyan(op.name.padEnd(32))} ${chalk.gray(op.description)}`);
    }
    console.log(chalk.gray('\nRun: draftsync op <name> \'{"project_id": 1, ...}\''));
    return;
  }
  let input = {};
  if (json) {
    try {
      input = JSON.parse(json);
    } catch {
      console.error(chalk.red('✗ Input must be valid JSON'));
      process.exitCode = 1;
      return;
    }
  }
  const store = openStore();
  try {
    const result = await execute(name, { store }, input);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(chalk.red(`✗ ${error.message}`));
    process.exitCode = 1;
  } finally {
    store.close();
  }
}

/**
 * Main CLI entry point
 */
export function run() {
  const program = new Command();

  program
    .name('draftsync')
    .description('Sync Markdown manuscripts with Google Docs and export to EPUB, Kindle, and web')
    .version('0.1.0');

  program.command('init').description('Initialize a new draftsync project').action(initCommand);

  program
    .command('link <file> <gdoc-id>')
    .description('Link a local Markdown file to a Google Doc ID')
    .action(linkCommand);

  program
    .command('push <file>')
    .description('Push a Markdown file to Google Docs')
    .option('-f, --folder-id <id>', 'Google Drive folder ID to create doc in')
    .option('-r, --refdoc <path>', 'Reference .docx for styling')
    .option('--format', 'Apply manuscript formatting (double-space, margins, headers)')
    .option('--dry-run', 'Show what would be done without executing')
    .action(pushCommand);

  program
    .command('pull <file>')
    .description('Pull a Google Doc to Markdown')
    .option('--dry-run', 'Show what would be done without executing')
    .action(pullCommand);

  program
    .command('login')
    .description('Authorize draftsync with your Google account')
    .action(loginCommand);

  program
    .command('logout')
    .description('Revoke Google access and delete the cached token')
    .action(logoutCommand);

  program
    .command('status')
    .description('Show sync status of all linked files')
    .action(statusCommand);

  program
    .command('build:epub')
    .description('Build EPUB from Markdown files')
    .option('-o, --output <path>', 'Output file path', 'dist/book.epub')
    .option('-m, --metadata <path>', 'Metadata YAML file', 'templates/metadata.yaml')
    .option('-c, --css <path>', 'Custom CSS file', 'templates/epub.css')
    .option('--cover <path>', 'Cover image file')
    .option(
      '--include <patterns...>',
      'Include only files matching these patterns (e.g., "chapter-*.md")'
    )
    .option('--exclude <patterns...>', 'Exclude files matching these patterns (e.g., "*.draft.md")')
    .option('-e, --edition <name>', 'Build a specific edition (defined on the board)')
    .action(withEdition(buildEpub));

  program
    .command('build:docx')
    .description('Build a single Word document from Markdown files')
    .option('-o, --output <path>', 'Output file path', 'dist/manuscript.docx')
    .option('-m, --metadata <path>', 'Metadata YAML file', 'templates/metadata.yaml')
    .option('-r, --refdoc <path>', 'Reference .docx for styling')
    .option('--include <patterns...>', 'Include only files matching these patterns')
    .option('--exclude <patterns...>', 'Exclude files matching these patterns')
    .option('-e, --edition <name>', 'Build a specific edition (defined on the board)')
    .action(withEdition(buildDocx));

  program
    .command('check:epub')
    .description('Validate EPUB file')
    .argument('<file>', 'EPUB file to validate')
    .action(checkEpub);

  program
    .command('build:web')
    .description('Build static HTML from Markdown files')
    .option('-o, --output <dir>', 'Output directory', 'dist/web')
    .action(buildWeb);

  program
    .command('op')
    .description('Run any draftsync operation (the full API, from the CLI)')
    .argument('[name]', 'Operation name, e.g. chapter.create')
    .argument('[json]', 'JSON input for the operation')
    .option('-l, --list', 'List all operations')
    .action(opCommand);

  program
    .command('serve')
    .description('Serve the draftsync web app (all projects) locally')
    .option('-p, --port <port>', 'Port to listen on', '8787')
    .action(serveCommand);

  program
    .command('ai:log')
    .description('Log an AI usage event against this project')
    .option('-u, --url <url>', 'Chat session URL (claude.ai or chatgpt.com)')
    .option('--provider <name>', 'Provider (anthropic, openai) when no URL is given')
    .option('--model <name>', 'Model used')
    .option('--purpose <purpose>', `One of: ${AI_PURPOSES.join(', ')}`, 'other')
    .option('-j, --justification <text>', 'Why/how the output was used (required for prose)')
    .option('-f, --file <path>', 'Content file the usage relates to')
    .action(aiLogCommand);

  program
    .command('ai:ingest')
    .description('Ingest local Claude Code transcripts into the AI ledger')
    .action(aiIngestCommand);

  program
    .command('ai:report')
    .description('Generate the AI disclosure report for this project')
    .option('-o, --output <path>', 'Write to a file instead of stdout')
    .action(aiReportCommand);

  program
    .command('preview:kdp')
    .description('Preview EPUB with Kindle Previewer')
    .argument('[file]', 'EPUB file to preview', 'dist/book.epub')
    .action(previewKdp);

  program.parse();
}
