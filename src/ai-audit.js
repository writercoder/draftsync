/**
 * AI Auditability
 *
 * Tracks AI usage against creative projects, per the project policy:
 * AI output should not end up in prose without specific acknowledgment
 * and justification by the author.
 *
 * No-keys sources: local Claude Code transcripts (~/.claude/projects),
 * manually logged events, and linked chat-session URLs (claude.ai /
 * chatgpt.com). API/OAuth-based ingestion is tracked separately (#16).
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';

/** Recognized purposes for an AI event */
export const AI_PURPOSES = [
  'tooling',
  'brainstorm',
  'research',
  'critique',
  'copy-edit',
  'prose-suggestion',
  'other'
];

/**
 * Detect the provider from a chat-session URL
 *
 * @param {string} url - Chat session URL
 * @returns {string|null} 'anthropic', 'openai', or null if unrecognized
 */
export function providerFromUrl(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (host === 'claude.ai' || host.endsWith('.claude.ai')) return 'anthropic';
  if (host === 'chatgpt.com' || host === 'chat.openai.com' || host.endsWith('.chatgpt.com')) {
    return 'openai';
  }
  return null;
}

/**
 * The Claude Code transcript directory for a project path
 *
 * Claude Code stores transcripts under ~/.claude/projects/<munged-path>,
 * where the munged path replaces '/' and '.' with '-'.
 *
 * @param {string} projectPath - Absolute project directory
 * @param {string} [home] - Home directory override (for tests)
 * @returns {string} Transcript directory path
 */
export function claudeTranscriptDir(projectPath, home = homedir()) {
  const munged = projectPath.replace(/[/.]/g, '-');
  return path.join(home, '.claude', 'projects', munged);
}

/**
 * Parse one Claude Code transcript into a usage summary
 *
 * @param {string} filePath - Path to the .jsonl transcript
 * @returns {Promise<Object|null>} Summary ({sessionKey, model, tokensIn,
 *   tokensOut, occurredAt, turns}) or null when the transcript has no
 *   assistant usage
 */
export async function parseClaudeTranscript(filePath) {
  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  let sessionKey = path.basename(filePath, '.jsonl');
  let model = null;
  let tokensIn = 0;
  let tokensOut = 0;
  let lastTimestamp = null;
  let turns = 0;

  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== 'assistant') continue;
    const usage = entry.message?.usage;
    if (!usage) continue;

    turns += 1;
    model = entry.message.model || model;
    sessionKey = entry.sessionId || sessionKey;
    tokensIn += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    tokensOut += usage.output_tokens || 0;
    if (entry.timestamp) lastTimestamp = entry.timestamp;
  }

  if (turns === 0) return null;
  return {
    sessionKey: `claude-code:${sessionKey}`,
    model,
    tokensIn,
    tokensOut,
    occurredAt: lastTimestamp,
    turns
  };
}

/**
 * Ingest Claude Code transcripts for a project into the AI ledger
 *
 * Idempotent: sessions are keyed by their session ID, so re-running
 * refreshes token counts without duplicating events. Ingested events
 * default to purpose "tooling" — reclassify (and justify) any session
 * that influenced prose.
 *
 * @param {import('./store.js').Store} store - Open store
 * @param {number} projectId - Project ID
 * @param {string} projectPath - Absolute project directory
 * @param {string} [home] - Home directory override (for tests)
 * @returns {Promise<{found: number, created: number, updated: number}>}
 */
export async function ingestClaudeCode(store, projectId, projectPath, home = homedir()) {
  const dir = claudeTranscriptDir(projectPath, home);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return { found: 0, created: 0, updated: 0 };
  }

  let found = 0;
  let created = 0;
  let updated = 0;
  for (const name of entries.filter(n => n.endsWith('.jsonl'))) {
    const summary = await parseClaudeTranscript(path.join(dir, name));
    if (!summary) continue;
    found += 1;
    const result = store.upsertAiEvent(projectId, {
      sessionKey: summary.sessionKey,
      provider: 'anthropic',
      source: 'claude-code',
      model: summary.model,
      purpose: 'tooling',
      tokensIn: summary.tokensIn,
      tokensOut: summary.tokensOut,
      occurredAt: summary.occurredAt
    });
    if (result.created) created += 1;
    else updated += 1;
  }
  return { found, created, updated };
}

/**
 * Build a Markdown AI-disclosure report for a project
 *
 * Groups events by chapter (linked card or file) with a project-level
 * section, flagging prose-affecting events that lack a justification.
 *
 * @param {import('./store.js').Store} store - Open store
 * @param {Object} project - Project row
 * @returns {string} Markdown report
 */
export function buildAiReport(store, project) {
  const events = store.listAiEvents(project.id);
  const cardsById = new Map(store.listCards(project.id).map(c => [c.id, c]));

  const describe = e => {
    const bits = [`${e.provider} (${e.source})`];
    if (e.model) bits.push(e.model);
    if (e.tokens_in || e.tokens_out) bits.push(`${e.tokens_in}→${e.tokens_out} tokens`);
    if (e.occurred_at) bits.push(e.occurred_at.slice(0, 10));
    let line = `- **${e.purpose}** — ${bits.join(', ')}`;
    if (e.url) line += `\n  ${e.url}`;
    if (e.justification) line += `\n  > ${e.justification}`;
    if (e.purpose === 'prose-suggestion' && !e.justification) {
      line += `\n  > ⚠️ UNACKNOWLEDGED: prose-affecting event without a justification`;
    }
    return line;
  };

  const groups = new Map();
  for (const e of events) {
    const card = e.card_id ? cardsById.get(e.card_id) : null;
    const key = card ? `Chapter: ${card.title}` : e.file ? `File: ${e.file}` : 'Project-wide';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }

  const lines = [
    `# AI Disclosure — ${project.name}`,
    '',
    `Policy: AI output does not enter prose without specific acknowledgment`,
    `and justification by the author.`,
    '',
    `Total AI events: ${events.length}`
  ];
  const ordered = [...groups.keys()].sort((a, b) =>
    a === 'Project-wide' ? 1 : b === 'Project-wide' ? -1 : a.localeCompare(b)
  );
  for (const key of ordered) {
    lines.push('', `## ${key}`, '');
    for (const e of groups.get(key)) lines.push(describe(e));
  }
  return lines.join('\n') + '\n';
}
