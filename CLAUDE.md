# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MonkeyGTD is a single-page, no-build, no-framework task manager/outliner (a Checkvist clone) built as plain HTML/CSS/JS. There is no bundler, no npm dependencies to install, and no transpilation step. `app.html` is the dev entry point; it loads every module as a classic (non-module) `<script src="js/...">` tag, so **all files share one global scope** — functions and constants defined in one file are called directly by name from later-loaded files. There are no `import`/`export`/`require`/`module.exports` in `js/**`. When adding a new file, wire it into the `<script>` list in `app.html` in the correct dependency position (see load order below) — otherwise the app or the standalone bundle will break with "X is not defined".

## Commands

```bash
npm test                 # run all tests (tests/unit + tests/integration)
npm run test:unit        # tests/unit only
npm run test:integration # tests/integration only
npm run check:standalone # verify monkeygtd-standalone.html matches current source
npm run check:test-policy # verify a PR's source changes are accompanied by test changes
npm run test:ci          # check:test-policy + full test run (what CI runs)
```

Run a single test file directly (test files are plain `node:test`, no Jest/Mocha):
```bash
node --test tests/unit/sort-priority-order.test.cjs
```

After editing `app.html`, `styles.css`, or any `js/**` file, regenerate the standalone bundle (Windows PowerShell required — this is checked in CI):
```bash
powershell -NoProfile -ExecutionPolicy Bypass -File ./inline-html.ps1
```
`check:standalone` fails CI if `monkeygtd-standalone.html` is stale relative to what `inline-html.ps1` would currently produce.

There is no lint/typecheck script in this repo.

## Test-first policy (enforced in CI, from `.github/copilot-instructions.md`)

- Any change to production behavior (`app.html`, `styles.css`, `js/**`) must land with unit/integration tests in the same change — `check:test-policy` fails a PR otherwise.
- Bug fixes need a regression test that fails before the fix and passes after; features need a happy-path test and an edge-case test.
- Tests live under `tests/unit/**` or `tests/integration/**`, named `*.test.cjs`/`*.test.js`/`*.spec.cjs`/`*.spec.js`.

### How tests load source (important, non-obvious)

Since `js/**` files are globals-only scripts with no exports, tests can't `require()` them directly. Instead tests read the file's source with `fs.readFileSync` and execute it inside a `node:vm` sandbox context, then pull out the specific function(s) under test as globals, e.g.:
```js
const sandbox = { console, JSON, Math, Date, now: () => '...' , prompt: () => '' };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('js/domain/task-ops.js', 'utf8'), sandbox);
vm.runInContext('globalThis.__exports = { applySortDomain };', sandbox);
const { applySortDomain } = sandbox.__exports;
```
Follow this pattern for new domain/infra tests. Provide minimal fakes for `app` (`pushUndo`, `snap`, `save`, `render`, `toast`, etc.) and `state` (`S`-shaped object with `data.tasks`/`data.lists`) rather than booting the whole app.

## Architecture

The codebase is mid-way through the SOLID/CQRS layering described in [refactor-phases.md](refactor-phases.md). Layers, in `app.html` script-load order (each layer may reference globals from earlier layers only):

1. **`js/core/`** — `cqrs.js` (generic `createCommandBus`/`createQueryService`: `Map`-based name→handler registries with `dispatch`/`select`), `traversal.js` (tree walking), `utils.js` (dates, escaping, id gen).
2. **`js/domain/`** — pure(ish) business logic operating on the in-memory `S` state object (task CRUD, tree ops, list ops, import/export, settings, clipboard, lifecycle). Domain functions take `(app, state, ...args)` explicitly rather than closing over globals, and must not touch the DOM.
3. **`js/application/`** — `command-registry.js` / `query-registry.js` register every domain operation as a named command/query on the CQRS bus (`registerAppCommands`, `registerAppReadModel`); `smoke-checks.js` is a manual console-driven smoke test runner (`App.runSmokeChecks()`).
4. **`js/infra/`** — concrete adapters: `storage.js` (`DB.get`/`DB.save` — the sole localStorage key is `mgtd3`), `gist-sync.js` and `repo-sync.js` (two alternate remote-persistence backends, selected via `settings.syncProvider`).
5. **`js/ui/`** — DOM-facing controllers (keyboard, modals, rendering, command palette, navigation, search, settings, chrome/toolbar, clipboard). UI controllers read via `App.select(...)` and write via `App.dispatch(...)`, or call domain functions directly for internal/programmatic paths (see dual-path pattern below).
6. **`js/app.js`** — the `App` singleton and `S` (mutable app state) object. Almost every `App` method is a one-line delegator to a domain/UI function, e.g. `addTask(...) { return addTaskDomain(this, S, ...) }`. `App.init()` is invoked at the bottom of the file, so `app.js` must load last.

