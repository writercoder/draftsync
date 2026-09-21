/**
 * Chapter Text Analysis — traditional tools only, no AI
 *
 * Plain parsing for title/word-count/excerpt, SHA-256 content hashing
 * for change detection, and classic line diffing (jsdiff) for change
 * magnitude. Markdown only in v1; other formats are tracked separately.
 */

import crypto from 'crypto';
import { diffLines } from 'diff';

/**
 * Analyze a Markdown text: extracted title, word count, first-paragraph
 * excerpt, and content hash
 *
 * @param {string} text - Markdown source
 * @param {number} [excerptLength=240] - Max excerpt characters
 * @returns {{title: string|null, wordCount: number, excerpt: string, contentHash: string}}
 */
export function analyzeMarkdown(text, excerptLength = 240) {
  const title = text.match(/^#\s+(.+)$/m)?.[1].trim() ?? null;

  // Words: prose only — strip headings, code fences, and markup noise
  const prose = text
    .replace(/^```[\s\S]*?^```/gm, ' ')
    .replace(/^#{1,6}\s+.*$/gm, ' ')
    .replace(/[*_`>|\\]/g, ' ');
  const wordCount = (prose.match(/[\p{L}\p{N}'’-]+/gu) || []).length;

  // Excerpt: first paragraph that isn't a heading
  let excerpt = '';
  for (const block of text.split(/\n\s*\n/)) {
    const trimmed = block.trim();
    if (!trimmed || /^#{1,6}\s/.test(trimmed) || trimmed.startsWith('```')) continue;
    excerpt = trimmed.replace(/\s+/g, ' ');
    break;
  }
  if (excerpt.length > excerptLength) {
    excerpt = excerpt.slice(0, excerptLength - 1).replace(/\s+\S*$/, '') + '…';
  }

  return { title, wordCount, excerpt, contentHash: sha256(text) };
}

/**
 * SHA-256 hex digest of a text
 *
 * @param {string} text - Content
 * @returns {string} Hex digest
 */
export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Change magnitude between two texts, by lines (classic diff)
 *
 * @param {string} oldText - Previous content
 * @param {string} newText - Current content
 * @returns {{linesAdded: number, linesRemoved: number, changed: boolean}}
 */
export function diffStats(oldText, newText) {
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const part of diffLines(oldText, newText)) {
    if (part.added) linesAdded += part.count;
    else if (part.removed) linesRemoved += part.count;
  }
  return { linesAdded, linesRemoved, changed: linesAdded + linesRemoved > 0 };
}
