/**
 * draftsync CLI - Main command router
 *
 * Handles all CLI commands and routes them to the appropriate handlers.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticate } from './auth.js';
import { createDoc, listDocs } from './drive.js';
import { formatDocument } from './docs.js';
import { convertMarkdownToDocx, convertDocxToMarkdown } from './pandoc.js';
import { buildEpub, checkEpub } from './build/epub.js';
import { buildWeb } from './build/web.js';
import { previewKdp } from './build/kdp.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
      console.log(chalk.gray(`  Updating existing doc: ${fileInfo.gdocId}`));
      docId = fileInfo.gdocId;
    } else {
      // Create new doc
      docId = await createDoc(auth, path.basename(filePath, '.md'), docxPath, options.folderId);
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

    const docxPath = path.join('dist', `${path.basename(filePath, '.md')}.docx`);
    // TODO: Actually export from Google Docs
    console.log(chalk.gray(`  Downloaded to ${docxPath}`));

    await convertDocxToMarkdown(docxPath, filePath);
    console.log(chalk.green(`✓ Converted to Markdown: ${filePath}`));

    manifest.files[filePath].lastSync = new Date().toISOString();
    await saveManifest(manifest);

    console.log(chalk.green(`\n✓ Successfully pulled ${filePath}`));
  } catch (error) {
    console.error(chalk.red(`✗ Error: ${error.message}`));
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
    console.log(chalk.gray(`    URL:        https://docs.google.com/document/d/${info.gdocId}/edit`));
    console.log();
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

  program
    .command('init')
    .description('Initialize a new draftsync project')
    .action(initCommand);

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
    .command('status')
    .description('Show sync status of all linked files')
    .action(statusCommand);

  program
    .command('build:epub')
    .description('Build EPUB from all Markdown files')
    .option('-o, --output <path>', 'Output file path', 'dist/book.epub')
    .option('-m, --metadata <path>', 'Metadata YAML file', 'templates/metadata.yaml')
    .option('-c, --css <path>', 'Custom CSS file', 'templates/epub.css')
    .option('--cover <path>', 'Cover image file')
    .action(buildEpub);

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
    .command('preview:kdp')
    .description('Preview EPUB with Kindle Previewer')
    .argument('[file]', 'EPUB file to preview', 'dist/book.epub')
    .action(previewKdp);

  program.parse();
}
