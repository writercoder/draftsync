/**
 * DOCX Build System
 *
 * Builds a single Word document from Markdown manuscripts — for reviewers
 * who want Word rather than an EPUB or a Google Doc.
 */

import { promises as fs } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import { convertMarkdownFilesToDocx } from '../pandoc.js';
import { getFilesToBuild } from '../file-filter.js';

/**
 * Build a combined DOCX from Markdown files
 *
 * Uses the same file selection as build:epub (chapters list, default
 * exclusions, include/exclude patterns).
 *
 * @param {Object} options - Build options
 * @param {string} [options.output='dist/manuscript.docx'] - Output file path
 * @param {string} [options.metadata='templates/metadata.yaml'] - Metadata YAML file
 * @param {string} [options.refdoc] - Reference DOCX for styling
 * @param {string[]} [options.include] - Include-only patterns
 * @param {string[]} [options.exclude] - Additional exclude patterns
 * @returns {Promise<void>}
 */
export async function buildDocx(options = {}) {
  const { output = 'dist/manuscript.docx', metadata = 'templates/metadata.yaml' } = options;

  console.log(chalk.blue.bold('\nBuilding DOCX...\n'));

  const spinner = ora();

  try {
    spinner.start('Finding Markdown files');
    const contentDir = 'content';

    let mdFiles;
    try {
      // An explicit ordered list (e.g. from an edition) wins over discovery
      mdFiles = options.files?.length
        ? options.files
        : await getFilesToBuild({
            contentDir,
            metadataPath: metadata,
            includePatterns: options.include,
            excludePatterns: options.exclude
          });
    } catch {
      spinner.fail(`Content directory not found: ${contentDir}`);
      console.log(chalk.gray('\nRun "draftsync init" to create the project structure'));
      return;
    }

    if (mdFiles.length === 0) {
      spinner.fail('No Markdown files found in content/');
      console.log(chalk.gray('\nAdd .md files to content/ directory'));
      console.log(chalk.gray('Or check your chapters list in metadata.yaml'));
      return;
    }

    spinner.succeed(`Found ${mdFiles.length} Markdown file(s) for DOCX`);
    mdFiles.forEach(f => console.log(chalk.gray(`  - ${f}`)));

    // Optional inputs: metadata and reference doc
    let metadataFile = null;
    try {
      await fs.access(metadata);
      metadataFile = metadata;
    } catch {
      // optional
    }

    if (options.refdoc) {
      spinner.start('Checking reference document');
      try {
        await fs.access(options.refdoc);
        spinner.succeed(`Using reference doc: ${options.refdoc}`);
      } catch {
        spinner.fail(`Reference document not found: ${options.refdoc}`);
        return;
      }
    }

    spinner.start('Converting to DOCX with Pandoc');
    await convertMarkdownFilesToDocx(mdFiles, output, {
      refdoc: options.refdoc,
      metadata: metadataFile
    });
    spinner.succeed(`Created DOCX: ${output}`);

    const stats = await fs.stat(output);
    console.log(chalk.gray(`  File size: ${(stats.size / 1024).toFixed(2)} KB`));
    console.log(chalk.green.bold('\n✓ DOCX build complete!\n'));
  } catch (error) {
    spinner.fail('DOCX build failed');
    console.error(chalk.red(`\nError: ${error.message}`));

    if (error.message.includes('Pandoc')) {
      console.log(chalk.gray('\nMake sure Pandoc is installed:'));
      console.log(chalk.gray('  macOS:   brew install pandoc'));
      console.log(chalk.gray('  Or visit: https://pandoc.org/installing.html'));
    }
  }
}