### CQRS dispatch pattern

- Writes: `App.dispatch('task.delete', {id})` → looked up in the command bus registered by `command-registry.js` → calls the domain handler.
- Reads: `App.select('tasks.visible')` → query bus registered by `query-registry.js`.
- Many `App` methods have a **dual entry point**: an external call (`internal` falsy) goes through `dispatch`/reads a DOM form field, while `internal: true` calls the domain function directly with an explicit payload — used so the same logic serves both a keyboard shortcut/UI event and an internal batch/undo operation. When editing one of these methods, check both branches.
- Multi-selection actions (`deleteSelection`, `toggleStatusSelection`, `moveUpSelection`, etc. in `app.js`) wrap per-id domain calls in `App.withUndoBatch(fn)` so the whole batch is a single undo step.

### State & persistence

- All app data lives in one in-memory object `S.data` (`{ lists, tasks, settings, currentListId }`) plus transient UI state (`selId`, `msel`, `filter`, undo/redo stacks, etc.) on `S` itself — see the schema at the top of `js/app.js`.
- Tasks are stored flat in `S.data.tasks` keyed by id (not nested); hierarchy is `parent_id` + each task's own `tasks` (ordered child-id array) plus each list's `root_tasks`. The full JSON field schema is documented in [readMe.md](readMe.md) under "JSON Data Schema".
- `App.save(options)` persists `S.data` via `DB.save` (`infra/storage.js`) to `localStorage['mgtd3']`; pass `{ touchLocalSaveAt: false }` to skip bumping the `gistLastLocalSaveAt` timestamp used by sync conflict detection.
- Remote sync is optional and pluggable: `settings.syncProvider` is `'gist'` (GitHub Gist backend) or `'repo'` (GitHub repo file backend); each has its own auto-sync interval, inbox-file ingestion, and bidirectional merge logic in `js/infra/gist-sync.js` / `js/infra/repo-sync.js`. `App.syncNow()`/`checkSyncOnRefresh()`/`startSyncAuto()` dispatch to whichever provider is active.

### Deployment artifacts

- **`monkeygtd-standalone.html`** — single-file build (CSS + all JS inlined by `inline-html.ps1`) published to GitHub Pages via `.github/workflows/pages.yml` on push to `master`. Must be regenerated (see Commands) whenever source changes; CI enforces this via `check:standalone`.
- **`Inbox.html`** — a separate, self-contained static page (its own inline `<style>`, no shared JS with the main app) also deployed to Pages.
- **`scripts/send-task.py` / `send-task.cmd` / `send-task.ps1` / `send-gist-task.ps1`** — CLI helpers that enqueue a task into the Gist-based sync queue from the command line (auth via `MGTD_GIST_ID`/`MGTD_GIST_TOKEN` env vars); the app picks queued items up on its next sync.

### Design docs vs. implemented features

[Macros.md](Macros.md) and [Scripts.md](Scripts.md) are forward-looking feature specs (saved filtered views / bulk-action templates via `.macros/`/`.scripts/` folders) — **not yet implemented**; there is no `.macros/` or `.scripts/` folder or corresponding code in `js/**` today. Don't assume these exist when reading the codebase; treat them as design proposals if asked to implement related features.

[readMe.md](readMe.md) doubles as the full product/behavior spec (keyboard shortcuts, smart syntax, due-date rules, the JSON schema, etc.) for the Checkvist-like feature set this app implements — consult it for intended behavior of any keyboard shortcut, smart-syntax token, or search/filter query before changing related code.
