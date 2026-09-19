# Architecture

This document describes how draftsync is put together: the module layout, the
data flows, where state lives, and the conventions modules are expected to
follow. For contribution workflow and coding standards, see
[CONTRIBUTING.md](CONTRIBUTING.md).

## Overview

draftsync is a Node.js CLI (ESM, Node ≥ 18) that treats a directory of
Markdown files as the source of truth for a manuscript and moves content
between three worlds:

1. **Local Markdown** (`content/`) — where writing happens, under git
2. **Google Docs** — for editing/collaboration (push/pull sync)
3. **Published formats** — EPUB, Kindle preview, static HTML (build targets)

All format conversion is delegated to **Pandoc** as an external process;
draftsync itself never parses Markdown or DOCX.

## Module map

```
bin/draftsync.js          Entry point; calls run() from src/cli.js
src/
├── cli.js                Commander setup, one handler per command,
│                         user-facing output and error presentation
├── auth.js               Google OAuth2 desktop loopback flow, token cache
├── drive.js              Google Drive file operations (Drive v3)
│                         + manifest read/write helpers
├── docs.js               Google Docs formatting/content API (Docs v1)
├── pandoc.js             Pandoc process wrapper: md ⇄ docx, md → html,
│                         md → epub, epubcheck validation
├── file-filter.js        Selects which .md files go into a build
│                         (defaults, chapters list, include/exclude globs)
└── build/
    ├── epub.js           build:epub / check:epub pipelines
    ├── web.js            build:web pipeline (per-file HTML + index page)
    └── kdp.js            preview:kdp (launches Kindle Previewer)
```

Layering rules:

- `cli.js` orchestrates; it may import from any module.
- `build/*` may import `pandoc.js` and `file-filter.js`, never the Google
  modules.
- `auth.js`, `drive.js`, `docs.js` form the Google layer. `drive.js` and
  `docs.js` take an authenticated client as their first argument; only
  `auth.js` knows how credentials work.
- `pandoc.js` and `file-filter.js` are leaf utilities with no knowledge of
  the CLI or Google.

## Data flows

### Push (Markdown → Google Docs)

```
content/ch1.md ──pandoc──▶ dist/ch1.docx ──drive.js──▶ Google Doc
                                              │
             manifest (.draftsync.json) ◀─────┘ stores gdocId + lastSync
                                              │
                          docs.js ────────────┘ optional --format:
                                                manuscript formatting
```

### Pull (Google Docs → Markdown)

```
Google Doc ──drive.js export──▶ dist/ch1.docx ──pandoc──▶ content/ch1.md
```

The Doc must already be linked in the manifest (a prior push, or
`draftsync link` — though under the drive.file scope only draftsync-created
Docs are readable).

### Build (Markdown → EPUB / HTML)

```
content/*.md ──file-filter──▶ ordered file list ──pandoc──▶ dist/book.epub
                    ▲                                        dist/web/*.html
        templates/metadata.yaml
        (chapters / exclude lists)
```

File selection precedence (implemented in `file-filter.js`):

1. **`chapters:` list in metadata.yaml** — exact files, in the listed order;
   missing files warn and are skipped
2. **`--include` CLI patterns** — only matching files
3. **Otherwise all `.md` under `content/`** (recursive, sorted), minus
   default exclusions (`*.draft.md`, `*.notes.md`, `_*.md`, `drafts/**`,
   `notes/**`, `archive/**`, `README.md`), minus `exclude:` patterns from
   metadata.yaml, minus `--exclude` CLI patterns

## State

### The manifest: `.draftsync.json`

Lives in the project root of a _user's_ manuscript project (created by
`draftsync init`). It is the only persistent state draftsync keeps:

```json
{
  "version": "1.0",
  "files": {
    "content/ch1.md": { "gdocId": "...", "lastSync": "ISO-8601" }
  },
  "config": {
    "contentDir": "content",
    "distDir": "dist",
    "templatesDir": "templates"
  }
}
```

- `files` maps local paths to Google Doc IDs — the link table for sync.
- `config` is the **intended** source of truth for directory layout.

**Known gap:** the build modules currently hardcode `'content'` and
`'dist'` instead of reading `config`, and manifest I/O is implemented twice
(`loadManifest`/`saveManifest` in `cli.js`, `readManifest`/`writeManifest`
in `drive.js`). Direction: consolidate into a single `manifest.js` module
that all callers use, and have it supply the configured paths.

### Credentials

- `credentials.json` — OAuth2 client from Google Cloud Console (gitignored)
- `.token.json` — cached user token, refreshed automatically (gitignored)

## External tools

| Tool             | Used by       | Required?                  |
| ---------------- | ------------- | -------------------------- |
| Pandoc           | `pandoc.js`   | Yes, for all conversions   |
| epubcheck        | `check:epub`  | Optional; warns if missing |
| Kindle Previewer | `preview:kdp` | Optional; warns if missing |
| Google APIs      | sync layer    | Only for push/pull/format  |

Every Pandoc entry point first runs `checkPandocInstalled()` and throws a
message pointing at the install docs. Wrappers shell out via `exec` with
quoted paths and surface Pandoc's stderr as warnings.

## Error handling

Convention (target state — parts of the codebase predate it):

- **Leaf modules** (`pandoc.js`, `file-filter.js`, Google layer) never call
  `process.exit` and never print errors; they **throw `Error` with a
  user-actionable message**. Warnings (non-fatal, e.g. a missing chapter
  file) may `console.warn` and continue.
- **Command handlers** (`cli.js`, `build/*`) own presentation: catch errors,
  print via chalk/ora, add remediation hints (e.g. Pandoc install
  instructions), and set the exit code. A failed command should exit
  non-zero; missing _optional_ inputs (metadata, CSS) warn and continue.
- Expected absence of a file (`ENOENT`) is handled where it's expected
  (missing manifest → empty manifest; missing metadata → defaults);
  anything else propagates.

## Testing strategy

- **Unit tests** (`test/*.unit.test.js`) cover pure logic with no external
  processes: Pandoc argument builders, Docs API payload builders, manifest
  I/O (temp dirs), file filtering (temp dirs).
- **Integration tests** (`test/pandoc.integration.test.js`) invoke the real
  Pandoc binary; CI installs Pandoc so these always run there.
- **CLI tests** (`test/cli.push.dryrun.test.js`) run the actual binary via
  execa in `--dry-run` mode, asserting on output and exit codes without
  touching the network.
- **Google APIs** (once implemented) will be tested by mocking the
  `googleapis` client objects passed into `drive.js`/`docs.js` — which is
  why those modules take `auth`/clients as parameters instead of creating
  them internally.

## Known gaps

Tracked in the issue tracker; listed here so the doc doesn't overpromise:

- The Docs API cannot insert automatic page-number fields, so manuscript
  footers with page numbers are not applied by `--format` (documented in
  `src/docs.js`).
- With the `drive.file` scope, draftsync only sees Docs and folders it
  created — `pull` cannot read a pre-existing Doc linked manually.
- `build:web` uses its own non-recursive file listing and **does not apply
  the file-filter exclusions** — drafts and notes currently leak into web
  builds. It should switch to `getFilesToBuild()` (noted on #5).
- Build modules hardcode directory paths instead of reading manifest
  `config` (see "State" above).
- Manifest helpers are duplicated between `cli.js` and `drive.js`.
