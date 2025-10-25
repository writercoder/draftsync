/**
 * Web HTML Build System
 *
 * Converts Markdown files to static HTML for web publishing.
 */

import { promises as fs } from 'fs';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { convertMarkdownToHtml } from '../pandoc.js';

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
    .sort()
    .map(f => path.join(contentDir, f));

  return mdFiles;
}

/**
 * Build static HTML from Markdown files
 *
 * Converts each Markdown file to a standalone HTML file.
 * Optionally applies a template and CSS stylesheet.
 *
 * @param {Object} options - Build options
 * @param {string} [options.output='dist/web'] - Output directory
 * @returns {Promise<void>}
 */
export async function buildWeb(options = {}) {
  const { output = 'dist/web' } = options;

  console.log(chalk.blue.bold('\nBuilding web HTML...\n'));

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

    // Step 2: Create output directory
    spinner.start('Creating output directory');
    await fs.mkdir(output, { recursive: true });
    spinner.succeed(`Created ${output}/`);

    // Step 3: Convert each file
    const convertedFiles = [];

    for (const mdFile of mdFiles) {
      const basename = path.basename(mdFile, '.md');
      const htmlFile = path.join(output, `${basename}.html`);

      spinner.start(`Converting ${path.basename(mdFile)}`);

      await convertMarkdownToHtml(mdFile, htmlFile, {
        standalone: true,
        css: null // TODO: Add CSS support
      });

      convertedFiles.push(htmlFile);
      spinner.succeed(`Created ${path.basename(htmlFile)}`);
    }

    // Step 4: Create index page
    spinner.start('Creating index page');
    const indexContent = generateIndexHtml(convertedFiles);
    const indexPath = path.join(output, 'index.html');
    await fs.writeFile(indexPath, indexContent, 'utf8');
    spinner.succeed('Created index.html');

    console.log(chalk.green.bold('\n✓ Web build complete!\n'));
    console.log(chalk.gray(`Output directory: ${output}/`));
    console.log(chalk.gray(`Open ${indexPath} in a browser to view`));
  } catch (error) {
    spinner.fail('Web build failed');
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
 * Generate an index HTML page linking to all converted files
 *
 * @param {string[]} htmlFiles - Array of HTML file paths
 * @returns {string} HTML content
 */
function generateIndexHtml(htmlFiles) {
  const fileLinks = htmlFiles
    .map(f => {
      const basename = path.basename(f);
      const title = path.basename(f, '.html');
      return `    <li><a href="${basename}">${title}</a></li>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Manuscript Index</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #333;
    }
    h1 {
      color: #2c3e50;
      border-bottom: 2px solid #3498db;
      padding-bottom: 0.5rem;
    }
    ul {
      list-style: none;
      padding: 0;
    }
    li {
      margin: 0.75rem 0;
    }
    a {
      color: #3498db;
      text-decoration: none;
      font-size: 1.1rem;
    }
    a:hover {
      text-decoration: underline;
    }
    .footer {
      margin-top: 3rem;
      padding-top: 1rem;
      border-top: 1px solid #eee;
      color: #777;
      font-size: 0.9rem;
    }
  </style>
</head>
<body>
  <h1>Manuscript</h1>
  <ul>
${fileLinks}
  </ul>
  <div class="footer">
    Generated with <a href="https://github.com/yourusername/draftsync" target="_blank">draftsync</a>
  </div>
</body>
</html>`;
}
