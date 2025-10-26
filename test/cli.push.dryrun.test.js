/**
 * CLI dry-run tests
 *
 * Tests the CLI commands with --dry-run flag to ensure they don't execute
 * actual operations but print what would happen.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { execaNode } from 'execa';
import { promises as fs } from 'fs';
import { join } from 'path';

const CLI_PATH = './bin/draftsync.js';

describe('CLI Dry-Run Tests', () => {
  let fixturesPath;

  beforeAll(async () => {
    fixturesPath = join(process.cwd(), 'fixtures/content');

    // Ensure fixture files exist
    const ch1Exists = await fs
      .access(join(fixturesPath, 'ch1.md'))
      .then(() => true)
      .catch(() => false);

    if (!ch1Exists) {
      throw new Error('Fixture files not found. Run from project root.');
    }
  });

  describe('push --dry-run', () => {
    it('should exit with code 0', async () => {
      const { exitCode } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(exitCode).toBe(0);
    });

    it('should print "Would convert MD → DOCX"', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('Would convert MD → DOCX');
    });

    it('should print "Would create Google Doc"', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('Would create Google Doc');
    });

    it('should print DRY RUN indicator', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('DRY RUN');
    });

    it('should mention reference doc when --refdoc is provided', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run',
        '--refdoc',
        'templates/reference.docx'
      ]);

      expect(stdout).toContain('reference document');
      expect(stdout).toContain('templates/reference.docx');
    });

    it('should mention formatting when --format is provided', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run',
        '--format'
      ]);

      expect(stdout).toContain('formatting');
      expect(stdout).toMatch(/double-space|margins|headers/i);
    });

    it('should mention folder when --folder-id is provided', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run',
        '--folder-id',
        'test-folder-id-123'
      ]);

      expect(stdout).toContain('folder');
      expect(stdout).toContain('test-folder-id-123');
    });

    it('should work with ch2.md fixture', async () => {
      const { exitCode, stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch2.md',
        '--dry-run'
      ]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain('DRY RUN');
      expect(stdout).toContain('Would convert');
    });
  });

  describe('pull --dry-run', () => {
    it('should print "Would export Google Doc → DOCX"', async () => {
      // First link a dummy file
      await execaNode(CLI_PATH, ['init']);
      await execaNode(CLI_PATH, ['link', 'fixtures/content/ch1.md', 'dummy-doc-id-123']);

      const { stdout } = await execaNode(CLI_PATH, [
        'pull',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('Would export Google Doc');
      expect(stdout).toContain('DOCX');
    });

    it('should print "Would convert DOCX → MD"', async () => {
      // Ensure the file is linked
      await execaNode(CLI_PATH, ['init']);
      await execaNode(CLI_PATH, ['link', 'fixtures/content/ch1.md', 'dummy-doc-id-456']);

      const { stdout } = await execaNode(CLI_PATH, [
        'pull',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('Would convert DOCX → MD');
    });

    it('should exit with code 0 when file is linked', async () => {
      await execaNode(CLI_PATH, ['init']);
      await execaNode(CLI_PATH, ['link', 'fixtures/content/ch1.md', 'test-doc-id']);

      const { exitCode } = await execaNode(CLI_PATH, [
        'pull',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(exitCode).toBe(0);
    });

    it('should print DRY RUN indicator', async () => {
      await execaNode(CLI_PATH, ['init']);
      await execaNode(CLI_PATH, ['link', 'fixtures/content/ch1.md', 'doc-id']);

      const { stdout } = await execaNode(CLI_PATH, [
        'pull',
        'fixtures/content/ch1.md',
        '--dry-run'
      ]);

      expect(stdout).toContain('DRY RUN');
    });
  });

  describe('error handling', () => {
    it('should handle non-existent file gracefully in push', async () => {
      const result = await execaNode(CLI_PATH, ['push', 'does-not-exist.md', '--dry-run'], {
        reject: false
      });

      // Dry-run should still work even if file doesn't exist (it won't read it)
      expect(result.exitCode).toBe(0);
    });

    it('should show error when pulling unlinked file', async () => {
      await execaNode(CLI_PATH, ['init']);

      const { stdout, stderr } = await execaNode(
        CLI_PATH,
        ['pull', 'fixtures/content/ch2.md', '--dry-run'],
        { reject: false }
      );

      // Should mention that file is not linked (check both stdout and stderr)
      const output = stdout + stderr;
      expect(output).toMatch(/No Google Doc linked|Run "draftsync link/);
    });
  });

  describe('combined options', () => {
    it('should handle multiple options together', async () => {
      const { stdout } = await execaNode(CLI_PATH, [
        'push',
        'fixtures/content/ch1.md',
        '--dry-run',
        '--refdoc',
        'ref.docx',
        '--format',
        '--folder-id',
        'folder-123'
      ]);

      expect(stdout).toContain('DRY RUN');
      expect(stdout).toContain('ref.docx');
      expect(stdout).toContain('formatting');
      expect(stdout).toContain('folder-123');
    });
  });
});
