# Contributing to draftsync

Thank you for your interest in contributing to draftsync!

## Development Setup

1. Clone the repository
2. Install dependencies: `npm install`
3. Install Pandoc: `brew install pandoc` (or your platform's equivalent)
4. Run the CLI locally: `./bin/draftsync.js --help`

## Project Structure

```
draftsync/
├── bin/
│   └── draftsync.js          # CLI entry point
├── src/
│   ├── cli.js                # Command routing and main logic
│   ├── auth.js               # Google OAuth2 authentication
│   ├── drive.js              # Google Drive API operations
│   ├── docs.js               # Google Docs API operations
│   ├── pandoc.js             # Pandoc conversion wrapper
│   ├── file-filter.js        # Build file selection (globs, chapters lists)
│   └── build/
│       ├── epub.js           # EPUB build system
│       ├── web.js            # Web HTML export
│       └── kdp.js            # Kindle preview integration
├── templates/                # Default templates
├── test/                     # Vitest unit/integration tests
├── fixtures/                 # Test fixtures
└── content/                  # Example content directory
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the module layering rules, data
flows, and error-handling conventions — read it before adding a module or
changing how modules depend on each other.

## What to work on

Open work is tracked in
[GitHub Issues](https://github.com/writercoder/draftsync/issues). The
Google API integration (OAuth2, Drive, Docs) is the largest missing piece;
those issues are labeled `google-api`.

## Coding Standards

### Language and modules

- Plain JavaScript (no TypeScript), ES modules only (`"type": "module"`).
- Node ≥ 18. Don't add syntax or APIs newer than the oldest supported Node
  (CI runs 18/20/22).
- File names are kebab-case (`file-filter.js`). Use named exports; no
  default exports.
- Prefer `import { promises as fs } from 'fs'` over sync fs calls in
  library code (tests may use sync helpers for setup/teardown).

### JSDoc

- Every exported function gets a JSDoc block: one-sentence summary,
  `@param` with types, `@returns`. Match the style of the existing modules.
- Each source file starts with a short header comment describing the
  module's purpose.

### Error handling and CLI output

Follow the convention in ARCHITECTURE.md:

- Leaf modules **throw** `Error` with a user-actionable message; they never
  print errors or call `process.exit`. Non-fatal issues `console.warn` and
  continue.
- Command handlers **present**: catch errors, print them, add remediation
  hints, exit non-zero on failure.

Console color semantics (chalk):

| Style             | Meaning                             |
| ----------------- | ----------------------------------- |
| `chalk.blue.bold` | Command/section headers             |
| `chalk.green`     | Success (`✓ ...`)                   |
| `chalk.yellow`    | Warnings, dry-run banners           |
| `chalk.red`       | Errors (`✗ ...`)                    |
| `chalk.gray`      | Secondary detail, hints, next steps |

Use `ora` spinners for multi-step build pipelines (`start`/`succeed`/
`fail`/`warn`); use plain `console.log` for simple commands.

### Dependencies

- Keep the runtime dependency list small; this is an installable CLI.
- Anything imported from `src/` must be in `dependencies` (not
  `devDependencies`) — the lint setup checks this.

## Linting and formatting

ESLint and Prettier are enforced in CI; warnings are not tolerated (rules
are error-level so nothing accumulates silently).

```bash
npm run lint          # check
npm run lint:fix      # auto-fix
npm run format:check  # check formatting
npm run format        # fix formatting
```

Unused function parameters that are intentional (e.g. in stubs) should be
prefixed with `_`.

## Testing

```bash
npm test              # run all tests once
npm run test:watch    # watch mode
npm run test:coverage # with coverage (thresholds enforced in CI)
```

- New logic ships with unit tests (`test/<area>.unit.test.js`). Use temp
  directories (`mkdtempSync`) rather than writing into the repo.
- Tests that invoke external binaries (Pandoc) are integration tests
  (`test/<area>.integration.test.js`).
- CLI behavior is tested by running the real binary with execa in
  `--dry-run` mode — no network access in tests.
- Google API code must be structured so the client can be mocked (pass
  clients in as parameters; don't construct them deep inside functions).

Manual smoke test:

```bash
./bin/draftsync.js init
echo "# Test Chapter" > content/test.md
./bin/draftsync.js build:epub
```

Verify the EPUB output opens in a reader.

## Commits and branches

- Commit messages follow `type: brief description` with types `feat`,
  `fix`, `docs`, `refactor`, `test`, `chore`; add a body explaining _why_
  when it isn't obvious, and `Fixes #123` to close issues.
- Keep commits focused and atomic.
- Non-trivial changes go on a feature branch (`feature/my-feature` or
  `fix/issue-123`) with a PR; CI (lint, tests, formatting, all three Node
  versions) must be green before merge. Trivial docs/chore commits may land
  directly on `main` at the maintainer's discretion.

## Submitting a Pull Request

1. Fork the repository (or branch, if you have write access)
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make your changes, with tests
4. Run `npm run lint && npm test && npm run format:check`
5. Push and open a pull request referencing the issue it addresses

## Documentation

When adding features:

- Update README.md with new commands
- Add JSDoc comments to functions
- Update QUICKSTART.md if it affects basic usage
- Update ARCHITECTURE.md if module boundaries or data flows change

## Questions?

Open an issue for bug reports, feature requests, questions about the
codebase, or architecture discussion.

## Code of Conduct

Be respectful, inclusive, and constructive in all interactions.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
