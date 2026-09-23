/**
 * Draftsync Operations (ADR 0001)
 *
 * Every capability, defined once. Adapters (HTTP server, CLI, MCP)
 * dispatch into this registry. Handlers receive ctx = { store }.
 */

import { promises as fs } from 'fs';
import crypto from 'crypto';
import path from 'path';
import { z } from 'zod';
import { defineOperation, OperationError } from './registry.js';
import { getDataDir, STAGES } from '../store.js';
import { authenticate, getCredentialsPath, getTokenPath, hasGoogleClient } from '../auth.js';
import { getAllMarkdownFiles, filterExcludedFiles, getFilesToBuild } from '../file-filter.js';
import { AI_PURPOSES, providerFromUrl, ingestClaudeCode, buildAiReport } from '../ai-audit.js';
import { analyzeMarkdown, diffStats } from './text-stats.js';
import {
  convertMarkdownFilesToDocx,
  convertMarkdownFilesToPdf,
  convertMarkdownToEpub
} from '../pandoc.js';

const id = z.coerce.number().int().positive();
const EXPORT_FORMATS = ['epub', 'docx', 'pdf'];
const EXPORT_EXT = { epub: 'epub', docx: 'docx', pdf: 'pdf' };

/** Look up an entity or throw a 404 OperationError */
function must(entity, what) {
  if (!entity) throw new OperationError(`${what} not found`, 404);
  return entity;
}

function projectOf(store, projectId) {
  return must(store.getProject(projectId), 'project');
}

function chapterIn(store, projectId, chapterId) {
  const chapter = store.getChapter(chapterId);
  if (!chapter || chapter.project_id !== projectId) {
    throw new OperationError('chapter not found', 404);
  }
  return chapter;
}

/**
 * Read a project's draftsync manifest (empty shape when missing)
 *
 * @param {string} projectPath - Absolute project directory
 * @returns {Promise<Object>} Manifest object
 */
export async function readProjectManifest(projectPath) {
  try {
    return JSON.parse(await fs.readFile(path.join(projectPath, '.draftsync.json'), 'utf8'));
  } catch {
    return { files: {}, config: {} };
  }
}

async function convertFiles(format, mdFiles, output, metadata, cssFile = null) {
  if (format === 'docx') {
    await convertMarkdownFilesToDocx(mdFiles, output, { metadata });
  } else if (format === 'pdf') {
    await convertMarkdownFilesToPdf(mdFiles, output, { metadata });
  } else {
    await convertMarkdownToEpub(mdFiles, output, { metadata, css: cssFile, tocDepth: 3 });
  }
}

async function accessOrNull(filePath) {
  try {
    await fs.access(filePath);
    return filePath;
  } catch {
    return null;
  }
}

/* ------------------------------- projects ------------------------------- */

defineOperation({
  name: 'project.list',
  description: 'List all registered projects with labels and chapter counts',
  input: z.object({}),
  handler: ({ store }) => ({ projects: store.listProjects() })
});

defineOperation({
  name: 'project.register',
  description: 'Register a project by directory path (created if not yet known)',
  input: z.object({ path: z.string().min(1) }),
  handler: async ({ store }, input) => {
    const projectPath = path.resolve(input.path);
    let stat;
    try {
      stat = await fs.stat(projectPath);
    } catch {
      throw new OperationError(`not a directory: ${projectPath}`, 400);
    }
    if (!stat.isDirectory()) throw new OperationError(`not a directory: ${projectPath}`, 400);
    return store.getOrCreateProject(projectPath);
  }
});

defineOperation({
  name: 'project.update',
  description: "Update a project's name or label (null label clears it)",
  input: z.object({
    project_id: id,
    name: z.string().min(1).optional(),
    label: z.string().nullable().optional(),
    favorite: z.boolean().optional()
  }),
  handler: ({ store }, { project_id, favorite, ...fields }) => {
    projectOf(store, project_id);
    if (favorite !== undefined) fields.favorite = favorite ? 1 : 0;
    return store.updateProject(project_id, fields);
  }
});

