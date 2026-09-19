/**
 * Unit tests for file filtering
 *
 * Tests markdown file discovery, exclusion patterns, and build file
 * selection using a temporary directory.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getAllMarkdownFiles, filterExcludedFiles, getFilesToBuild } from '../src/file-filter.js';

describe('File Filter Unit Tests', () => {
  let tempDir;
  let contentDir;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-filter-'));
    contentDir = join(tempDir, 'content');

    await fs.mkdir(join(contentDir, 'drafts'), { recursive: true });
    await fs.mkdir(join(contentDir, 'notes'), { recursive: true });

    const files = {
      '01-first.md': '# First',
      '02-second.md': '# Second',
      '03-third.draft.md': '# Draft',
      'character.notes.md': '# Notes',
      '_outline.md': '# Outline',
      'README.md': '# Readme',
      'not-markdown.txt': 'text',
      'drafts/scene.md': '# Scene',
      'notes/ideas.md': '# Ideas'
    };
    for (const [name, content] of Object.entries(files)) {
      await fs.writeFile(join(contentDir, name), content, 'utf8');
    }
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('getAllMarkdownFiles', () => {
    it('should find .md files recursively, sorted', async () => {
      const files = await getAllMarkdownFiles(contentDir);
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual([
        '01-first.md',
        '02-second.md',
        '03-third.draft.md',
        'README.md',
        '_outline.md',
        'character.notes.md',
        'drafts/scene.md',
        'notes/ideas.md'
      ]);
    });

    it('should ignore non-markdown files', async () => {
      const files = await getAllMarkdownFiles(contentDir);
      expect(files.some(f => f.endsWith('.txt'))).toBe(false);
    });

    it('should not recurse when recursive is false', async () => {
      const files = await getAllMarkdownFiles(contentDir, false);
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative.some(f => f.startsWith('drafts/'))).toBe(false);
      expect(relative.some(f => f.startsWith('notes/'))).toBe(false);
      expect(relative).toContain('01-first.md');
    });
  });

  describe('filterExcludedFiles', () => {
    it('should exclude drafts, notes, underscore files, and README by default', async () => {
      const all = await getAllMarkdownFiles(contentDir);
      const filtered = filterExcludedFiles(all);
      const relative = filtered.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md', '02-second.md']);
    });

    it('should exclude directory patterns anywhere in the path', () => {
      const files = ['content/drafts/scene.md', 'content/drafts/deep/nested.md'];
      expect(filterExcludedFiles(files, ['drafts/**'])).toEqual([]);
    });

    it('should match filename wildcards in any directory', () => {
      const files = ['content/sub/ch.draft.md', 'content/keep.md'];
      expect(filterExcludedFiles(files, ['*.draft.md'])).toEqual(['content/keep.md']);
    });

    it('should support custom exclude patterns', () => {
      const files = ['content/ch1.md', 'content/ch2.wip.md', 'content/archive/old.md'];
      const filtered = filterExcludedFiles(files, ['*.wip.md', 'archive/**']);
      expect(filtered).toEqual(['content/ch1.md']);
    });

    it('should not treat * as crossing directory separators', () => {
      const files = ['content/drafts/scene.md'];
      // "drafts/*.md" should match direct children only, not "drafts" itself elsewhere
      expect(filterExcludedFiles(files, ['content/*.md'])).toEqual(files);
    });
  });

  describe('getFilesToBuild', () => {
    it('should apply default exclusions when no metadata exists', async () => {
      const files = await getFilesToBuild({
        contentDir,
        metadataPath: join(tempDir, 'missing.yaml')
      });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md', '02-second.md']);
    });

    it('should use explicit chapters list from metadata, in order', async () => {
      const metadataPath = join(tempDir, 'metadata.yaml');
      const ch1 = join(contentDir, '01-first.md');
      const ch2 = join(contentDir, '02-second.md');
      await fs.writeFile(
        metadataPath,
        `---\ntitle: "Test"\nchapters:\n  - "${ch2}"\n  - "${ch1}"\n`,
        'utf8'
      );

      const files = await getFilesToBuild({ contentDir, metadataPath });
      expect(files).toEqual([ch2, ch1]);
    });

    it('should warn and skip missing chapter files', async () => {
      const metadataPath = join(tempDir, 'metadata.yaml');
      const ch1 = join(contentDir, '01-first.md');
      const missing = join(contentDir, 'nope.md');
      await fs.writeFile(metadataPath, `chapters:\n  - "${ch1}"\n  - "${missing}"\n`, 'utf8');

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const files = await getFilesToBuild({ contentDir, metadataPath });
      expect(files).toEqual([ch1]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('nope.md'));
      warn.mockRestore();
    });

    it('should apply include patterns from CLI options', async () => {
      const files = await getFilesToBuild({
        contentDir,
        metadataPath: join(tempDir, 'missing.yaml'),
        includePatterns: ['01-*.md']
      });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md']);
    });

    it('should combine metadata exclude patterns with defaults', async () => {
      const metadataPath = join(tempDir, 'metadata.yaml');
      await fs.writeFile(metadataPath, `title: "Test"\nexclude:\n  - "02-*.md"\n`, 'utf8');

      const files = await getFilesToBuild({ contentDir, metadataPath });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md']);
    });

    it('should apply CLI exclude patterns on top of defaults', async () => {
      const files = await getFilesToBuild({
        contentDir,
        metadataPath: join(tempDir, 'missing.yaml'),
        excludePatterns: ['01-*.md']
      });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['02-second.md']);
    });

    it('should fall back to defaults when metadata YAML is invalid', async () => {
      const metadataPath = join(tempDir, 'metadata.yaml');
      await fs.writeFile(metadataPath, 'title: "unclosed\n  [broken', 'utf8');

      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const files = await getFilesToBuild({ contentDir, metadataPath });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md', '02-second.md']);
      warn.mockRestore();
    });

    it('should parse the shipped metadata template without a chapters list', async () => {
      // The real template has commented-out chapters/exclude sections
      const files = await getFilesToBuild({
        contentDir,
        metadataPath: 'templates/metadata.yaml'
      });
      const relative = files.map(f => f.slice(contentDir.length + 1));
      expect(relative).toEqual(['01-first.md', '02-second.md']);
    });
  });
});
