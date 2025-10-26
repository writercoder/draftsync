/**
 * Pandoc Integration
 *
 * Handles conversion between Markdown, DOCX, HTML, and EPUB formats using Pandoc.
 */

import { spawnSync } from 'child_process';
import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';

const execAsync = promisify(exec);

/**
 * Build Pandoc arguments for Markdown to DOCX conversion
 *
 * @param {string} mdPath - Path to Markdown file
 * @param {string} outDocx - Output DOCX path
 * @param {string} [refdoc] - Optional reference DOCX for styling
 * @returns {string[]} Pandoc arguments array
 */
export function buildMdToDocxArgs(mdPath, outDocx, refdoc = null) {
  const args = [mdPath, '-o', outDocx];
  if (refdoc) {
    args.push('--reference-doc', refdoc);
  }
  return args;
}

/**
 * Build Pandoc arguments for DOCX to Markdown conversion
 *
 * @param {string} docxPath - Path to DOCX file
 * @param {string} outMd - Output Markdown path
 * @returns {string[]} Pandoc arguments array
 */
export function buildDocxToMdArgs(docxPath, outMd) {
  return [docxPath, '-o', outMd];
}

/**
 * Run Pandoc with given arguments
 *
 * @param {string[]} args - Pandoc arguments
 * @returns {{status: number, stdout?: string, stderr?: string}} Result object
 */
export function runPandoc(args) {
  const result = spawnSync('pandoc', args, { stdio: 'inherit' });
  return {
    status: result.status ?? 1,
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString()
  };
}

/**
 * Convert Markdown to DOCX
 *
 * @param {string} mdPath - Path to Markdown file
 * @param {string} outDocx - Output DOCX path
 * @param {string} [refdoc] - Optional reference DOCX for styling
 * @returns {void}
 */
export function mdToDocx(mdPath, outDocx, refdoc = null) {
  const args = buildMdToDocxArgs(mdPath, outDocx, refdoc);
  const result = runPandoc(args);

  if (result.status !== 0) {
    throw new Error(`pandoc failed (md → docx) with status ${result.status}`);
  }
}

/**
 * Convert DOCX to Markdown
 *
 * @param {string} docxPath - Path to DOCX file
 * @param {string} outMd - Output Markdown path
 * @returns {void}
 */
export function docxToMd(docxPath, outMd) {
  const args = buildDocxToMdArgs(docxPath, outMd);
  const result = runPandoc(args);

  if (result.status !== 0) {
    throw new Error(`pandoc failed (docx → md) with status ${result.status}`);
  }
}

/**
 * Check if Pandoc is installed
 *
 * @returns {Promise<boolean>} True if Pandoc is available
 */
export async function checkPandocInstalled() {
  try {
    await execAsync('pandoc --version');
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Get Pandoc version
 *
 * @returns {Promise<string>} Pandoc version string
 */
export async function getPandocVersion() {
  const { stdout } = await execAsync('pandoc --version');
  const firstLine = stdout.split('\n')[0];
  return firstLine.replace('pandoc', '').trim();
}

/**
 * Convert Markdown to DOCX
 *
 * @param {string} mdPath - Path to Markdown file
 * @param {string} [refdocPath] - Optional reference DOCX for styling
 * @returns {Promise<string>} Path to generated DOCX file
 */
export async function convertMarkdownToDocx(mdPath, refdocPath = null) {
  console.log(chalk.gray(`  Converting ${mdPath} to DOCX...`));

  // Check if Pandoc is installed
  const isInstalled = await checkPandocInstalled();
  if (!isInstalled) {
    throw new Error('Pandoc is not installed. Install it from https://pandoc.org/installing.html');
  }

  // Generate output path
  const outputPath = path.join('dist', path.basename(mdPath, '.md') + '.docx');

  // Ensure dist directory exists
  await fs.mkdir('dist', { recursive: true });

  // Build Pandoc command
  let command = `pandoc "${mdPath}" -o "${outputPath}"`;

  if (refdocPath) {
    command += ` --reference-doc="${refdocPath}"`;
  }

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr && !stderr.includes('Warning')) {
      console.log(chalk.yellow(`  Pandoc warnings: ${stderr}`));
    }
    console.log(chalk.gray(`  ✓ Created ${outputPath}`));
    return outputPath;
  } catch (error) {
    throw new Error(`Pandoc conversion failed: ${error.message}`);
  }
}

/**
 * Convert DOCX to Markdown
 *
 * @param {string} docxPath - Path to DOCX file
 * @param {string} outputPath - Path to save Markdown file
 * @returns {Promise<string>} Path to generated Markdown file
 */