defineOperation({
  name: 'board.get',
  description:
    'The full board for a project: chapters by stage with text stats, Google Doc links, task and AI counts',
  input: z.object({ project_id: id }),
  handler: async ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    const aiEvents = store.listAiEvents(project.id);
    const aiCounts = {};
    for (const e of aiEvents) {
      if (e.chapter_id) aiCounts[e.chapter_id] = (aiCounts[e.chapter_id] || 0) + 1;
    }
    const taskCounts = {};
    for (const t of store.listTasks(project.id)) {
      if (!t.done && t.chapter_id) taskCounts[t.chapter_id] = (taskCounts[t.chapter_id] || 0) + 1;
    }
    const manifest = await readProjectManifest(project.path);
    const chapters = store.listChapters(project.id).map(chapter => {
      const gdocId = chapter.file && manifest.files?.[chapter.file]?.gdocId;
      return gdocId
        ? { ...chapter, gdocUrl: `https://docs.google.com/document/d/${gdocId}/edit` }
        : chapter;
    });
    const driveFolderId = manifest.config?.driveFolderId;
    return {
      project: {
        id: project.id,
        name: project.name,
        path: project.path,
        label: project.label,
        driveFolderUrl: driveFolderId
          ? `https://drive.google.com/drive/folders/${driveFolderId}`
          : null
      },
      stages: STAGES,
      chapters,
      tasks: { openByChapter: taskCounts },
      ai: { total: aiEvents.length, byChapter: aiCounts }
    };
  }
});

defineOperation({
  name: 'project.scan',
  description:
    'Scan chapter source files: refresh word count/excerpt (plain parsing, no AI) and detect edits since the last scan with line-diff change magnitude; records file_edited timeline activities',
  input: z.object({ project_id: id }),
  handler: async ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    const changed = [];
    const missing = [];
    let scanned = 0;
    for (const chapter of store.listChapters(project.id)) {
      if (!chapter.file) continue;
      let content;
      try {
        content = await fs.readFile(path.join(project.path, chapter.file), 'utf8');
      } catch {
        missing.push({ chapter_id: chapter.id, file: chapter.file });
        continue;
      }
      scanned += 1;
      const stats = analyzeMarkdown(content);
      if (chapter.content_hash === stats.contentHash) continue;

      const previous = store.getChapterText(chapter.id);
      store.updateChapterStats(chapter.id, stats);
      store.setChapterText(chapter.id, content);
      if (chapter.content_hash === null && previous === null) continue; // first analysis

      const delta = diffStats(previous ?? '', content);
      store.addActivity(project.id, {
        type: 'file_edited',
        chapterId: chapter.id,
        data: {
          file: chapter.file,
          linesAdded: delta.linesAdded,
          linesRemoved: delta.linesRemoved,
          wordCount: stats.wordCount
        }
      });
      changed.push({
        chapter_id: chapter.id,
        title: chapter.title,
        linesAdded: delta.linesAdded,
        linesRemoved: delta.linesRemoved,
        wordCount: stats.wordCount
      });
    }
    return { scanned, changed, missing };
  }
});

/* ------------------------------- chapters ------------------------------- */

const stageKeys = STAGES.map(s => s.key);

defineOperation({
  name: 'chapter.create',
  description: 'Create a chapter on the board',
  input: z.object({
    project_id: id,
    title: z.string().min(1),
    stage: z.enum(stageKeys).optional(),
    notes: z.string().optional(),
    file: z.string().nullable().optional()
  }),
  handler: ({ store }, { project_id, ...fields }) => {
    projectOf(store, project_id);
    const chapter = store.createChapter(project_id, fields);
    store.addActivity(project_id, {
      type: 'chapter_created',
      chapterId: chapter.id,
      data: { title: chapter.title }
    });
    return chapter;
  }
});

defineOperation({
  name: 'chapter.update',
  description: "Update a chapter's title, notes, or linked file",
  input: z.object({
    project_id: id,
    chapter_id: id,
    title: z.string().min(1).optional(),
    notes: z.string().optional(),
    file: z.string().nullable().optional()
  }),
  handler: ({ store }, { project_id, chapter_id, ...fields }) => {
    chapterIn(store, project_id, chapter_id);
    return store.updateChapter(chapter_id, fields);
  }
});

defineOperation({
  name: 'chapter.move',
  description: 'Move a chapter to a stage and position on the board',
  input: z.object({
    project_id: id,
    chapter_id: id,
    stage: z.enum(stageKeys),
    index: z.coerce.number().int().min(0).optional()
  }),
  handler: ({ store }, { project_id, chapter_id, stage, index }) => {
    chapterIn(store, project_id, chapter_id);
    return store.moveChapter(chapter_id, stage, index);
  }
});

defineOperation({
  name: 'chapter.delete',
  description: 'Delete a chapter (its file on disk is untouched)',
  input: z.object({ project_id: id, chapter_id: id }),
  handler: ({ store }, { project_id, chapter_id }) => {
    chapterIn(store, project_id, chapter_id);
    store.deleteChapter(chapter_id);
    return { deleted: true };
  }
});

