const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const COMMIT_SHA = 'abc1234def5678abc1234def5678abc1234def56';

function loadRepoSyncModule(overrides = {}) {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/infra/repo-sync.js'), 'utf8');
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    setInterval,
    clearInterval,
    fetch: overrides.fetch || (async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => '' })),
    document: overrides.document || { getElementById: () => null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    Buffer
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__exports = { listRepoVersionsRemote, fetchRepoVersionRemote, restoreRepoVersionRemote, syncRepoBidirectionalRemote };`,
    sandbox,
    { filename: 'repo-sync.js' }
  );
  return sandbox.__exports;
}

function mkTask(id, extra = {}) {
  return {
    id, content: id, status: 0, checklist_id: 'l1', parent_id: '', tasks: [], tags: {}, tags_as_text: '',
    color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [],
    created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z', completed_at: '',
    deleted: false, _collapsed: false, ...extra
  };
}

function makeState() {
  return {
    data: {
      tasks: { cur1: mkTask('cur1'), cur2: mkTask('cur2') },
      lists: { l1: { id: 'l1', name: 'Current', root_tasks: ['cur1', 'cur2'] } },
      currentListId: 'l1',
      settings: {
        darkMode: false,
        syncProvider: 'repo',
        repoToken: 'token',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'main',
        repoPath: 'backups/monkeygtd-backup.json',
        gistLastLocalSaveAt: '2020-01-01T00:00:00.000Z',
        syncLastAt: '2020-01-01T00:00:00.000Z'
      }
    },
    listId: 'l1',
    hoistId: null,
    selId: null,
    msel: new Set()
  };
}

// The data as it was saved in an older commit - note its own (stale) sync config.
function olderBackupData() {
  return {
    tasks: { old1: mkTask('old1'), old2: mkTask('old2', { deleted: true }), old3: mkTask('old3') },
    lists: {
      l1: { id: 'l1', name: 'Restored', root_tasks: ['old1', 'old3'] },
      l2: { id: 'l2', name: 'Second', root_tasks: [] }
    },
    currentListId: 'l1',
    settings: {
      darkMode: true,
      repoOwner: 'octocat',
      repoName: 'private-backups',
      repoBranch: 'old-branch',
      repoPath: 'old/path.json',
      gistId: 'gist-from-the-past',
      syncLastAt: '2019-01-01T00:00:00.000Z',
      syncLastSummary: 'Pulled'
    }
  };
}

function encodeBackup(data, exportedAt) {
  return Buffer.from(JSON.stringify({ version: 1, exportedAt, data }), 'utf8').toString('base64');
}

function makeApp(state) {
  const calls = { save: [], render: 0, syncSettings: 0, toast: [], undo: [] };
  const app = {
    calls,
    snap: () => JSON.parse(JSON.stringify({ tasks: state.data.tasks, lists: state.data.lists })),
    pushUndo: (sn) => calls.undo.push(sn),
    save: (options) => {
      calls.save.push(options || {});
      state.data.settings = state.data.settings || {};
      if (!options || options.touchLocalSaveAt !== false) {
        state.data.settings.gistLastLocalSaveAt = new Date().toISOString();
      }
    },
    render: () => { calls.render += 1; },
    syncSettings: () => { calls.syncSettings += 1; },
    toast: (msg) => calls.toast.push(msg)
  };
  return app;
}

function commitEntry(sha, date, message, author = 'Umar') {
  return { sha, commit: { message, author: { name: author, date }, committer: { name: 'GitHub', date } } };
}

// ---------------------------------------------------------------------------
// listRepoVersionsRemote
// ---------------------------------------------------------------------------

test('listRepoVersionsRemote lists commits of the backup file on the configured branch', async () => {
  const urls = [];
  const fetchMock = async (url) => {
    urls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => [
        commitEntry('sha-new', '2026-09-20T10:00:00Z', 'MonkeyGTD backup 2026-09-20T10:00:00.000Z'),
        commitEntry('sha-old', '2026-09-19T08:00:00Z', 'Manual fix\n\nlonger body')
      ]
    };
  };
  const { listRepoVersionsRemote } = loadRepoSyncModule({ fetch: fetchMock });

  const result = await listRepoVersionsRemote(makeState(), {});

  assert.equal(urls.length, 1);
  const url = new URL(urls[0]);
  assert.equal(url.pathname, '/repos/octocat/private-backups/commits');
  assert.equal(url.searchParams.get('path'), 'backups/monkeygtd-backup.json');
  assert.equal(url.searchParams.get('sha'), 'main');
  assert.equal(url.searchParams.get('page'), '1');
  assert.equal(url.searchParams.get('per_page'), '30');
  assert.equal(url.searchParams.has('until'), false);

  assert.equal(result.hasMore, false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.versions)), [
    { sha: 'sha-new', date: '2026-09-20T10:00:00Z', message: 'MonkeyGTD backup 2026-09-20T10:00:00.000Z', author: 'Umar' },
    { sha: 'sha-old', date: '2026-09-19T08:00:00Z', message: 'Manual fix', author: 'Umar' }
  ]);
});

test('listRepoVersionsRemote passes page/until through and reports more pages when a page is full', async () => {
  const urls = [];
  const fullPage = Array.from({ length: 30 }, (_, i) => commitEntry(`sha-${i}`, '2026-09-01T00:00:00Z', 'x'));
  const fetchMock = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => fullPage };
  };
  const { listRepoVersionsRemote } = loadRepoSyncModule({ fetch: fetchMock });

  const result = await listRepoVersionsRemote(makeState(), { page: 3, until: '2026-09-02T18:59:59.999Z' });

  const url = new URL(urls[0]);
  assert.equal(url.searchParams.get('page'), '3');
  assert.equal(url.searchParams.get('until'), '2026-09-02T18:59:59.999Z');
  assert.equal(result.versions.length, 30);
  assert.equal(result.hasMore, true);
});

test('listRepoVersionsRemote treats an empty repo as no versions and reports a missing repo/branch clearly', async () => {
  const empty = loadRepoSyncModule({ fetch: async () => ({ ok: false, status: 409, json: async () => ({}) }) });
  const emptyResult = await empty.listRepoVersionsRemote(makeState(), {});
  assert.equal(emptyResult.versions.length, 0);
  assert.equal(emptyResult.hasMore, false);

  const missing = loadRepoSyncModule({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(
    () => missing.listRepoVersionsRemote(makeState(), {}),
    { message: 'Repo or branch not found: octocat/private-backups@main' }
  );
});

test('listRepoVersionsRemote refuses to call GitHub without repo configuration', async () => {
  let fetchCalls = 0;
  const { listRepoVersionsRemote } = loadRepoSyncModule({ fetch: async () => { fetchCalls += 1; return { ok: true, json: async () => [] }; } });
  const state = makeState();
  state.data.settings.repoOwner = '';

  await assert.rejects(() => listRepoVersionsRemote(state, {}), { message: 'Set repo token/owner/name/path first' });
  assert.equal(fetchCalls, 0);
});

// ---------------------------------------------------------------------------
// fetchRepoVersionRemote
// ---------------------------------------------------------------------------

test('fetchRepoVersionRemote reads the backup file at the chosen commit, not the branch head', async () => {
  const urls = [];
  const fetchMock = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ sha: 'blob', content: encodeBackup(olderBackupData(), '2026-09-01T09:00:00.000Z') }) };
  };
  const { fetchRepoVersionRemote } = loadRepoSyncModule({ fetch: fetchMock });

  const version = await fetchRepoVersionRemote(makeState(), COMMIT_SHA);

  const url = new URL(urls[0]);
  assert.equal(url.pathname, '/repos/octocat/private-backups/contents/backups/monkeygtd-backup.json');
  assert.equal(url.searchParams.get('ref'), COMMIT_SHA);
  assert.equal(version.sha, COMMIT_SHA);
  assert.equal(version.exportedAt, '2026-09-01T09:00:00.000Z');
  assert.deepEqual(Object.keys(version.data.tasks), ['old1', 'old2', 'old3']);
});

test('fetchRepoVersionRemote rejects versions that are missing, empty, or not MonkeyGTD backups', async () => {
  const notFound = loadRepoSyncModule({ fetch: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(() => notFound.fetchRepoVersionRemote(makeState(), COMMIT_SHA), { message: 'Backup file not found in version abc1234' });

  const invalidJson = loadRepoSyncModule({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ content: Buffer.from('{not json', 'utf8').toString('base64') }) })
  });
  await assert.rejects(() => invalidJson.fetchRepoVersionRemote(makeState(), COMMIT_SHA), { message: 'Version abc1234 is empty or not valid JSON' });

  const foreign = loadRepoSyncModule({
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ content: Buffer.from('{"hello":"world"}', 'utf8').toString('base64') }) })
  });
  await assert.rejects(() => foreign.fetchRepoVersionRemote(makeState(), COMMIT_SHA), { message: 'Version abc1234 is not a MonkeyGTD backup' });

  const { fetchRepoVersionRemote } = loadRepoSyncModule();
  await assert.rejects(() => fetchRepoVersionRemote(makeState(), '  '), { message: 'Pick a version to restore' });
});

// ---------------------------------------------------------------------------
// restoreRepoVersionRemote
// ---------------------------------------------------------------------------

function restoreFetchMock(putBodies, { putOk = true } = {}) {
  return async (url, options = {}) => {
    const method = options.method || 'GET';
    if (method === 'PUT') {
      putBodies.push({ url: String(url), body: JSON.parse(options.body) });
      return putOk
        ? { ok: true, status: 200, json: async () => ({}) }
        : { ok: false, status: 500, json: async () => ({ message: 'boom' }) };
    }
    // Branch head (what the push reads for its sha) - an unrelated newer copy.
    return { ok: true, status: 200, json: async () => ({ sha: 'head-sha', content: encodeBackup({ tasks: {}, lists: {}, settings: {} }, '2021-01-01T00:00:00.000Z') }) };
  };
}

test('restoreRepoVersionRemote replaces local data, keeps current sync config, and pushes the restored copy', async () => {
  const putBodies = [];
  const { restoreRepoVersionRemote } = loadRepoSyncModule({ fetch: restoreFetchMock(putBodies) });
  const state = makeState();
  const app = makeApp(state);
  const syncBefore = { ...state.data.settings };

  const result = await restoreRepoVersionRemote(app, state, { sha: COMMIT_SHA, exportedAt: '2026-09-01T09:00:00.000Z', data: olderBackupData() }, { silent: false });

  assert.deepEqual({ ...result }, { restored: true, pushed: true });

  // Tasks/lists (and non-sync settings) come from the chosen version...
  assert.deepEqual(Object.keys(state.data.tasks), ['old1', 'old2', 'old3']);
  assert.equal(state.data.lists.l1.name, 'Restored');
  assert.equal(state.data.settings.darkMode, true);

  // ...but the old copy's sync config never replaces this device's.
  assert.equal(state.data.settings.repoPath, syncBefore.repoPath);
  assert.equal(state.data.settings.repoBranch, 'main');
  assert.equal(state.data.settings.repoToken, 'token');
  assert.equal('gistId' in state.data.settings, false);

  // Undo takes the restore back to the pre-restore tasks/lists.
  assert.equal(app.calls.undo.length, 1);
  assert.deepEqual(Object.keys(app.calls.undo[0].tasks), ['cur1', 'cur2']);

  // The restored data was pushed to the configured file/branch as the new head.
  assert.equal(putBodies.length, 1);
  assert.equal(new URL(putBodies[0].url).pathname, '/repos/octocat/private-backups/contents/backups/monkeygtd-backup.json');
  assert.equal(putBodies[0].body.branch, 'main');
  assert.equal(putBodies[0].body.sha, 'head-sha');
  const pushed = JSON.parse(Buffer.from(putBodies[0].body.content, 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(pushed.data.tasks), ['old1', 'old2', 'old3']);
  assert.equal(pushed.data.settings.repoToken, undefined);

  assert.equal(state.data.settings.repoLastSyncSummary, 'Restored abc1234');
  assert.equal(state.data.settings.syncLastSummary, 'Restored abc1234');
  assert.equal(app.calls.render >= 1, true);
  assert.deepEqual(app.calls.toast, ['Restored version abc1234']);
});

test('restoreRepoVersionRemote keeps hoist/selection only for tasks that exist in the restored version', async () => {
  const { restoreRepoVersionRemote } = loadRepoSyncModule({ fetch: restoreFetchMock([]) });
  const state = makeState();
  state.data.tasks.old1 = mkTask('old1');
  state.hoistId = 'old1';
  state.selId = 'cur1';
  state.msel = new Set(['old1', 'old2', 'cur2']);
  const app = makeApp(state);

  await restoreRepoVersionRemote(app, state, { sha: COMMIT_SHA, data: olderBackupData() }, { silent: true });

  assert.equal(state.hoistId, 'old1');
  assert.equal(state.selId, null);
  assert.deepEqual([...state.msel], ['old1']);
  assert.equal(state.editId, null);
  assert.equal(state.listId, 'l1');
});

test('restoreRepoVersionRemote does not mutate the fetched version object', async () => {
  const { restoreRepoVersionRemote } = loadRepoSyncModule({ fetch: restoreFetchMock([]) });
  const state = makeState();
  const app = makeApp(state);
  const version = { sha: COMMIT_SHA, data: olderBackupData() };

  await restoreRepoVersionRemote(app, state, version, { silent: true });
  state.data.tasks.old1.content = 'edited after restore';

  assert.equal(version.data.tasks.old1.content, 'old1');
  assert.equal(version.data.settings.repoPath, 'old/path.json');
});

test('restoreRepoVersionRemote keeps the restore when the push fails, and the next sync pushes it instead of pulling the old head', async () => {
  const putBodies = [];
  const statusEl = { textContent: '', style: {} };
  const document = { getElementById: (id) => (id === 'gist-sync-status' ? statusEl : null) };
  const failing = loadRepoSyncModule({ fetch: restoreFetchMock(putBodies, { putOk: false }), document });
  const state = makeState();
  const app = makeApp(state);

  const result = await failing.restoreRepoVersionRemote(app, state, { sha: COMMIT_SHA, data: olderBackupData() }, { silent: false });

  assert.deepEqual({ ...result }, { restored: true, pushed: false });
  assert.deepEqual(Object.keys(state.data.tasks), ['old1', 'old2', 'old3']);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Restored abc1234 (not pushed)');
  assert.equal(statusEl.textContent, 'Restored version abc1234 locally; push to repo failed - run Sync now to retry');
  assert.deepEqual(app.calls.toast, ['Restored locally; push to repo failed']);

  // Next sync (network back): the old head must not win over the restore.
  const retryPuts = [];
  const retry = loadRepoSyncModule({ fetch: restoreFetchMock(retryPuts) });
  const ok = await retry.syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(ok, true);
  assert.deepEqual(Object.keys(state.data.tasks), ['old1', 'old2', 'old3']);
  const backupPut = retryPuts.find(p => p.url.includes('monkeygtd-backup.json'));
  assert.ok(backupPut, 'Expected the restored copy to be pushed on the next sync');
  const pushed = JSON.parse(Buffer.from(backupPut.body.content, 'base64').toString('utf8'));
  assert.deepEqual(Object.keys(pushed.data.tasks), ['old1', 'old2', 'old3']);
});

test('restoreRepoVersionRemote ignores a missing version', async () => {
  const { restoreRepoVersionRemote } = loadRepoSyncModule();
  const state = makeState();
  const app = makeApp(state);

  const result = await restoreRepoVersionRemote(app, state, null, {});

  assert.deepEqual({ ...result }, { restored: false, pushed: false });
  assert.deepEqual(Object.keys(state.data.tasks), ['cur1', 'cur2']);
  assert.equal(app.calls.save.length, 0);
});

// ---------------------------------------------------------------------------
// Restore Older Version modal (js/ui/repo-versions-controller.js)
// ---------------------------------------------------------------------------

function makeFakeDocument() {
  const els = {};
  return {
    els,
    getElementById: (id) => {
      if (!els[id]) els[id] = { id, innerHTML: '', textContent: '', value: '', style: {} };
      return els[id];
    }
  };
}

function loadVersionsController(fakes) {
  const utils = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const source = fs.readFileSync(path.join(process.cwd(), 'js/ui/repo-versions-controller.js'), 'utf8');
  const document = makeFakeDocument();
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    document,
    confirm: fakes.confirm || (() => true),
    listRepoVersionsRemote: fakes.listRepoVersionsRemote || (async () => ({ versions: [], hasMore: false })),
    fetchRepoVersionRemote: fakes.fetchRepoVersionRemote || (async () => { throw new Error('unexpected fetch'); }),
    restoreRepoVersionRemote: fakes.restoreRepoVersionRemote || (async () => ({ restored: true, pushed: true }))
  };
  vm.createContext(sandbox);
  vm.runInContext(utils, sandbox, { filename: 'utils.js' });
  vm.runInContext(
    `${source}\n;globalThis.__exports = { openRepoVersionsUi, loadMoreRepoVersionsUi, setRepoVersionsUntilUi, restoreRepoVersionUi, repoVersionsUntilIso };`,
    sandbox,
    { filename: 'repo-versions-controller.js' }
  );
  return { ...sandbox.__exports, document };
}

function makeUiApp() {
  const calls = [];
  return {
    calls,
    openModal: (id) => calls.push(['openModal', id]),
    closeModal: (id) => calls.push(['closeModal', id])
  };
}

const PAGE_1 = [
  { sha: 'aaaaaaa1111', date: '2026-09-20T10:00:00Z', message: 'MonkeyGTD backup 2026-09-20T10:00:00.000Z', author: 'Umar' },
  { sha: 'bbbbbbb2222', date: '2026-09-19T08:00:00Z', message: 'Fix <b>typo</b>', author: 'Umar' }
];

test('opening the modal loads the first page of versions with a Restore button per version', async () => {
  const listCalls = [];
  const ctl = loadVersionsController({
    listRepoVersionsRemote: async (state, opts) => { listCalls.push({ ...opts }); return { versions: PAGE_1, hasMore: true }; }
  });
  const app = makeUiApp();
  const state = { data: { settings: {} } };

  await ctl.openRepoVersionsUi(app, state);

  assert.deepEqual(app.calls, [['closeModal', 'ov-settings'], ['openModal', 'ov-repo-versions']]);
  assert.deepEqual(listCalls, [{ page: 1, until: '' }]);

  const html = ctl.document.els['repo-versions-list'].innerHTML;
  assert.equal((html.match(/class="repo-ver-row"/g) || []).length, 2);
  assert.match(html, /data-sha="aaaaaaa1111" onclick="App\.restoreRepoVersion\(this\.dataset\.sha\)"/);
  assert.match(html, /data-sha="bbbbbbb2222"/);
  // Only the unfiltered head is the repo's current copy.
  assert.equal((html.match(/repo-ver-badge/g) || []).length, 1);
  // The app's own auto-generated commit message is noise; others are shown, escaped.
  assert.equal(html.includes('MonkeyGTD backup'), false);
  assert.equal(html.includes('Fix &lt;b&gt;typo&lt;/b&gt;'), true);
  assert.equal(ctl.document.els['repo-versions-more'].style.display, '');
  assert.equal(ctl.document.els['repo-versions-status'].textContent, '');
});

test('Load older versions appends the next page and hides the button on the last page', async () => {
  const pages = {
    1: { versions: PAGE_1, hasMore: true },
    2: { versions: [{ sha: 'ccccccc3333', date: '2026-09-10T00:00:00Z', message: '', author: '' }], hasMore: false }
  };
  const listCalls = [];
  const ctl = loadVersionsController({
    listRepoVersionsRemote: async (state, opts) => { listCalls.push(opts.page); return pages[opts.page]; }
  });
  const app = makeUiApp();
  const state = { data: { settings: {} } };

  await ctl.openRepoVersionsUi(app, state);
  await ctl.loadMoreRepoVersionsUi(app, state);
  // Nothing left to load - a further click is a no-op.
  await ctl.loadMoreRepoVersionsUi(app, state);

  assert.deepEqual(listCalls, [1, 2]);
  assert.deepEqual(state.repoVersions.versions.map(v => v.sha), ['aaaaaaa1111', 'bbbbbbb2222', 'ccccccc3333']);
  assert.equal(ctl.document.els['repo-versions-more'].style.display, 'none');
});

test('the date filter reloads from page 1 up to the end of the chosen day, without a Latest badge', async () => {
  const listCalls = [];
  const ctl = loadVersionsController({
    listRepoVersionsRemote: async (state, opts) => { listCalls.push({ ...opts }); return { versions: PAGE_1, hasMore: false }; }
  });
  const app = makeUiApp();
  const state = { data: { settings: {} } };

  await ctl.openRepoVersionsUi(app, state);
  await ctl.setRepoVersionsUntilUi(app, state, '2026-09-19');

  const expectedUntil = new Date('2026-09-19T23:59:59.999').toISOString();
  assert.deepEqual(listCalls[1], { page: 1, until: expectedUntil });
  assert.equal(ctl.document.els['repo-versions-list'].innerHTML.includes('repo-ver-badge'), false);

  // Clearing the date goes back to the full history.
  await ctl.setRepoVersionsUntilUi(app, state, '');
  assert.deepEqual(listCalls[2], { page: 1, until: '' });
  assert.equal(ctl.repoVersionsUntilIso('not-a-date'), '');
});

test('a slower, superseded version load does not overwrite a newer one', async () => {
  const resolvers = [];
  const ctl = loadVersionsController({
    listRepoVersionsRemote: (state, opts) => new Promise(resolve => resolvers.push({ opts, resolve }))
  });
  const app = makeUiApp();
  const state = { data: { settings: {} } };

  const first = ctl.openRepoVersionsUi(app, state);
  const second = ctl.setRepoVersionsUntilUi(app, state, '2026-09-01');
  resolvers[1].resolve({ versions: [{ sha: 'filtered1', date: '', message: '', author: '' }], hasMore: false });
  resolvers[0].resolve({ versions: PAGE_1, hasMore: true });

  assert.equal(await second, true);
  assert.equal(await first, false);
  assert.deepEqual(state.repoVersions.versions.map(v => v.sha), ['filtered1']);
  assert.equal(state.repoVersions.loading, false);
});

test('a failed version list shows the error in the modal', async () => {
  const ctl = loadVersionsController({
    listRepoVersionsRemote: async () => { throw new Error('Repo history read failed (500)'); }
  });
  const state = { data: { settings: {} } };

  const ok = await ctl.openRepoVersionsUi(makeUiApp(), state);

  assert.equal(ok, false);
  assert.equal(ctl.document.els['repo-versions-status'].textContent, 'Repo history read failed (500)');
  assert.equal(ctl.document.els['repo-versions-status'].style.color, 'var(--danger)');
  // A failed load is not the same as "this file has no history".
  assert.equal(ctl.document.els['repo-versions-list'].innerHTML, '');
});

test('restoring asks for confirmation with list/task counts and does nothing when declined', async () => {
  const prompts = [];
  let restoreCalls = 0;
  const ctl = loadVersionsController({
    fetchRepoVersionRemote: async (state, sha) => ({ sha, exportedAt: '', data: olderBackupData() }),
    confirm: (msg) => { prompts.push(msg); return false; },
    restoreRepoVersionRemote: async () => { restoreCalls += 1; return { restored: true, pushed: true }; }
  });
  const app = makeUiApp();
  const state = makeState();

  const ok = await ctl.restoreRepoVersionUi(app, state, COMMIT_SHA);

  assert.equal(ok, false);
  assert.equal(restoreCalls, 0);
  assert.equal(prompts.length, 1);
  // 2 lists / 2 non-deleted tasks in the old version vs 1 list / 2 tasks now.
  assert.match(prompts[0], /\(2 lists, 2 tasks\)\?/);
  assert.match(prompts[0], /replaces your current data \(1 list, 2 tasks\)/);
  assert.deepEqual(app.calls, []);
  assert.equal(state.repoVersions.restoring, false);
});

test('restoring a confirmed version hands it to the repo restore and closes the modal', async () => {
  const restored = [];
  const version = { sha: COMMIT_SHA, exportedAt: '', data: olderBackupData() };
  const ctl = loadVersionsController({
    fetchRepoVersionRemote: async () => version,
    confirm: () => true,
    restoreRepoVersionRemote: async (app, state, v, opts) => { restored.push({ v, opts: { ...opts } }); return { restored: true, pushed: true }; }
  });
  const app = makeUiApp();
  const state = makeState();

  const ok = await ctl.restoreRepoVersionUi(app, state, COMMIT_SHA);

  assert.equal(ok, true);
  assert.equal(restored.length, 1);
  assert.equal(restored[0].v, version);
  assert.deepEqual(restored[0].opts, { silent: false });
  assert.deepEqual(app.calls, [['closeModal', 'ov-repo-versions']]);
});

test('restoring shows the fetch error and never prompts when the version cannot be loaded', async () => {
  let prompted = false;
  const ctl = loadVersionsController({
    fetchRepoVersionRemote: async () => { throw new Error('Version abc1234 is not a MonkeyGTD backup'); },
    confirm: () => { prompted = true; return true; }
  });
  const state = makeState();

  const ok = await ctl.restoreRepoVersionUi(makeUiApp(), state, COMMIT_SHA);

  assert.equal(ok, false);
  assert.equal(prompted, false);
  assert.equal(ctl.document.els['repo-versions-status'].textContent, 'Version abc1234 is not a MonkeyGTD backup');
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test('Restore older version is reachable from settings, the command palette, and suppresses global shortcuts', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  assert.match(html, /<div id="ov-repo-versions" class="ov hidden">/);
  assert.match(html, /onclick="App\.openRepoVersions\(\)"/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const at = scripts.indexOf('js/ui/repo-versions-controller.js');
  assert.notEqual(at, -1, 'repo-versions-controller.js must be loaded by app.html');
  assert.equal(at > scripts.indexOf('js/infra/repo-sync.js'), true);
  assert.equal(at < scripts.indexOf('js/app.js'), true);

  const kb = fs.readFileSync(path.join(process.cwd(), 'js/ui/keyboard-controller.js'), 'utf8');
  const tracked = kb.match(/const anyModal = \[\.\.\.'([^']+)'\.split/);
  assert.ok(tracked);
  assert.equal(tracked[1].split(' ').includes('repo-versions'), true);

  const paletteSrc = fs.readFileSync(path.join(process.cwd(), 'js/ui/command-palette-commands.js'), 'utf8');
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(`${paletteSrc}\n;globalThis.__exports = { buildCommandPaletteItems };`, sandbox);
  let opened = 0;
  const items = sandbox.__exports.buildCommandPaletteItems({ openRepoVersions: () => { opened += 1; }, select: () => [] }, { data: { settings: {} }, msel: new Set() });
  const item = items.find(i => i.l === 'Restore older version from repo');
  assert.ok(item, 'Expected a command palette entry');
  item.fn();
  assert.equal(opened, 1);
});
