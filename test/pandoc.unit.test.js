/**
 * Unit tests for Pandoc module
 *
 * Tests argument building and error surfacing without invoking real Pandoc.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'child_process';
import {
  buildMdToDocxArgs,
  buildDocxToMdArgs,
  mdToDocx,
  docxToMd,
  runPandoc
} from '../src/pandoc.js';

// Mock child_process - include exec for the module import
vi.mock('child_process', () => ({
  spawnSync: vi.fn(),
  exec: vi.fn()
}));

describe('Pandoc Unit Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('buildMdToDocxArgs', () => {
    it('should build args with reference doc', () => {
      const result = buildMdToDocxArgs('a.md', 'a.docx', 'ref.docx');
      expect(result).toEqual(['a.md', '-o', 'a.docx', '--reference-doc', 'ref.docx']);
    });

    it('should build args without reference doc', () => {
      const result = buildMdToDocxArgs('a.md', 'a.docx');
      expect(result).toEqual(['a.md', '-o', 'a.docx']);
    });

    it('should omit reference-doc flag when refdoc is null', () => {
      const result = buildMdToDocxArgs('a.md', 'a.docx', null);
      expect(result).toEqual(['a.md', '-o', 'a.docx']);
      expect(result).not.toContain('--reference-doc');
    });
  });

  describe('buildDocxToMdArgs', () => {
    it('should build args for docx to md conversion', () => {
      const result = buildDocxToMdArgs('a.docx', 'a.md');
      expect(result).toEqual(['a.docx', '-o', 'a.md']);
    });

    it('should handle different paths correctly', () => {
      const result = buildDocxToMdArgs('path/to/file.docx', 'output/result.md');
      expect(result).toEqual(['path/to/file.docx', '-o', 'output/result.md']);
    });
  });

  describe('runPandoc', () => {
    it('should call spawnSync with correct arguments', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: Buffer.from('success'),
        stderr: Buffer.from('')
      });

      const args = ['input.md', '-o', 'output.docx'];
      const result = runPandoc(args);

      expect(spawnSync).toHaveBeenCalledWith('pandoc', args, { stdio: 'inherit' });
      expect(result.status).toBe(0);
    });

    it('should return status 1 when status is null', () => {
      spawnSync.mockReturnValue({
        status: null,
        stdout: null,
        stderr: null
      });

      const result = runPandoc(['test.md', '-o', 'test.docx']);

      expect(result.status).toBe(1);
    });
  });

  describe('mdToDocx', () => {
    it('should call spawnSync and succeed when status is 0', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: null,
        stderr: null
      });

      expect(() => mdToDocx('a.md', 'a.docx')).not.toThrow();
      expect(spawnSync).toHaveBeenCalledWith('pandoc', ['a.md', '-o', 'a.docx'], {
        stdio: 'inherit'
      });
    });

    it('should call spawnSync with reference doc when provided', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: null,
        stderr: null
      });

      mdToDocx('a.md', 'a.docx', 'ref.docx');

      expect(spawnSync).toHaveBeenCalledWith(
        'pandoc',
        ['a.md', '-o', 'a.docx', '--reference-doc', 'ref.docx'],
        { stdio: 'inherit' }
      );
    });

    it('should throw error when pandoc fails with non-zero status', () => {
      spawnSync.mockReturnValue({
        status: 1,
        stdout: null,
        stderr: Buffer.from('error message')
      });

      expect(() => mdToDocx('a.md', 'a.docx')).toThrow('pandoc failed (md → docx)');
    });

    it('should throw error message containing "md → docx"', () => {
      spawnSync.mockReturnValue({
        status: 2,
        stdout: null,
        stderr: null
      });

      expect(() => mdToDocx('test.md', 'test.docx')).toThrow(/md → docx/);
    });
  });

  describe('docxToMd', () => {
    it('should call spawnSync and succeed when status is 0', () => {
      spawnSync.mockReturnValue({
        status: 0,
        stdout: null,
        stderr: null
      });

      expect(() => docxToMd('a.docx', 'a.md')).not.toThrow();
      expect(spawnSync).toHaveBeenCalledWith('pandoc', ['a.docx', '-o', 'a.md'], {
        stdio: 'inherit'
      });
    });

    it('should throw error when pandoc fails', () => {
      spawnSync.mockReturnValue({
        status: 1,
        stdout: null,
        stderr: null
      });

      expect(() => docxToMd('a.docx', 'a.md')).toThrow('pandoc failed (docx → md)');
    });

    it('should throw error message containing "docx → md"', () => {
      spawnSync.mockReturnValue({
        status: 127,
        stdout: null,
        stderr: Buffer.from('command not found')
      });

      expect(() => docxToMd('input.docx', 'output.md')).toThrow(/docx → md/);
    });

    it('should include status code in error message', () => {
      spawnSync.mockReturnValue({
        status: 42,
        stdout: null,
        stderr: null
      });

      expect(() => docxToMd('test.docx', 'test.md')).toThrow(/status 42/);
    });
  });
});