defineOperation({
  name: 'chapter.import',
  description:
    'Seed chapters from content/*.md (drafts/notes excluded), with text stats; idempotent by linked file',
  input: z.object({ project_id: id }),
  handler: async ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    const contentDir = path.join(project.path, 'content');
    let files;
    try {
      files = filterExcludedFiles(await getAllMarkdownFiles(contentDir));
    } catch {
      throw new OperationError('no content/ directory in this project', 400);
    }
    const linked = store.linkedFiles(project.id);
    const imported = [];
    for (const file of files) {
      const relative = path.relative(project.path, file);
      if (linked.has(relative)) continue;
      const content = await fs.readFile(file, 'utf8');
      const stats = analyzeMarkdown(content);
      const chapter = store.createChapter(project.id, {
        title: stats.title || path.basename(file, '.md'),
        stage: 'drafting',
        file: relative
      });
      store.updateChapterStats(chapter.id, stats);
      store.setChapterText(chapter.id, content);
      store.addActivity(project.id, {
        type: 'chapter_created',
        chapterId: chapter.id,
        data: { title: chapter.title, imported: true }
      });
      imported.push(store.getChapter(chapter.id));
    }
    return { imported: imported.length, chapters: imported };
  }
});

/* -------------------------------- tasks --------------------------------- */

defineOperation({
  name: 'task.list',
  description: "List a project's tasks (open first)",
  input: z.object({ project_id: id }),
  handler: ({ store }, { project_id }) => {
    projectOf(store, project_id);
    return { tasks: store.listTasks(project_id) };
  }
});

defineOperation({
  name: 'task.list_open',
  description: 'List open tasks across all projects, with project and chapter names',
  input: z.object({}),
  handler: ({ store }) => ({ tasks: store.listAllOpenTasks() })
});

defineOperation({
  name: 'task.create',
  description: 'Create a task, optionally attached to a chapter',
  input: z.object({
    project_id: id,
    text: z.string().min(1),
    chapter_id: id.optional()
  }),
  handler: ({ store }, { project_id, text, chapter_id }) => {
    projectOf(store, project_id);
    if (chapter_id) chapterIn(store, project_id, chapter_id);
    const task = store.createTask(project_id, { text, chapterId: chapter_id ?? null });
    store.addActivity(project_id, {
      type: 'task_created',
      chapterId: chapter_id ?? null,
      data: { text: task.text }
    });
    return task;
  }
});

defineOperation({
  name: 'task.update',
  description: "Update a task's text or done state",
  input: z.object({
    project_id: id,
    task_id: id,
    text: z.string().min(1).optional(),
    done: z.boolean().optional()
  }),
  handler: ({ store }, { project_id, task_id, ...fields }) => {
    const task = store.getTask(task_id);
    if (!task || task.project_id !== project_id) throw new OperationError('task not found', 404);
    const updated = store.updateTask(task_id, fields);
    if (fields.done === true && !task.done) {
      store.addActivity(project_id, {
        type: 'task_completed',
        chapterId: task.chapter_id,
        data: { text: task.text }
      });
    }
    return updated;
  }
});

defineOperation({
  name: 'task.delete',
  description: 'Delete a task',
  input: z.object({ project_id: id, task_id: id }),
  handler: ({ store }, { project_id, task_id }) => {
    const task = store.getTask(task_id);
    if (!task || task.project_id !== project_id) throw new OperationError('task not found', 404);
    store.deleteTask(task_id);
    return { deleted: true };
  }
});

/* ------------------------------- editions ------------------------------- */

defineOperation({
  name: 'edition.list',
  description: "List a project's editions with chapter counts",
  input: z.object({ project_id: id }),
  handler: ({ store }, { project_id }) => {
    projectOf(store, project_id);
    return { editions: store.listEditions(project_id) };
  }
});

defineOperation({
  name: 'edition.create',
  description:
    'Create an edition — an ordered selection of chapters forming one version of the work',
  input: z.object({ project_id: id, name: z.string().min(1), description: z.string().optional() }),
  handler: ({ store }, { project_id, ...fields }) => {
    projectOf(store, project_id);
    const edition = store.createEdition(project_id, fields);
    store.addActivity(project_id, { type: 'edition_created', data: { name: edition.name } });
    return edition;
  }
});

function editionIn(store, projectId, editionId) {
  const edition = store.getEdition(editionId);
  if (!edition || edition.project_id !== projectId) {
    throw new OperationError('edition not found', 404);
  }
  return edition;
}

