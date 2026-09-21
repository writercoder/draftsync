/**
 * Seed the example projects with full workflow histories: review
 * lifecycles (sent + received), tasks, AI usage, and timeline
 * activities — so the multi-project views demo with realistic data.
 *
 * Idempotent: a project that already has reviews is skipped.
 * Run from the repo root: node scripts/seed-demos.mjs
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { openStore } from '../src/store.js';
import { execute } from '../src/core/registry.js';
import '../src/core/operations.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples');
const store = openStore();
const ctx = { store };
const run = (name, input) => execute(name, ctx, input);

/** Backdate a row so histories spread over the past two weeks */
function backdate(table, id, daysAgo, time) {
  const cols = {
    reviews: ['created_at', 'sent_at', 'received_at'],
    ai_events: ['occurred_at', 'created_at']
  }[table] ?? ['created_at'];
  for (const col of cols) {
    store.db
      .prepare(
        `UPDATE ${table} SET ${col} = datetime('now', '-' || ? || ' days') || '' WHERE id = ? AND ${col} IS NOT NULL`
      )
      .run(daysAgo, id);
    store.db
      .prepare(
        `UPDATE ${table} SET ${col} = date(${col}) || ' ' || ? WHERE id = ? AND ${col} IS NOT NULL`
      )
      .run(time, id);
  }
}

function chapterByTitle(projectId, fragment) {
  return store.listChapters(projectId).find(c => c.title.includes(fragment));
}

/**
 * Align activity timestamps with their source rows (reviews) and
 * spread the rest over the past two weeks — runs on every invocation
 * so re-runs repair drifted demo histories.
 */
function alignActivities(projectId) {
  const reviews = store.listReviews(projectId);
  const acts = store.db
    .prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY id')
    .all(projectId);
  const setAt = store.db.prepare('UPDATE activities SET created_at = ? WHERE id = ?');
  const offsets = { chapter_created: 14, edition_created: 13, task_created: 8, task_completed: 5 };
  for (const a of acts) {
    const data = JSON.parse(a.data);
    if (a.type === 'review_sent' || a.type === 'review_received') {
      const review = reviews.find(r => r.reviewer_name === data.reviewer);
      const at =
        a.type === 'review_sent' ? (review?.sent_at ?? review?.created_at) : review?.received_at;
      if (at) setAt.run(at, a.id);
    } else if (offsets[a.type] !== undefined) {
      const row = store.db
        .prepare(`SELECT datetime('now', '-' || ? || ' days') AS at`)
        .get(offsets[a.type]);
      setAt.run(row.at, a.id);
    }
  }
}

async function seedProject(dirName, plan) {
  const project = store.getOrCreateProject(path.join(ROOT, dirName));
  if (store.listReviews(project.id).length > 0) {
    console.log(`- ${project.name}: already seeded (realigning timestamps)`);
    alignActivities(project.id);
    return;
  }
  await plan(project);
  alignActivities(project.id);
  console.log(`✓ ${project.name}: seeded`);
}

