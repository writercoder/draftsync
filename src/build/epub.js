/**
 * EPUB Build System
 *
 * Builds and validates EPUB files from Markdown manuscripts.
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { convertMarkdownToEpub, validateEpub } from '../pandoc.js';

/**
 * Get all Markdown files from content directory
 *
 * @param {string} contentDir - Content directory path
 * @returns {Promise<string[]>} Array of Markdown file paths
 */
async function getMarkdownFiles(contentDir) {
  const files = await fs.readdir(contentDir);
  const mdFiles = files
    .filter(f => f.endsWith('.md'))
    .sort() // Sort alphabetically for consistent ordering
    .map(f => path.join(contentDir, f));

  return mdFiles;
}

/**
 * Build EPUB from Markdown files
 *
 * Combines all Markdown files in the content directory into a single EPUB.
 * Uses Pandoc for conversion and applies metadata, CSS, and cover image.
 *
 * @param {Object} options - Build options
 * @param {string} [options.output='dist/book.epub'] - Output file path
 * @param {string} [options.metadata='templates/metadata.yaml'] - Metadata YAML file
 * @param {string} [options.css='templates/epub.css'] - CSS stylesheet
 * @param {string} [options.cover] - Cover image file
 * @returns {Promise<void>}
 */
export async function buildEpub(options = {}) {
  const {
    output = 'dist/book.epub',
    metadata = 'templates/metadata.yaml',
    css = 'templates/epub.css',
    cover = null
  } = options;

  console.log(chalk.blue.bold('\nBuilding EPUB...\n'));

  const spinner = ora();

  try {
    // Step 1: Find all Markdown files
    spinner.start('Finding Markdown files');
    const contentDir = 'content';

    let mdFiles;
    try {
      mdFiles = await getMarkdownFiles(contentDir);
    } catch (error) {
      spinner.fail(`Content directory not found: ${contentDir}`);
      console.log(chalk.gray('\nRun "draftsync init" to create the project structure'));
      return;
    }

    if (mdFiles.length === 0) {
      spinner.fail('No Markdown files found in content/');
      console.log(chalk.gray('\nAdd .md files to content/ directory'));
      return;
    }

    spinner.succeed(`Found ${mdFiles.length} Markdown files`);
    mdFiles.forEach(f => console.log(chalk.gray(`  - ${path.basename(f)}`)));

    // Step 2: Check for metadata file
    spinner.start('Checking metadata');
    let metadataFile = null;
    try {
      await fs.access(metadata);
      metadataFile = metadata;
      spinner.succeed(`Using metadata: ${metadata}`);
    } catch {
      spinner.warn('No metadata file found (optional)');
      console.log(chalk.gray(`  Create ${metadata} to add title, author, etc.`));
    }

    // Step 3: Check for CSS file
    spinner.start('Checking CSS stylesheet');
    let cssFile = null;
    try {
      await fs.access(css);
      cssFile = css;
      spinner.succeed(`Using CSS: ${css}`);
    } catch {
      spinner.warn('No CSS file found (optional)');
      console.log(chalk.gray(`  Create ${css} to customize EPUB styling`));
    }

    // Step 4: Check for cover image
    if (cover) {
      spinner.start('Checking cover image');
      try {
        await fs.access(cover);
        spinner.succeed(`Using cover: ${cover}`);
      } catch {
        spinner.fail(`Cover image not found: ${cover}`);
        return;
      }
    }

    // Step 5: Convert to EPUB
    spinner.start('Converting to EPUB with Pandoc');
    await convertMarkdownToEpub(mdFiles, output, {
      metadata: metadataFile,
      css: cssFile,
      cover,
      tocDepth: 3
    });
    spinner.succeed(`Created EPUB: ${output}`);

    // Step 6: Get file size
    const stats = await fs.stat(output);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(chalk.gray(`  File size: ${sizeKB} KB`));

    console.log(chalk.green.bold('\n✓ EPUB build complete!\n'));
    console.log(chalk.gray('Next steps:'));
    console.log(chalk.gray(`  - Run "draftsync check:epub ${output}" to validate`));
    console.log(chalk.gray(`  - Run "draftsync preview:kdp ${output}" to preview for Kindle`));
  } catch (error) {
    spinner.fail('EPUB build failed');
    console.error(chalk.red(`\nError: ${error.message}`));

    if (error.message.includes('Pandoc')) {
      console.log(chalk.gray('\nMake sure Pandoc is installed:'));
      console.log(chalk.gray('  macOS:   brew install pandoc'));
      console.log(chalk.gray('  Windows: choco install pandoc'));
      console.log(chalk.gray('  Linux:   apt install pandoc'));
      console.log(chalk.gray('  Or visit: https://pandoc.org/installing.html'));
    }
  }
}

/**
 * Validate EPUB file
 *
 * Uses epubcheck to validate the EPUB against the specification.
 *
 * @param {string} epubPath - Path to EPUB file to validate
 * @returns {Promise<void>}
 */
export async function checkEpub(epubPath) {
  console.log(chalk.blue.bold(`\nValidating EPUB: ${epubPath}\n`));

  const spinner = ora();

  try {
    // Check if file exists
    spinner.start('Checking file');
    try {
      await fs.access(epubPath);
      spinner.succeed(`Found ${epubPath}`);
    } catch {
      spinner.fail(`File not found: ${epubPath}`);
      return;
    }

    // Validate with epubcheck
    spinner.start('Running epubcheck');

    try {
      const result = await validateEpub(epubPath);

      if (result.valid) {
        spinner.succeed('EPUB is valid');
        console.log(chalk.green.bold('\n✓ Validation passed!\n'));
      } else {
        spinner.fail('EPUB validation failed');
        console.log(chalk.red.bold('\nValidation errors:\n'));
        result.errors.forEach(err => console.log(chalk.red(`  ${err}`)));
        console.log();
      }
    } catch (error) {
      if (error.message.includes('epubcheck') && error.code === 'ENOENT') {
        spinner.warn('epubcheck not installed');
        console.log(chalk.yellow('\nepubcheck is not installed.'));
        console.log(chalk.gray('\nInstall epubcheck to validate EPUB files:'));
        console.log(chalk.gray('  Download from: https://github.com/w3c/epubcheck/releases'));
        console.log(chalk.gray('  Or install via: brew install epubcheck (macOS)'));
        console.log(chalk.gray('\nFor now, try opening the EPUB in a reader to test it.'));
      } else {
        throw error;
      }
    }
  } catch (error) {
    spinner.fail('Validation failed');
    console.error(chalk.red(`\nError: ${error.message}`));
  }
}