defineOperation({
  name: 'edition.get',
  description: 'An edition with its ordered chapters',
  input: z.object({ project_id: id, edition_id: id }),
  handler: ({ store }, { project_id, edition_id }) => {
    const edition = editionIn(store, project_id, edition_id);
    return { edition, chapters: store.listEditionChapters(edition.id) };
  }
});

defineOperation({
  name: 'edition.update',
  description: "Update an edition's name or description",
  input: z.object({
    project_id: id,
    edition_id: id,
    name: z.string().min(1).optional(),
    description: z.string().optional()
  }),
  handler: ({ store }, { project_id, edition_id, ...fields }) => {
    editionIn(store, project_id, edition_id);
    return store.updateEdition(edition_id, fields);
  }
});

defineOperation({
  name: 'edition.delete',
  description: 'Delete an edition (chapters themselves are untouched)',
  input: z.object({ project_id: id, edition_id: id }),
  handler: ({ store }, { project_id, edition_id }) => {
    editionIn(store, project_id, edition_id);
    store.deleteEdition(edition_id);
    return { deleted: true };
  }
});

defineOperation({
  name: 'edition.set_chapters',
  description: "Replace an edition's ordered chapter membership",
  input: z.object({ project_id: id, edition_id: id, chapter_ids: z.array(id) }),
  handler: ({ store }, { project_id, edition_id, chapter_ids }) => {
    editionIn(store, project_id, edition_id);
    return { chapters: store.setEditionChapters(edition_id, chapter_ids) };
  }
});

/* ------------------------------ collections ------------------------------ */

defineOperation({
  name: 'collection.list',
  description: 'List collections (a collection aggregates projects, e.g. short stories)',
  input: z.object({}),
  handler: ({ store }) => ({ collections: store.listCollections() })
});

defineOperation({
  name: 'collection.create',
  description: 'Create a collection',
  input: z.object({ name: z.string().min(1), description: z.string().optional() }),
  handler: ({ store }, input) => store.createCollection(input)
});

function collectionOf(store, collectionId) {
  return must(store.getCollection(collectionId), 'collection');
}

defineOperation({
  name: 'collection.get',
  description: 'A collection with its ordered member projects and editions',
  input: z.object({ collection_id: id }),
  handler: ({ store }, { collection_id }) => {
    const collection = collectionOf(store, collection_id);
    return {
      collection,
      projects: store.listCollectionProjects(collection.id),
      editions: store.listCollectionEditions(collection.id),
      allProjects: store.listProjects()
    };
  }
});

defineOperation({
  name: 'collection.update',
  description: "Update a collection's name or description",
  input: z.object({
    collection_id: id,
    name: z.string().min(1).optional(),
    description: z.string().optional()
  }),
  handler: ({ store }, { collection_id, ...fields }) => {
    collectionOf(store, collection_id);
    return store.updateCollection(collection_id, fields);
  }
});

defineOperation({
  name: 'collection.delete',
  description: 'Delete a collection (member projects are untouched)',
  input: z.object({ collection_id: id }),
  handler: ({ store }, { collection_id }) => {
    collectionOf(store, collection_id);
    store.deleteCollection(collection_id);
    return { deleted: true };
  }
});

defineOperation({
  name: 'collection.set_projects',
  description: "Replace a collection's ordered project membership",
  input: z.object({ collection_id: id, project_ids: z.array(id) }),
  handler: ({ store }, { collection_id, project_ids }) => {
    collectionOf(store, collection_id);
    return { projects: store.setCollectionProjects(collection_id, project_ids) };
  }
});

defineOperation({
  name: 'collection.create_edition',
  description: 'Create a collection edition — an ordered selection of member stories',
  input: z.object({
    collection_id: id,
    name: z.string().min(1),
    description: z.string().optional()
  }),
  handler: ({ store }, { collection_id, ...fields }) => {
    collectionOf(store, collection_id);
    return store.createCollectionEdition(collection_id, fields);
  }
});

function collectionEditionIn(store, collectionId, editionId) {
  const edition = store.getCollectionEdition(editionId);
  if (!edition || edition.collection_id !== collectionId) {
    throw new OperationError('edition not found', 404);
  }
  return edition;
}

defineOperation({
  name: 'collection.get_edition',
  description: 'A collection edition with its ordered stories',
  input: z.object({ collection_id: id, edition_id: id }),
  handler: ({ store }, { collection_id, edition_id }) => {
    const edition = collectionEditionIn(store, collection_id, edition_id);
    return { edition, projects: store.listCollectionEditionProjects(edition.id) };
  }
});

