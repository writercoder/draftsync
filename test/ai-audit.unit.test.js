/**
 * Unit tests for AI auditability: provider detection, Claude Code
 * transcript parsing/ingestion, and the disclosure report.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { openStore } from '../src/store.js';
import {
  providerFromUrl,
  claudeTranscriptDir,
  parseClaudeTranscript,
  ingestClaudeCode,
  buildAiReport
} from '../src/ai-audit.js';

const transcriptLine = (over = {}) =>
  JSON.stringify({
    type: 'assistant',
    sessionId: 'sess-1',
    timestamp: '2026-09-19T10:00:00.000Z',
    message: {
      model: 'claude-fable-5',
      usage: { input_tokens: 10, cache_creation_input_tokens: 90, output_tokens: 40 }
    },
    ...over
  });

describe('AI Audit Unit Tests', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'draftsync-ai-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('providerFromUrl', () => {
    it('should recognize claude.ai and chatgpt hosts', () => {
      expect(providerFromUrl('https://claude.ai/chat/abc-123')).toBe('anthropic');
      expect(providerFromUrl('https://chatgpt.com/c/abc-123')).toBe('openai');
      expect(providerFromUrl('https://chat.openai.com/c/abc')).toBe('openai');
    });

    it('should return null for other or invalid URLs', () => {
      expect(providerFromUrl('https://example.com/x')).toBeNull();
      expect(providerFromUrl('not a url')).toBeNull();
      expect(providerFromUrl('https://evilclaude.ai/x')).toBeNull();
    });
  });

  describe('claudeTranscriptDir', () => {
    it('should munge slashes and dots like Claude Code does', () => {
      expect(claudeTranscriptDir('/Users/guru/dev/draftsync', '/home/x')).toBe(
        '/home/x/.claude/projects/-Users-guru-dev-draftsync'
      );
      expect(claudeTranscriptDir('/a/b.c', '/h')).toBe('/h/.claude/projects/-a-b-c');
    });
  });

  describe('parseClaudeTranscript', () => {
    it('should aggregate assistant usage across turns', async () => {
      const file = join(tempDir, 'sess-1.jsonl');
      writeFileSync(
        file,
        [
          '{"type":"mode","mode":"normal"}',
          transcriptLine(),
          'not json at all',
          transcriptLine({ timestamp: '2026-09-19T11:00:00.000Z' }),
          '{"type":"user","message":{}}'
        ].join('\n')
      );

      const summary = await parseClaudeTranscript(file);
      expect(summary).toEqual({
        sessionKey: 'claude-code:sess-1',
        model: 'claude-fable-5',
        tokensIn: 200,
        tokensOut: 80,
        occurredAt: '2026-09-19T11:00:00.000Z',
        turns: 2
      });
    });

    it('should return null for transcripts with no assistant usage', async () => {
      const file = join(tempDir, 'empty.jsonl');
      writeFileSync(file, '{"type":"mode","mode":"normal"}\n');
      expect(await parseClaudeTranscript(file)).toBeNull();
      expect(await parseClaudeTranscript(join(tempDir, 'missing.jsonl'))).toBeNull();
    });
  });

  describe('ingestClaudeCode', () => {
    let store;
    let project;
    const projectPath = '/Users/me/my-novel';

    beforeEach(() => {
      store = openStore(join(tempDir, 'data'));
      project = store.getOrCreateProject(projectPath);
      const dir = claudeTranscriptDir(projectPath, tempDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'sess-1.jsonl'), transcriptLine() + '\n');
    });

    afterEach(() => store.close());

    it('should create events with purpose tooling', async () => {
      const result = await ingestClaudeCode(store, project.id, projectPath, tempDir);
      expect(result).toEqual({ found: 1, created: 1, updated: 0 });

      const [event] = store.listAiEvents(project.id);
      expect(event.provider).toBe('anthropic');
      expect(event.source).toBe('claude-code');
      expect(event.purpose).toBe('tooling');
      expect(event.tokens_in).toBe(100);
    });

    it('should be idempotent and preserve user reclassification', async () => {
      await ingestClaudeCode(store, project.id, projectPath, tempDir);
      const [event] = store.listAiEvents(project.id);
      // Author reclassifies the session (directly via the store here)
      store.db
        .prepare(
          "UPDATE ai_events SET purpose = 'critique', justification = 'plot advice' WHERE id = ?"
        )
        .run(event.id);

      const again = await ingestClaudeCode(store, project.id, projectPath, tempDir);
      expect(again).toEqual({ found: 1, created: 0, updated: 1 });
      const [refreshed] = store.listAiEvents(project.id);
      expect(refreshed.purpose).toBe('critique');
      expect(refreshed.justification).toBe('plot advice');
    });

    it('should report zeros when no transcript directory exists', async () => {
      const result = await ingestClaudeCode(store, project.id, '/nowhere/else', tempDir);
      expect(result).toEqual({ found: 0, created: 0, updated: 0 });
    });
  });

  describe('buildAiReport', () => {
    it('should group by chapter and flag unjustified prose events', async () => {
      const store = openStore(join(tempDir, 'data2'));
      const project = store.getOrCreateProject('/Users/me/my-novel');
      const card = store.createCard(project.id, { title: 'Chapter 3', file: 'content/03.md' });

      store.upsertAiEvent(project.id, {
        sessionKey: 'https://claude.ai/chat/x',
        provider: 'anthropic',
        source: 'chat-link',
        url: 'https://claude.ai/chat/x',
        cardId: card.id,
        purpose: 'prose-suggestion',
        justification: ''
      });
      store.upsertAiEvent(project.id, {
        sessionKey: 'claude-code:s1',
        provider: 'anthropic',
        source: 'claude-code',
        purpose: 'tooling',
        tokensIn: 5,
        tokensOut: 3
      });

      const report = buildAiReport(store, project);
      expect(report).toContain('# AI Disclosure — my-novel');
      expect(report).toContain('## Chapter: Chapter 3');
      expect(report).toContain('UNACKNOWLEDGED');
      expect(report).toContain('## Project-wide');
      expect(report).toContain('https://claude.ai/chat/x');
      store.close();
    });
  });
});
