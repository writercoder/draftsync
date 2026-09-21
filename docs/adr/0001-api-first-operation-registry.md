# ADR 0001: API-first via an operation registry (REST + MCP, not GraphQL)

Date: 2026-09-21 · Status: accepted

## Principle (from the maintainer)

Everything possible in the app can be performed via an API and the CLI.
In a future cloud version, the CLI performs API calls.

## Decision

1. **Single operation registry.** Every capability is defined once as
   `{ name, description, input (zod schema), handler(ctx, input) }` in
   `src/core/`. The HTTP server, the CLI, and the MCP server are thin
   adapters over the registry — a new operation appears in all three by
   construction. This is the command pattern in its useful, light form:
   operations as serializable data + one dispatch point; no GoF
   command-class/undo ceremony. Reads and writes both live in the
   registry (`project.list` vs `chapter.move`) without pretending reads
   need command semantics.
2. **ctx is the cloud seam.** Handlers receive a context (store, project
   resolution, Google auth, build tools). Local mode passes local
   implementations; the future cloud CLI passes a ctx backed by HTTP.
   Operations split into _pure-data_ ops (portable unchanged) and
   _environment_ ops (pandoc, filesystem, OAuth flow) behind ctx
   adapters implemented per deployment.
3. **REST, not GraphQL.** The model is small and stable, there is one
   user, and exports are binary downloads — GraphQL's costs (query
   runtime, resolvers, N+1 discipline, awkward binary handling) buy
   nothing here. The REST surface is generated/mapped from the registry
   and documented by a served OpenAPI document (`/api/openapi.json`)
   derived from the same schemas.
4. **Agent-friendliness = MCP first.** `draftsync mcp` exposes the
   registry as MCP tools (the official SDK consumes zod schemas
   directly). Agent tooling is built around function-calling against
   named operations with JSON schemas — MCP hands agents verbs, which
   beats making them compose GraphQL queries. OpenAPI covers non-MCP
   integrations.
5. **Validation with zod** (runtime validation is needed in plain JS
   anyway; converts to JSON Schema/OpenAPI; native to the MCP SDK;
   error messages are agent-readable).

## Consequences

- Route handlers in `serve.js` shrink to dispatch + content negotiation;
  CLI commands shrink to argument mapping; logic duplication between
  CLI and server (manifest reading, export building) collapses into
  operations.
- Every mutation flows through one choke point — the natural place for
  audit logging (dovetails with the AI-audit ledger).
- Migration is incremental: extract operations domain-by-domain
  (chapters/tasks first), keep routes stable, then generate OpenAPI,
  then add the MCP adapter. No big-bang rewrite.