await seedProject('pride-and-prejudice', async project => {
  const p = project.id;
  const ch1 = chapterByTitle(p, 'Chapter I');
  const ch2 = chapterByTitle(p, 'Chapter II');
  const edition = store.listEditions(p).find(e => e.name === 'Serialized Preview');

  // Tasks — one done, two open
  const t1 = await run('task.create', {
    project_id: p,
    chapter_id: ch1.id,
    text: 'Check Mr. Bennet dialogue attribution against the 1813 text'
  });
  await run('task.update', { project_id: p, task_id: t1.id, done: true });
  await run('task.create', { project_id: p, text: 'Decide whether to modernise long-s spellings' });
  await run('task.create', {
    project_id: p,
    chapter_id: ch2.id,
    text: 'Confirm the visit sequence continuity into Chapter III'
  });

  // Review lifecycle: one awaiting, one fulfilled, one unsolicited
  const sent = await run('review.request', {
    project_id: p,
    edition_id: edition.id,
    reviewer_name: 'Cassandra Austen',
    reviewer_email: 'cassandra@example.com',
    request_note: 'first impressions of the serialized opening'
  });
  const fulfilled = await run('review.request', {
    project_id: p,
    chapter_id: ch1.id,
    reviewer_name: 'Rev. George Austen',
    reviewer_email: 'george@example.com',
    request_note: 'does the opening line land?'
  });
  await run('review.receive', {
    project_id: p,
    review_id: fulfilled.id,
    body: 'The first sentence is perfection itself — do not touch a word of it. Mrs. Bennet, however, could bear one fewer exclamation.'
  });
  const unsolicited = await run('review.receive', {
    project_id: p,
    chapter_id: ch2.id,
    reviewer_name: 'Anne Sharp',
    reviewer_email: 'anne.sharp@example.com',
    body: 'Chapter II moves briskly; the joke about Mrs. Long’s nieces deserves a beat more room.'
  });

  // AI usage: justified links, a tooling session, and one deliberately
  // unacknowledged prose event (inserted directly — the API refuses it)
  const ai1 = await run('ai.log_event', {
    project_id: p,
    url: 'https://claude.ai/chat/pp-brainstorm-demo',
    purpose: 'brainstorm',
    justification: 'Explored serialization strategies; plan written up myself.'
  });
  const ai2 = await run('ai.log_event', {
    project_id: p,
    chapter_id: ch1.id,
    url: 'https://chatgpt.com/c/pp-critique-demo',
    purpose: 'critique',
    justification: 'Asked how a modern reader hears the opening irony.'
  });
  const { event: ai3 } = store.upsertAiEvent(p, {
    sessionKey: 'https://claude.ai/chat/pp-prose-demo',
    provider: 'anthropic',
    source: 'chat-link',
    url: 'https://claude.ai/chat/pp-prose-demo',
    chapterId: ch2.id,
    purpose: 'prose-suggestion',
    justification: ''
  });

  // Synthetic file-edit history (content files themselves stay pristine)
  const fe1 = store.addActivity(p, {
    type: 'file_edited',
    chapterId: ch1.id,
    data: { file: ch1.file, linesAdded: 6, linesRemoved: 2, wordCount: 847 }
  });
  const fe2 = store.addActivity(p, {
    type: 'file_edited',
    chapterId: ch2.id,
    data: { file: ch2.file, linesAdded: 11, linesRemoved: 9, wordCount: 797 }
  });

  // Spread the history over the past two weeks
  backdate('reviews', sent.id, 2, '09:14:00');
  backdate('reviews', fulfilled.id, 9, '10:02:00');
  store.db
    .prepare("UPDATE reviews SET received_at = datetime('now', '-4 days') WHERE id = ?")
    .run(fulfilled.id);
  backdate('reviews', unsolicited.id, 1, '16:41:00');
  backdate('ai_events', ai1.id, 12, '11:20:00');
  backdate('ai_events', ai2.id, 6, '15:05:00');
  backdate('ai_events', ai3.id, 3, '19:33:00');
  backdate('activities', fe1.id, 5, '08:55:00');
  backdate('activities', fe2.id, 1, '07:30:00');
});

await seedProject('shakespeare-sonnets', async project => {
  const p = project.id;
  const s73 = chapterByTitle(p, 'Sonnet 73');
  const s116 = chapterByTitle(p, 'Sonnet 116');
  const s130 = chapterByTitle(p, 'Sonnet 130');
  const fairYouth = store.listEditions(p).find(e => e.name === 'Fair Youth');

  const t1 = await run('task.create', {
    project_id: p,
    chapter_id: s116.id,
    text: 'Verify line 8 reading against the 1609 Quarto'
  });
  await run('task.update', { project_id: p, task_id: t1.id, done: true });
  await run('task.create', {
    project_id: p,
    text: 'Standardise -’d vs -ed endings across the selection'
  });

  const sent = await run('review.request', {
    project_id: p,
    edition_id: fairYouth.id,
    reviewer_name: 'Henry Wriothesley',
    reviewer_email: 'southampton@example.com',
    request_note: 'ordering of the Fair Youth selection'
  });
  const received = await run('review.receive', {
    project_id: p,
    chapter_id: s130.id,
    reviewer_name: 'Anne Hathaway',
    reviewer_email: 'anne@example.com',
    body: 'I have read what you say of your mistress’ eyes. We will speak of this at supper.'
  });

  const ai1 = await run('ai.log_event', {
    project_id: p,
    chapter_id: s73.id,
    url: 'https://claude.ai/chat/sonnet73-critique-demo',
    purpose: 'critique',
    justification: 'Compared editorial glosses on the third quatrain; notes only.'
  });
  const ai2 = await run('ai.log_event', {
    project_id: p,
    provider: 'anthropic',
    model: 'claude-fable-5',
    purpose: 'tooling',
    justification: 'Repository housekeeping for the selection.'
  });

  backdate('reviews', sent.id, 3, '10:45:00');
  backdate('reviews', received.id, 7, '20:12:00');
  backdate('ai_events', ai1.id, 8, '13:25:00');
  backdate('ai_events', ai2.id, 10, '09:40:00');
});

for (const projectName of ['pride-and-prejudice', 'shakespeare-sonnets']) {
  const project = store.listProjects().find(x => x.name === projectName);
  console.log(
    `  ${projectName}: ${store.listReviews(project.id).length} reviews, ` +
      `${store.listTasks(project.id).length} tasks, ` +
      `${store.listAiEvents(project.id).length} AI events, ` +
      `${store.listActivities(project.id).length} activities`
  );
}
store.close();
