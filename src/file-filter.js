/**
 * File Filtering Utilities
 *
 * Handles filtering markdown files for builds based on naming conventions,
 * explicit lists, and exclude patterns.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';

// Default exclusion patterns
const DEFAULT_EXCLUDE_PATTERNS = [
  '*.draft.md',
  '*.draft.*.md',
  '*.notes.md',
  '*.notes.*.md',
  '_*.md',
  'drafts/**',
  'notes/**',
  'archive/**',
  'README.md'
];

/**
 * Convert a glob-like pattern to a regular expression
 *
 * Supports `*` (matches within a path segment) and `**` (matches across
 * segments). Patterns match against the end of the path, so `drafts/**`
 * matches `content/drafts/scene.md` and `*.draft.md` matches any file
 * with that suffix in any directory.
 *
 * @param {string} pattern - Glob-like pattern
 * @returns {RegExp} Equivalent regular expression
 */
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .split('**')
    .map(part => part.replace(/\*/g, '[^/]*'))
    .join('.*');
  return new RegExp(`(^|/)${escaped}$`);
}

/**
 * Check if a file matches any of the patterns
 *
 * @param {string} filePath - File path to check
 * @param {string[]} patterns - Array of glob-like patterns
 * @returns {boolean} True if file matches at least one pattern
 */
function matchesPattern(filePath, patterns) {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return patterns.some(pattern => globToRegex(pattern).test(normalizedPath));
}

/**
 * Get all markdown files from content directory
 *
 * @param {string} contentDir - Content directory path
 * @param {boolean} [recursive=true] - Search recursively
 * @returns {Promise<string[]>} Array of markdown file paths
 */
export async function getAllMarkdownFiles(contentDir, recursive = true) {
  const files = [];

  async function scan(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive) {
        await scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
  }

  await scan(contentDir);
  return files.sort(); // Sort for consistent ordering
}

/**
 * Filter files based on exclude patterns
 *
 * @param {string[]} files - Array of file paths
 * @param {string[]} [excludePatterns] - Exclude patterns (uses defaults if not provided)
 * @returns {string[]} Filtered file array
 */
export function filterExcludedFiles(files, excludePatterns = DEFAULT_EXCLUDE_PATTERNS) {
  return files.filter(file => !matchesPattern(file, excludePatterns));
}

/**
 * Load metadata from YAML file
 *
 * @param {string} metadataPath - Path to metadata.yaml
 * @returns {Promise<object|null>} Parsed metadata or null if file doesn't exist
 */
async function loadMetadata(metadataPath) {
  let content;
  try {
    content = await fs.readFile(metadataPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }

  let doc;
  try {
    doc = parseYaml(content);
  } catch (error) {
    console.warn(`Warning: Could not parse ${metadataPath}: ${error.message}`);
    return null;
  }

  if (!doc || typeof doc !== 'object') {
    return null;
  }

  const metadata = {};
  if (Array.isArray(doc.chapters)) {
    metadata.chapters = doc.chapters.map(String);
  }
  if (Array.isArray(doc.exclude)) {
    metadata.exclude = doc.exclude.map(String);
  }

  return metadata;
}

/**
 * Get files to include in build based on metadata and options
 *
 * @param {Object} options - Build options
 * @param {string} [options.contentDir='content'] - Content directory
 * @param {string} [options.metadataPath='templates/metadata.yaml'] - Metadata file path
 * @param {string[]} [options.includePatterns] - CLI include patterns
 * @param {string[]} [options.excludePatterns] - Additional exclude patterns
 * @returns {Promise<string[]>} Array of file paths to include
 */
export async function getFilesToBuild(options = {}) {
  const {
    contentDir = 'content',
    metadataPath = 'templates/metadata.yaml',
    includePatterns = null,
    excludePatterns = []
  } = options;

  // Load metadata
  const metadata = await loadMetadata(metadataPath);

  // If chapters are explicitly listed in metadata, use those
  if (metadata?.chapters && metadata.chapters.length > 0) {
    // Verify files exist
    const existingFiles = [];
    for (const file of metadata.chapters) {
      try {
        await fs.access(file);
        existingFiles.push(file);
      } catch {
        console.warn(`Warning: Chapter file not found: ${file}`);
      }
    }
    return existingFiles;
  }

  // If include patterns provided via CLI, use those
  if (includePatterns && includePatterns.length > 0) {
    const allFiles = await getAllMarkdownFiles(contentDir);
    return allFiles.filter(file => matchesPattern(file, includePatterns));
  }

  // Otherwise, get all files and apply exclusions
  const allFiles = await getAllMarkdownFiles(contentDir);

  // Combine default, metadata, and CLI exclude patterns
  const allExcludePatterns = [
    ...DEFAULT_EXCLUDE_PATTERNS,
    ...(metadata?.exclude || []),
    ...excludePatterns
  ];

  return filterExcludedFiles(allFiles, allExcludePatterns);
}
