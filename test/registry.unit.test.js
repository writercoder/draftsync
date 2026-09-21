/**
 * Unit tests for the operation registry (ADR 0001)
 */

import { describe, it, expect } from 'vitest';
import {
  execute,
  listOperations,
  buildOpenApiDocument,
  OperationError
} from '../src/core/registry.js';
import '../src/core/operations.js';

describe('Registry Unit Tests', () => {
  it('should register a substantial operation set', () => {
    const names = listOperations().map(op => op.name);
    for (const expected of [
      'project.list',
      'project.scan',
      'board.get',
      'chapter.create',
      'chapter.import',
      'task.create',
      'edition.set_chapters',
      'collection.create_edition',
      'review.create',
      'timeline.list',
      'ai.log_event',
      'metadata.set',
      'export.project',
      'export.collection'
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('should reject unknown operations with 404', async () => {
    await expect(execute('nope.nothing', {}, {})).rejects.toMatchObject({ status: 404 });
  });

  it('should reject invalid input with actionable messages', async () => {
    let error;
    try {
      await execute('chapter.create', {}, { project_id: 1 });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(OperationError);
    expect(error.status).toBe(400);
    expect(error.message).toContain('chapter.create');
    expect(error.message).toContain('title');
  });

  it('should build an OpenAPI document covering every operation', () => {
    const doc = buildOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    const paths = Object.keys(doc.paths);
    expect(paths.length).toBe(listOperations().length);
    const create = doc.paths['/api/op/chapter.create'].post;
    expect(create.operationId).toBe('chapter_create');
    const schema = create.requestBody.content['application/json'].schema;
    expect(schema.properties.title).toBeDefined();
  });
});
