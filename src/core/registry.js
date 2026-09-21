/**
 * Operation Registry (ADR 0001)
 *
 * Every draftsync capability is defined once as an operation:
 * { name, description, input (zod schema), handler(ctx, input) }.
 * The HTTP server, the CLI, and the MCP server are thin adapters over
 * this registry — a new operation appears in all of them by
 * construction. `ctx` carries the environment (today: the local store;
 * in a future cloud deployment, an HTTP-backed implementation).
 */

import { z } from 'zod';

const operations = new Map();

/**
 * Error thrown by operations, carrying an HTTP-ish status
 */
export class OperationError extends Error {
  /**
   * @param {string} message - Actionable description
   * @param {number} [status=400] - 400 bad input, 404 missing, 500 internal
   */
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Register an operation
 *
 * @param {Object} def - {name, description, input (zod object schema), handler}
 */
export function defineOperation(def) {
  const { name, description, input, handler } = def;
  if (!name || !description || !input || typeof handler !== 'function') {
    throw new Error(`invalid operation definition: ${name || '(unnamed)'}`);
  }
  if (operations.has(name)) {
    throw new Error(`duplicate operation: ${name}`);
  }
  operations.set(name, def);
}

/**
 * List registered operations (for adapters and docs)
 *
 * @returns {Array<Object>} Operation definitions
 */
export function listOperations() {
  return [...operations.values()];
}

/**
 * Execute an operation by name with validated input
 *
 * @param {string} name - Operation name (e.g. "chapter.create")
 * @param {Object} ctx - Environment context ({store, ...})
 * @param {Object} [input] - Raw input, validated against the op's schema
 * @returns {Promise<*>} The operation's result
 * @throws {OperationError} unknown_operation (404) or validation (400)
 */
export async function execute(name, ctx, input = {}) {
  const op = operations.get(name);
  if (!op) {
    throw new OperationError(`unknown operation: ${name}`, 404);
  }
  const parsed = op.input.safeParse(input);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(i => `${i.path.join('.') || '(input)'}: ${i.message}`)
      .join('; ');
    throw new OperationError(`invalid input for ${name} — ${issues}`, 400);
  }
  try {
    return await op.handler(ctx, parsed.data);
  } catch (error) {
    if (error instanceof OperationError) throw error;
    // Store-layer validation errors surface as bad input
    throw new OperationError(error.message, 400);
  }
}

/**
 * Build an OpenAPI 3.1 document describing every operation as an RPC
 * endpoint (POST /api/op/{name}), schemas derived from zod
 *
 * @param {Object} [info] - Overrides for the info block
 * @returns {Object} OpenAPI document
 */
export function buildOpenApiDocument(info = {}) {
  const paths = {};
  for (const op of listOperations()) {
    paths[`/api/op/${op.name}`] = {
      post: {
        operationId: op.name.replace(/\./g, '_'),
        summary: op.description,
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: z.toJSONSchema(op.input) }
          }
        },
        responses: {
          200: { description: 'Operation result (JSON)' },
          400: { description: 'Invalid input or domain error' },
          404: { description: 'Unknown operation or missing entity' }
        }
      }
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'draftsync API',
      description:
        'Every draftsync capability, exposed as named operations. ' +
        'Also available as resource-style routes and (planned) MCP tools.',
      version: '0.1.1',
      ...info
    },
    paths
  };
}
