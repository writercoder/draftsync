# Scope: the draftsync desktop app (Tauri shell)

Status: scoped for build, pending greenlight. Extends #20 and ADR 0001.
Companion to `story-as-objects.md` (independent).

## Shape

One architecture rule inherited from ADR 0001 and the watcher work:
**all product logic lives in the serve engine; the shell is chrome.**
The Tauri app contributes exactly four things a browser tab cannot:
process supervision, native menus, OS notifications, and an icon in
the dock/tray.

```
┌─ Tauri shell (Rust, ~10MB) ─────────────────────────┐
│  native menubar · tray · notifications · updater     │
│  WebView → http://127.0.0.1:<port>  (existing UI)    │
│  supervises ──▶ serve engine (Node sidecar binary)   │
└──────────────────────────────────────────────────────┘
```

- **Sidecar**: the Node engine packaged as a single binary (Node SEA or
  pkg), spawned/supervised by the shell. Engine picks a free port and
  writes `~/.draftsync/engine.json` (port, pid, version); the shell
  reads it. Single-instance: shell refuses to double-launch; a second
  `draftsync serve` from the CLI detects the running engine and just
  opens the browser.
- The web UI stays browser-compatible — CLI users keep `serve` +
  browser; the same pages detect the Tauri runtime (`window.__TAURI__`)
  and slim their in-page chrome when native menus are present.

## Data persistency — no cloud account, ever (hobbyist tier)

Nothing changes, and that is the point:

- All state stays where it lives today: `~/.draftsync/` (SQLite WAL
  database, exports, review files, Google token, settings) and the
  user's own project directories (markdown = source of truth).
- The app and the CLI share the same data — no import, no migration,
  no account, no telemetry. Time Machine and any folder backup tool
  cover it because it is just files.
- First run = the existing dashboard onboarding (Google Connect flow).
- Later niceties, not v1: an explicit "Back up draftsync data…" export
  (zip of ~/.draftsync minus token), and a data-location setting.

## Navigation in native menus, not web chrome

The categorized menus we designed for the board translate directly:

| Native menu                      | Items (→ existing actions/operations)                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| **draftsync**                    | About · Settings… (dashboard integrations) · Quit (stops engine)                   |
| **File**                         | New Project… · Add Existing Project… · Import Chapters · Close Window              |
| **Project** (enabled on a board) | Send for Review · Record Review · New Edition · New Task · Metadata · Log AI Usage |
| **Export**                       | EPUB · DOCX · PDF · Send to Kindle · Edition builds…                               |
| **View**                         | Projects (Home) · Toggle Tasks · Toggle Activity · Design System · Reload          |
| **Window / Help**                | standard                                                                           |

Mechanism: native menu events → Tauri event → the page dispatches to
the same handlers the buttons use. Prerequisite (small): expose the
UI's named actions on a `window.dsActions` registry so menu wiring is
declarative; when `__TAURI__` is present, hide the in-page Download/
Actions buttons and keep the panel toggles.

## Tray / menubar extra

- Engine status (running/port), unseen-activity count, Open draftsync,
  Pause watching, Quit.
- macOS dock badge = global unseen count (feeds off
  `activity.unseen`); tray is also the "start at login" home.

## Notifications

OS notifications via the Tauri notifications plugin, fed by the engine:
watcher-detected file edits, review received (esp. once #25 lands),
unacknowledged AI prose events. Respect the seen-cursor: notify only on
genuinely new items, never on the user's own in-app actions.

## Explicit non-goals for v1

Auto-update (later, with signing/#30-style decisions), multi-window,
custom titlebar theatrics, any reviewer-facing surface
(standing principle), any cloud account.

## Milestones

- **A — Tray supervisor** (small): tray app that starts/stops the
  engine, badge count, Open Dashboard. Ships value alone.
- **B — App window + native menus** (medium): WebView window,
  menu-to-action wiring, `dsActions` registry, chrome slimming.
- **C — Packaging** (medium): sidecar binary build, macOS signing +
  notarization, dmg; Windows/Linux best-effort.
- **D — Notifications & badges** (small): plugin wiring onto the
  cursor model.

A is independently useful and de-risks the sidecar; B is the product
moment; C is the distribution gate (pairs with #30's OAuth client).
