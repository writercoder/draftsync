/**
 * Integration tests for Pandoc
 *
 * Tests actual Pandoc conversions if Pandoc is installed.
 * Skips gracefully if Pandoc is not available.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';
import { mdToDocx, docxToMd } from '../src/pandoc.js';

/**
 * Check if Pandoc is installed
 *
 * @returns {boolean} True if Pandoc is available
 */
function hasPandoc() {
  try {
    execSync('pandoc --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('Pandoc Integration Tests', () => {
  const pandocAvailable = hasPandoc();
  let tempDir;

  beforeEach(() => {
    if (pandocAvailable) {
      tempDir = mkdtempSync(join(tmpdir(), 'draftsync-integration-'));
    }
  });

  afterEach(() => {
    if (pandocAvailable && tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  if (!pandocAvailable) {
    it.skip('pandoc not installed; skipping integration test', () => {
      // This test will be skipped with a clear message
    });
  } else {
    describe('Markdown to DOCX to Markdown round-trip', () => {
      it('should convert ch1.md to DOCX and back to Markdown', async () => {
        const sourceMd = join(process.cwd(), 'fixtures/content/ch1.md');
        const outputDocx = join(tempDir, 'out.docx');
        const backMd = join(tempDir, 'back.md');

        // Read original content
        const originalContent = await fs.readFile(sourceMd, 'utf8');

        // Convert MD → DOCX
        mdToDocx(sourceMd, outputDocx);

        // Verify DOCX was created
        const docxExists = await fs
          .access(outputDocx)
          .then(() => true)
          .catch(() => false);
        expect(docxExists).toBe(true);

        // Convert DOCX → MD
        docxToMd(outputDocx, backMd);

        // Verify MD was created
        const mdExists = await fs
          .access(backMd)
          .then(() => true)
          .catch(() => false);
        expect(mdExists).toBe(true);

        // Read converted content
        const convertedContent = await fs.readFile(backMd, 'utf8');

        // Check that the H1 text is preserved (loose match)
        expect(convertedContent).toContain('Chapter One');
        expect(convertedContent).toContain('Beginning');
      });

      it('should preserve heading structure', async () => {
        const sourceMd = join(process.cwd(), 'fixtures/content/ch1.md');
        const outputDocx = join(tempDir, 'out.docx');
        const backMd = join(tempDir, 'back.md');

        mdToDocx(sourceMd, outputDocx);
        docxToMd(outputDocx, backMd);

        const convertedContent = await fs.readFile(backMd, 'utf8');

        // Should contain both H1 and H2 headings
        expect(convertedContent).toMatch(/^#\s/m); // H1
        expect(convertedContent).toMatch(/^##\s/m); // H2
      });

      it('should preserve paragraph content', async () => {
        const sourceMd = join(process.cwd(), 'fixtures/content/ch1.md');
        const outputDocx = join(tempDir, 'out.docx');
        const backMd = join(tempDir, 'back.md');

        mdToDocx(sourceMd, outputDocx);
        docxToMd(outputDocx, backMd);

        const convertedContent = await fs.readFile(backMd, 'utf8');

        // Check for key phrases from the original
        expect(convertedContent).toContain('opening chapter');
        expect(convertedContent).toContain('main characters');
      });

      it('should handle ch2.md conversion', async () => {
        const sourceMd = join(process.cwd(), 'fixtures/content/ch2.md');
        const outputDocx = join(tempDir, 'ch2.docx');
        const backMd = join(tempDir, 'ch2-back.md');

        mdToDocx(sourceMd, outputDocx);
        docxToMd(outputDocx, backMd);

        const convertedContent = await fs.readFile(backMd, 'utf8');

        expect(convertedContent).toContain('Chapter Two');
        expect(convertedContent).toContain('Journey');
      });

      it('should create files with non-zero size', async () => {
        const sourceMd = join(process.cwd(), 'fixtures/content/ch1.md');
        const outputDocx = join(tempDir, 'out.docx');

        mdToDocx(sourceMd, outputDocx);

        const stats = await fs.stat(outputDocx);
        expect(stats.size).toBeGreaterThan(0);
      });
    });

    describe('error handling', () => {
      it('should throw error for non-existent source file', () => {
        const nonExistentMd = join(tempDir, 'does-not-exist.md');
        const outputDocx = join(tempDir, 'output.docx');

        expect(() => mdToDocx(nonExistentMd, outputDocx)).toThrow();
      });

      it('should throw error for non-existent DOCX file', () => {
        const nonExistentDocx = join(tempDir, 'does-not-exist.docx');
        const outputMd = join(tempDir, 'output.md');

        expect(() => docxToMd(nonExistentDocx, outputMd)).toThrow();
      });
    });
  }
});