defineOperation({
  name: 'collection.delete_edition',
  description: 'Delete a collection edition',
  input: z.object({ collection_id: id, edition_id: id }),
  handler: ({ store }, { collection_id, edition_id }) => {
    collectionEditionIn(store, collection_id, edition_id);
    store.deleteCollectionEdition(edition_id);
    return { deleted: true };
  }
});

defineOperation({
  name: 'collection.set_edition_projects',
  description: "Replace a collection edition's ordered story membership (members only)",
  input: z.object({ collection_id: id, edition_id: id, project_ids: z.array(id) }),
  handler: ({ store }, { collection_id, edition_id, project_ids }) => {
    collectionEditionIn(store, collection_id, edition_id);
    return { projects: store.setCollectionEditionProjects(edition_id, project_ids) };
  }
});

/* -------------------------------- reviews -------------------------------- */

async function storeReviewFile(fileName, fileBase64) {
  const safe = fileName.replace(/[^\w.\- ]/g, '_');
  const reviewsDir = path.join(getDataDir(), 'reviews');
  await fs.mkdir(reviewsDir, { recursive: true });
  const file = path.join('reviews', `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  await fs.writeFile(path.join(getDataDir(), file), Buffer.from(fileBase64, 'base64'));
  return file;
}

defineOperation({
  name: 'review.request',
  description:
    'Send a chapter or an edition for review: records the request (status "sent") with reviewer name/email and an optional note of what was asked; feedback arrives later via review.receive',
  input: z.object({
    project_id: id,
    chapter_id: id.optional(),
    edition_id: id.optional(),
    reviewer_name: z.string().min(1),
    reviewer_email: z.string().email(),
    request_note: z.string().optional()
  }),
  handler: ({ store }, input) => {
    const project = projectOf(store, input.project_id);
    if (input.chapter_id) chapterIn(store, project.id, input.chapter_id);
    if (input.edition_id) editionIn(store, project.id, input.edition_id);
    const review = store.createReview(project.id, {
      chapterId: input.chapter_id ?? null,
      editionId: input.edition_id ?? null,
      reviewerName: input.reviewer_name,
      reviewerEmail: input.reviewer_email,
      status: 'sent',
      requestNote: input.request_note ?? ''
    });
    store.addActivity(project.id, {
      type: 'review_sent',
      chapterId: input.chapter_id ?? null,
      data: { reviewer: input.reviewer_name, edition_id: input.edition_id ?? null }
    });
    return review;
  }
});

defineOperation({
  name: 'review.receive',
  description:
    'Record received feedback: fulfil a sent review by review_id, or record unsolicited feedback by target + reviewer; text and/or an attached file (base64); records a review_received timeline activity',
  input: z.object({
    project_id: id,
    review_id: id.optional(),
    chapter_id: id.optional(),
    edition_id: id.optional(),
    reviewer_name: z.string().min(1).optional(),
    reviewer_email: z.string().email().optional(),
    body: z.string().optional(),
    file_name: z.string().optional(),
    file_base64: z.string().max(14_000_000).optional()
  }),
  handler: async ({ store }, input) => {
    const project = projectOf(store, input.project_id);
    let file = null;
    if (input.file_base64) {
      if (!input.file_name) throw new OperationError('file_name is required with file_base64');
      file = await storeReviewFile(input.file_name, input.file_base64);
    }

    let review;
    if (input.review_id) {
      const existing = store.getReview(input.review_id);
      if (!existing || existing.project_id !== project.id) {
        throw new OperationError('review not found', 404);
      }
      review = store.receiveReview(input.review_id, { body: input.body, file });
    } else {
      if (!input.reviewer_name || !input.reviewer_email) {
        throw new OperationError(
          'reviewer_name and reviewer_email are required for unsolicited feedback'
        );
      }
      if (input.chapter_id) chapterIn(store, project.id, input.chapter_id);
      if (input.edition_id) editionIn(store, project.id, input.edition_id);
      review = store.createReview(project.id, {
        chapterId: input.chapter_id ?? null,
        editionId: input.edition_id ?? null,
        reviewerName: input.reviewer_name,
        reviewerEmail: input.reviewer_email,
        status: 'received',
        body: input.body ?? '',
        file
      });
    }
    store.addActivity(project.id, {
      type: 'review_received',
      chapterId: review.chapter_id,
      data: {
        reviewer: review.reviewer_name,
        edition_id: review.edition_id,
        hasFile: !!review.file
      }
    });
    return review;
  }
});

defineOperation({
  name: 'review.list',
  description: "List a project's reviews with target chapter/edition names",
  input: z.object({ project_id: id }),
  handler: ({ store }, { project_id }) => {
    projectOf(store, project_id);
    return { reviews: store.listReviews(project_id) };
  }
});

defineOperation({
  name: 'review.delete',
  description: 'Delete a review record (an attached file stays in ~/.draftsync/reviews)',
  input: z.object({ project_id: id, review_id: id }),
  handler: ({ store }, { project_id, review_id }) => {
    const review = store.getReview(review_id);
    if (!review || review.project_id !== project_id) {
      throw new OperationError('review not found', 404);
    }
    store.deleteReview(review_id);
    return { deleted: true };
  }
});

/* -------------------------------- timeline ------------------------------- */

defineOperation({
  name: 'timeline.list',
  description:
    'Project or chapter timeline: polymorphic activities (file_edited, review_received, task_created, task_completed, chapter_created, edition_created), newest first',
  input: z.object({
    project_id: id,
    chapter_id: id.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
  }),
  handler: ({ store }, { project_id, chapter_id, limit }) => {
    projectOf(store, project_id);
    return {
      activities: store.listActivities(project_id, { chapterId: chapter_id ?? null, limit })
    };
  }
});

defineOperation({
  name: 'activity.stream',
  description:
    'Unified time-ordered stream: timeline activities plus AI ledger events, newest first. Scoped to a project, or global across all projects when project_id is omitted',
  input: z.object({
    project_id: id.optional(),
    limit: z.coerce.number().int().min(1).max(500).optional()
  }),
  handler: ({ store }, { project_id, limit = 100 }) => {
    let activities;
    let aiEvents;
    if (project_id) {
      const project = projectOf(store, project_id);
      const titles = new Map(store.listChapters(project.id).map(c => [c.id, c.title]));
      activities = store
        .listActivities(project.id, { limit })
        .map(a => ({ ...a, projectName: null }));
      aiEvents = store
        .listAiEvents(project.id)
        .map(e => ({ ...e, projectName: null, chapterTitle: titles.get(e.chapter_id) ?? null }));
    } else {
      activities = store.listAllActivities(limit);
      aiEvents = store.listAllAiEvents();
    }
    const stream = [
      ...activities.map(a => ({
        kind: a.type,
        at: a.created_at,
        chapter_id: a.chapter_id,
        chapterTitle: a.chapterTitle,
        projectName: a.projectName ?? null,
        project_id: a.project_id ?? project_id,
        data: a.data
      })),
      ...aiEvents.map(e => ({
        kind: 'ai_event',
        at: e.occurred_at || e.created_at,
        chapter_id: e.chapter_id,
        chapterTitle: e.chapterTitle ?? null,
        projectName: e.projectName ?? null,
        project_id: e.project_id ?? project_id,
        data: {
          provider: e.provider,
          source: e.source,
          purpose: e.purpose,
          model: e.model,
          url: e.url,
          justification: e.justification
        }
      }))
    ]
      .sort((x, y) => String(y.at ?? '').localeCompare(String(x.at ?? '')))
      .slice(0, limit);
    return { stream, seenAt: store.getSetting(seenKey(project_id)) };
  }
});

/** Settings key for the activity seen-cursor of a scope */
function seenKey(projectId) {
  return projectId ? `activity_seen:${projectId}` : 'activity_seen:global';
}

/**
 * Current timestamp for the seen-cursor, with subsecond precision so a
 * cursor set now sorts after every existing second-precision event row.
 * (Events landing within the same second after marking seen can be
 * missed — a ≤1s window, acceptable for a single-user app.)
 */
function nowStamp(store) {
  return store.db.prepare("SELECT datetime('now', 'subsec') AS at").get().at;
}

defineOperation({
  name: 'activity.mark_seen',
  description:
    'Mark the activity stream as read for a scope (a project, or global when project_id is omitted) — moves the seen-cursor to now',
  input: z.object({ project_id: id.optional() }),
  handler: ({ store }, { project_id }) => {
    if (project_id) projectOf(store, project_id);
    const at = nowStamp(store);
    store.setSetting(seenKey(project_id), at);
    return { seenAt: at };
  }
});

defineOperation({
  name: 'activity.unseen',
  description:
    'Count of activity-stream items newer than the seen-cursor for a scope — the notification badge number',
  input: z.object({ project_id: id.optional() }),
  handler: ({ store }, { project_id }) => {
    if (project_id) projectOf(store, project_id);
    const seenAt = store.getSetting(seenKey(project_id));
    // No cursor yet (never opened the panel): calm, nothing counts as new
    if (!seenAt) return { count: 0, seenAt: null };
    const acts = project_id
      ? store.db
          .prepare('SELECT COUNT(*) AS n FROM activities WHERE project_id = ? AND created_at > ?')
          .get(project_id, seenAt).n
      : store.db.prepare('SELECT COUNT(*) AS n FROM activities WHERE created_at > ?').get(seenAt).n;
    const ai = project_id
      ? store.db
          .prepare(
            'SELECT COUNT(*) AS n FROM ai_events WHERE project_id = ? AND COALESCE(occurred_at, created_at) > ?'
          )
          .get(project_id, seenAt).n
      : store.db
          .prepare(
            'SELECT COUNT(*) AS n FROM ai_events WHERE COALESCE(occurred_at, created_at) > ?'
          )
          .get(seenAt).n;
    return { count: acts + ai, seenAt: seenAt || null };
  }
});

defineOperation({
  name: 'edition.list_all',
  description: 'All editions across every project, with project names and chapter counts',
  input: z.object({}),
  handler: ({ store }) => ({ editions: store.listAllEditions() })
});

defineOperation({
  name: 'google.status',
  description:
    'Google Drive integration status: whether an OAuth client is available (bundled with the app, or a developer credentials file) and whether the user has connected (token cached in ~/.draftsync/)',
  input: z.object({}),
  handler: async () => {
    const check = async f => {
      try {
        await fs.access(f);
        return true;
      } catch {
        return false;
      }
    };
    return {
      client: await hasGoogleClient(),
      token: await check(getTokenPath()),
      credentialsPath: getCredentialsPath(),
      dataDir: getDataDir()
    };
  }
});

defineOperation({
  name: 'google.connect',
  description:
    'Start the Google OAuth flow (opens the consent page in the browser on the machine running draftsync); caches the token centrally',
  input: z.object({}),
  handler: async () => {
    await authenticate({ forceLogin: false });
    return { connected: true };
  }
});

/* ------------------------------- AI events ------------------------------- */

defineOperation({
  name: 'ai.list_events',
  description: "A project's AI usage ledger and the recognized purposes",
  input: z.object({ project_id: id }),
  handler: ({ store }, { project_id }) => {
    projectOf(store, project_id);
    return { events: store.listAiEvents(project_id), purposes: AI_PURPOSES };
  }
});

defineOperation({
  name: 'ai.log_event',
  description:
    'Log AI usage: a chat-session URL (claude.ai / chatgpt.com auto-detects provider) or a manual event; prose-suggestion requires a justification',
  input: z.object({
    project_id: id,
    url: z.string().url().optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    purpose: z.enum(AI_PURPOSES),
    justification: z.string().optional(),
    chapter_id: id.optional(),
    file: z.string().optional()
  }),
  handler: ({ store }, input) => {
    const project = projectOf(store, input.project_id);
    const provider = input.provider || (input.url && providerFromUrl(input.url));
    if (!provider) {
      throw new OperationError('provider required (or a claude.ai / chatgpt.com URL)');
    }
    if (input.purpose === 'prose-suggestion' && !input.justification) {
      throw new OperationError('prose-suggestion requires a justification (AI policy)');
    }
    let file = input.file ?? null;
    if (input.chapter_id) {
      const chapter = chapterIn(store, project.id, input.chapter_id);
      file = file || chapter.file;
    }
    const { event } = store.upsertAiEvent(project.id, {
      sessionKey: input.url || `manual:${crypto.randomUUID()}`,
      provider,
      source: input.url ? 'chat-link' : 'manual',
      url: input.url || null,
      model: input.model || null,
      chapterId: input.chapter_id ?? null,
      file,
      purpose: input.purpose,
      justification: input.justification || ''
    });
    return event;
  }
});

defineOperation({
  name: 'ai.delete_event',
  description: 'Delete an AI ledger event',
  input: z.object({ project_id: id, event_id: id }),
  handler: ({ store }, { project_id, event_id }) => {
    const event = store.getAiEvent(event_id);
    if (!event || event.project_id !== project_id) {
      throw new OperationError('event not found', 404);
    }
    store.deleteAiEvent(event_id);
    return { deleted: true };
  }
});

defineOperation({
  name: 'ai.ingest_claude',
  description:
    'Ingest local Claude Code transcripts for a project into the AI ledger (idempotent by session)',
  input: z.object({ project_id: id }),
  handler: async ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    return ingestClaudeCode(store, project.id, project.path);
  }
});

defineOperation({
  name: 'ai.report',
  description: 'The Markdown AI-disclosure report for a project',
  input: z.object({ project_id: id }),
  handler: ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    return { markdown: buildAiReport(store, project) };
  }
});

/* ------------------------------- metadata -------------------------------- */

defineOperation({
  name: 'metadata.get',
  description: "A project's templates/metadata.yaml content",
  input: z.object({ project_id: id }),
  handler: async ({ store }, { project_id }) => {
    const project = projectOf(store, project_id);
    try {
      return {
        content: await fs.readFile(path.join(project.path, 'templates', 'metadata.yaml'), 'utf8'),
        exists: true
      };
    } catch {
      return { content: '', exists: false };
    }
  }
});

defineOperation({
  name: 'metadata.set',
  description: "Write a project's templates/metadata.yaml (the file stays the source of truth)",
  input: z.object({ project_id: id, content: z.string() }),
  handler: async ({ store }, { project_id, content }) => {
    const project = projectOf(store, project_id);
    const templatesDir = path.join(project.path, 'templates');
    await fs.mkdir(templatesDir, { recursive: true });
    await fs.writeFile(path.join(templatesDir, 'metadata.yaml'), content, 'utf8');
    return { saved: true };
  }
});

/* -------------------------------- exports -------------------------------- */

defineOperation({
  name: 'export.project',
  description:
    'Build the manuscript (or one edition of it) as EPUB/DOCX/PDF; returns the built file path',
  input: z.object({
    project_id: id,
    format: z.enum(EXPORT_FORMATS),
    edition_id: id.optional()
  }),
  handler: async ({ store }, { project_id, format, edition_id }) => {
    const project = projectOf(store, project_id);
    const metadataPath = path.join(project.path, 'templates', 'metadata.yaml');
    let mdFiles;
    let outputName = project.name;
    if (edition_id) {
      const edition = editionIn(store, project.id, edition_id);
      outputName = `${project.name} - ${edition.name}`;
      mdFiles = store
        .listEditionChapters(edition.id)
        .filter(c => c.file)
        .map(c => path.join(project.path, c.file));
      if (mdFiles.length === 0) {
        throw new OperationError('this edition has no chapters with linked files', 500);
      }
    } else {
      mdFiles = await getFilesToBuild({
        contentDir: path.join(project.path, 'content'),
        metadataPath
      });
      if (mdFiles.length === 0) {
        throw new OperationError('no Markdown files to build in content/', 500);
      }
    }
    const metadata = await accessOrNull(metadataPath);
    const cssFile = await accessOrNull(path.join(project.path, 'templates', 'epub.css'));
    const output = path.join(project.path, 'dist', `${outputName}.${EXPORT_EXT[format]}`);
    await convertFiles(format, mdFiles, output, metadata, cssFile);
    return { path: output, filename: path.basename(output), format };
  }
});

defineOperation({
  name: 'export.collection',
  description:
    'Build a collection anthology (or one collection edition) as EPUB/DOCX/PDF; returns the built file path',
  input: z.object({
    collection_id: id,
    format: z.enum(EXPORT_FORMATS),
    edition_id: id.optional()
  }),
  handler: async ({ store }, { collection_id, format, edition_id }) => {
    const collection = collectionOf(store, collection_id);
    const edition = edition_id ? collectionEditionIn(store, collection.id, edition_id) : null;
    const projects = edition
      ? store.listCollectionEditionProjects(edition.id)
      : store.listCollectionProjects(collection.id);
    const mdFiles = [];
    for (const project of projects) {
      try {
        mdFiles.push(
          ...(await getFilesToBuild({
            contentDir: path.join(project.path, 'content'),
            metadataPath: path.join(project.path, 'templates', 'metadata.yaml')
          }))
        );
      } catch {
        // story with no content/ — skipped
      }
    }
    if (mdFiles.length === 0) {
      throw new OperationError('no buildable stories in this collection', 500);
    }
    const exportsDir = path.join(getDataDir(), 'exports');
    await fs.mkdir(exportsDir, { recursive: true });
    const outputName = edition ? `${collection.name} - ${edition.name}` : collection.name;
    const metadataPath = path.join(exportsDir, `${outputName}.meta.yaml`);
    await fs.writeFile(
      metadataPath,
      `title: ${JSON.stringify(outputName)}\n` +
        (collection.description ? `description: ${JSON.stringify(collection.description)}\n` : ''),
      'utf8'
    );
    const output = path.join(exportsDir, `${outputName}.${EXPORT_EXT[format]}`);
    await convertFiles(format, mdFiles, output, metadataPath);
    return { path: output, filename: path.basename(output), format };
  }
});
