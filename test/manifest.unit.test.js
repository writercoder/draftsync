/**
 * Unit tests for manifest read/write operations
 *
 * Tests manifest file handling using a temporary directory.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readManifest, writeManifest } from '../src/drive.js';

describe('Manifest Unit Tests', () => {
  let tempDir;
  let manifestPath;

  beforeEach(() => {
    // Create a temporary directory for each test
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-test-'));
    manifestPath = join(tempDir, '.draftsync.json');
  });

  afterEach(() => {
    // Clean up temporary directory
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readManifest', () => {
    it('should return empty object when file is missing', async () => {
      const result = await readManifest(manifestPath);
      expect(result).toEqual({});
    });

    it('should return parsed JSON when file exists', async () => {
      const data = { 'content/ch1.md': 'fileId123' };
      await fs.writeFile(manifestPath, JSON.stringify(data), 'utf8');

      const result = await readManifest(manifestPath);
      expect(result).toEqual(data);
    });

    it('should handle complex manifest objects', async () => {
      const data = {
        version: '1.0',
        files: {
          'content/ch1.md': { gdocId: 'id1', lastSync: '2025-01-01T00:00:00Z' },
          'content/ch2.md': { gdocId: 'id2', lastSync: '2025-01-02T00:00:00Z' }
        },
        config: {
          contentDir: 'content',
          distDir: 'dist'
        }
      };
      await fs.writeFile(manifestPath, JSON.stringify(data), 'utf8');

      const result = await readManifest(manifestPath);
      expect(result).toEqual(data);
    });

    it('should throw error for malformed JSON', async () => {
      await fs.writeFile(manifestPath, '{ invalid json', 'utf8');

      await expect(readManifest(manifestPath)).rejects.toThrow();
    });
  });

  describe('writeManifest', () => {
    it('should write valid JSON to file', async () => {
      const data = { 'content/ch1.md': 'fileId' };
      await writeManifest(data, manifestPath);

      const content = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed).toEqual(data);
    });

    it('should format JSON with 2-space indentation', async () => {
      const data = { 'content/ch1.md': 'fileId' };
      await writeManifest(data, manifestPath);

      const content = await fs.readFile(manifestPath, 'utf8');

      // Check for proper indentation (2 spaces)
      expect(content).toContain('  "content/ch1.md"');
    });

    it('should overwrite existing file cleanly', async () => {
      const data1 = { 'content/ch1.md': 'fileId1' };
      const data2 = { 'content/ch2.md': 'fileId2' };

      await writeManifest(data1, manifestPath);
      await writeManifest(data2, manifestPath);

      const result = await readManifest(manifestPath);

      expect(result).toEqual(data2);
      expect(result).not.toHaveProperty('content/ch1.md');
    });

    it('should not create duplicate keys when writing twice', async () => {
      const data1 = { 'content/ch1.md': 'fileId1' };
      const data2 = { 'content/ch1.md': 'fileId2', 'content/ch2.md': 'fileId3' };

      await writeManifest(data1, manifestPath);
      await writeManifest(data2, manifestPath);

      const content = await fs.readFile(manifestPath, 'utf8');
      const parsed = JSON.parse(content);

      expect(parsed['content/ch1.md']).toBe('fileId2');
      expect(Object.keys(parsed).filter(k => k === 'content/ch1.md')).toHaveLength(1);
    });

    it('should produce valid JSON that can be read back', async () => {
      const data = {
        'content/ch1.md': 'fileId1',
        'content/ch2.md': 'fileId2',
        'content/ch3.md': 'fileId3'
      };

      await writeManifest(data, manifestPath);
      const result = await readManifest(manifestPath);

      expect(result).toEqual(data);
    });
  });

  describe('round-trip read/write', () => {
    it('should preserve data through multiple write/read cycles', async () => {
      const data1 = { 'content/ch1.md': 'fileId1' };
      const data2 = { 'content/ch1.md': 'fileId1', 'content/ch2.md': 'fileId2' };
      const data3 = { 'content/ch2.md': 'fileId2' };

      await writeManifest(data1, manifestPath);
      expect(await readManifest(manifestPath)).toEqual(data1);

      await writeManifest(data2, manifestPath);
      expect(await readManifest(manifestPath)).toEqual(data2);

      await writeManifest(data3, manifestPath);
      expect(await readManifest(manifestPath)).toEqual(data3);
    });
  });
});
