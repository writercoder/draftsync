/**
 * Unit tests for chapter text analysis — plain parsing, no AI
 */

import { describe, it, expect } from 'vitest';
import { analyzeMarkdown, diffStats, sha256 } from '../src/core/text-stats.js';

describe('Text Stats Unit Tests', () => {
  describe('analyzeMarkdown', () => {
    it('should extract title, word count, and first-paragraph excerpt', () => {
      const md =
        '# The Opening\n\nIt was a dark and stormy night; the rain fell in torrents.\n\nA second paragraph here.\n';
      const stats = analyzeMarkdown(md);
      expect(stats.title).toBe('The Opening');
      expect(stats.excerpt).toBe('It was a dark and stormy night; the rain fell in torrents.');
      expect(stats.wordCount).toBe(16); // prose only, heading excluded
      expect(stats.contentHash).toBe(sha256(md));
    });

    it('should skip headings and code when counting and excerpting', () => {
      const md = '# Title\n\n## Subtitle\n\n```js\nconst x = 1;\n```\n\nReal prose starts here.\n';
      const stats = analyzeMarkdown(md);
      expect(stats.excerpt).toBe('Real prose starts here.');
      expect(stats.wordCount).toBe(4);
    });

    it('should truncate long excerpts at a word boundary with an ellipsis', () => {
      const md = '# T\n\n' + 'word '.repeat(100).trim() + '\n';
      const stats = analyzeMarkdown(md, 50);
      expect(stats.excerpt.length).toBeLessThanOrEqual(50);
      expect(stats.excerpt.endsWith('…')).toBe(true);
    });

    it('should handle untitled, empty-ish documents', () => {
      const stats = analyzeMarkdown('just some words\n');
      expect(stats.title).toBeNull();
      expect(stats.wordCount).toBe(3);
      expect(stats.excerpt).toBe('just some words');
    });
  });

  describe('diffStats', () => {
    it('should count added and removed lines', () => {
      const before = 'one\ntwo\nthree\n';
      const after = 'one\n2\nthree\nfour\n';
      const delta = diffStats(before, after);
      expect(delta).toEqual({ linesAdded: 2, linesRemoved: 1, changed: true });
    });

    it('should report no change for identical texts', () => {
      expect(diffStats('same\n', 'same\n').changed).toBe(false);
    });
  });
});