export async function convertDocxToMarkdown(docxPath, outputPath) {
  console.log(chalk.gray(`  Converting ${docxPath} to Markdown...`));

  // Check if Pandoc is installed
  const isInstalled = await checkPandocInstalled();
  if (!isInstalled) {
    throw new Error('Pandoc is not installed. Install it from https://pandoc.org/installing.html');
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Build Pandoc command
  const command = `pandoc "${docxPath}" -o "${outputPath}" --wrap=none --extract-media=.`;

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr && !stderr.includes('Warning')) {
      console.log(chalk.yellow(`  Pandoc warnings: ${stderr}`));
    }
    console.log(chalk.gray(`  ✓ Created ${outputPath}`));
    return outputPath;
  } catch (error) {
    throw new Error(`Pandoc conversion failed: ${error.message}`);
  }
}

/**
 * Convert Markdown to HTML
 *
 * @param {string} mdPath - Path to Markdown file
 * @param {string} outputPath - Path to save HTML file
 * @param {Object} [options] - Conversion options
 * @param {string} [options.template] - HTML template file
 * @param {string} [options.css] - CSS file to include
 * @param {boolean} [options.standalone=true] - Generate standalone HTML
 * @returns {Promise<string>} Path to generated HTML file
 */
export async function convertMarkdownToHtml(mdPath, outputPath, options = {}) {
  console.log(chalk.gray(`  Converting ${mdPath} to HTML...`));

  const { template = null, css = null, standalone = true } = options;

  // Check if Pandoc is installed
  const isInstalled = await checkPandocInstalled();
  if (!isInstalled) {
    throw new Error('Pandoc is not installed. Install it from https://pandoc.org/installing.html');
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Build Pandoc command
  let command = `pandoc "${mdPath}" -o "${outputPath}"`;

  if (standalone) {
    command += ' --standalone';
  }

  if (template) {
    command += ` --template="${template}"`;
  }

  if (css) {
    command += ` --css="${css}"`;
  }

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr && !stderr.includes('Warning')) {
      console.log(chalk.yellow(`  Pandoc warnings: ${stderr}`));
    }
    console.log(chalk.gray(`  ✓ Created ${outputPath}`));
    return outputPath;
  } catch (error) {
    throw new Error(`Pandoc conversion failed: ${error.message}`);
  }
}

/**
 * Convert Markdown files to EPUB
 *
 * @param {string[]} mdFiles - Array of Markdown file paths
 * @param {string} outputPath - Path to save EPUB file
 * @param {Object} [options] - EPUB generation options
 * @param {string} [options.metadata] - YAML metadata file
 * @param {string} [options.css] - CSS stylesheet file
 * @param {string} [options.cover] - Cover image file
 * @param {string} [options.tocDepth=3] - Table of contents depth
 * @returns {Promise<string>} Path to generated EPUB file
 */
export async function convertMarkdownToEpub(mdFiles, outputPath, options = {}) {
  console.log(chalk.gray(`  Converting ${mdFiles.length} files to EPUB...`));

  const { metadata = null, css = null, cover = null, tocDepth = 3 } = options;

  // Check if Pandoc is installed
  const isInstalled = await checkPandocInstalled();
  if (!isInstalled) {
    throw new Error('Pandoc is not installed. Install it from https://pandoc.org/installing.html');
  }

  // Ensure output directory exists
  const outputDir = path.dirname(outputPath);
  await fs.mkdir(outputDir, { recursive: true });

  // Build Pandoc command
  const inputFiles = mdFiles.map(f => `"${f}"`).join(' ');
  let command = `pandoc ${inputFiles} -o "${outputPath}" --toc --toc-depth=${tocDepth}`;

  if (metadata) {
    command += ` --metadata-file="${metadata}"`;
  }

  if (css) {
    command += ` --css="${css}"`;
  }

  if (cover) {
    command += ` --epub-cover-image="${cover}"`;
  }

  try {
    const { stdout, stderr } = await execAsync(command);
    if (stderr && !stderr.includes('Warning')) {
      console.log(chalk.yellow(`  Pandoc warnings: ${stderr}`));
    }
    console.log(chalk.gray(`  ✓ Created ${outputPath}`));
    return outputPath;
  } catch (error) {
    throw new Error(`Pandoc EPUB conversion failed: ${error.message}`);
  }
}

/**
 * Validate an EPUB file using epubcheck
 *
 * @param {string} epubPath - Path to EPUB file
 * @returns {Promise<{valid: boolean, errors: string[]}>} Validation result
 */
export async function validateEpub(epubPath) {
  console.log(chalk.gray(`  Validating ${epubPath}...`));

  try {
    const { stdout, stderr } = await execAsync(`epubcheck "${epubPath}"`);
    console.log(chalk.green('  ✓ EPUB is valid'));
    return { valid: true, errors: [] };
  } catch (error) {
    // epubcheck exits with non-zero on validation errors
    const errors = error.stderr ? error.stderr.split('\n').filter(Boolean) : [];
    return { valid: false, errors };
  }
}
