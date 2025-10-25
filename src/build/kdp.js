/**
 * Kindle Direct Publishing (KDP) Integration
 *
 * Handles Kindle previewing and KPF generation for Amazon KDP.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import chalk from 'chalk';
import ora from 'ora';

const execAsync = promisify(exec);

/**
 * Check if Kindle Previewer is installed
 *
 * Checks for Kindle Previewer in common installation paths.
 *
 * @returns {Promise<string|null>} Path to Kindle Previewer executable or null
 */
async function findKindlePreviewer() {
  const possiblePaths = [
    '/Applications/Kindle Previewer 3.app/Contents/MacOS/Kindle Previewer 3',
    'C:\\Program Files\\Amazon\\Kindle Previewer 3\\Kindle Previewer 3.exe',
    'C:\\Program Files (x86)\\Amazon\\Kindle Previewer 3\\Kindle Previewer 3.exe'
  ];

  for (const path of possiblePaths) {
    try {
      await fs.access(path);
      return path;
    } catch {
      // Continue checking
    }
  }

  return null;
}

/**
 * Preview EPUB with Kindle Previewer
 *
 * Opens the EPUB in Kindle Previewer for testing Kindle compatibility.
 * Kindle Previewer will automatically convert the EPUB to Kindle format (.kpf).
 *
 * @param {string} epubPath - Path to EPUB file
 * @returns {Promise<void>}
 */
export async function previewKdp(epubPath) {
  console.log(chalk.blue.bold(`\nPreviewing with Kindle Previewer: ${epubPath}\n`));

  const spinner = ora();

  try {
    // Step 1: Check if EPUB exists
    spinner.start('Checking EPUB file');
    try {
      await fs.access(epubPath);
      spinner.succeed(`Found ${epubPath}`);
    } catch {
      spinner.fail(`File not found: ${epubPath}`);
      console.log(chalk.gray('\nRun "draftsync build:epub" to create an EPUB first'));
      return;
    }

    // Step 2: Find Kindle Previewer
    spinner.start('Looking for Kindle Previewer');
    const previewerPath = await findKindlePreviewer();

    if (!previewerPath) {
      spinner.warn('Kindle Previewer not found');
      console.log(chalk.yellow('\nKindle Previewer is not installed.'));
      console.log(chalk.gray('\nDownload Kindle Previewer 3:'));
      console.log(chalk.gray('  https://kdp.amazon.com/en_US/help/topic/G202131170'));
      console.log(chalk.gray('\nKindle Previewer allows you to:'));
      console.log(chalk.gray('  - Preview your book as it will appear on Kindle devices'));
      console.log(chalk.gray('  - Test different device types and orientations'));
      console.log(chalk.gray('  - Generate .kpf files for KDP upload'));
      console.log(chalk.gray('\nAlternatively, you can upload the EPUB directly to KDP.'));
      return;
    }

    spinner.succeed('Found Kindle Previewer');

    // Step 3: Launch Kindle Previewer
    spinner.start('Opening Kindle Previewer');

    try {
      // Open the EPUB in Kindle Previewer
      // The command varies by platform
      if (process.platform === 'darwin') {
        // macOS
        await execAsync(`open -a "Kindle Previewer 3" "${epubPath}"`);
      } else if (process.platform === 'win32') {
        // Windows
        await execAsync(`"${previewerPath}" "${epubPath}"`);
      } else {
        throw new Error('Unsupported platform for Kindle Previewer');
      }

      spinner.succeed('Opened Kindle Previewer');

      console.log(chalk.green.bold('\n✓ Kindle Previewer launched!\n'));
      console.log(chalk.gray('In Kindle Previewer:'));
      console.log(chalk.gray('  1. Review your book on different devices'));
      console.log(chalk.gray('  2. Check formatting and layout'));
      console.log(chalk.gray('  3. Export .kpf file if needed for KDP'));
      console.log(chalk.gray('\nNote: Kindle Previewer will convert your EPUB to Kindle format.'));
    } catch (error) {
      spinner.fail('Failed to open Kindle Previewer');
      throw error;
    }
  } catch (error) {
    console.error(chalk.red(`\nError: ${error.message}`));
  }
}

/**
 * Check EPUB compatibility for Kindle
 *
 * Provides guidance on Kindle-specific requirements and best practices.
 *
 * @param {string} epubPath - Path to EPUB file
 * @returns {Promise<void>}
 */
export async function checkKindleCompatibility(epubPath) {
  console.log(chalk.blue.bold(`\nChecking Kindle compatibility: ${epubPath}\n`));

  const spinner = ora();

  try {
    spinner.start('Checking file');
    await fs.access(epubPath);
    spinner.succeed(`Found ${epubPath}`);

    console.log(chalk.yellow('\nKindle Compatibility Checklist:\n'));
    console.log(chalk.gray('✓ EPUB 2 or EPUB 3 format (both supported)'));
    console.log(chalk.gray('✓ Images in JPEG, GIF, PNG, or BMP format'));
    console.log(chalk.gray('✓ Maximum file size: 650 MB'));
    console.log(chalk.gray('✓ Avoid complex CSS (Kindle has limited support)'));
    console.log(chalk.gray('✓ Use standard fonts or embed custom fonts'));
    console.log(chalk.gray('✓ Test on multiple device types in Kindle Previewer'));

    console.log(chalk.yellow('\nRecommended workflow:\n'));
    console.log(chalk.gray('1. Run "draftsync check:epub" to validate EPUB structure'));
    console.log(chalk.gray('2. Run "draftsync preview:kdp" to test in Kindle Previewer'));
    console.log(chalk.gray('3. Fix any issues reported by Kindle Previewer'));
    console.log(chalk.gray('4. Upload EPUB or .kpf to Amazon KDP'));

    console.log(chalk.gray('\nLearn more:'));
    console.log(chalk.gray('  https://kdp.amazon.com/en_US/help/topic/G200735480'));
  } catch (error) {
    spinner.fail('File not found');
    console.error(chalk.red(`\nError: ${error.message}`));
  }
}
