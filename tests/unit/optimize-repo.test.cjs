const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function loadContext(files, exportsList, overrides = {}) {
  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    Buffer,
    setInterval,
    clearInterval,
    document: { getElementById: () => null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} },
    fetch: async () => { throw new Error('unexpected fetch'); },
    ...overrides
  };

  vm.createContext(sandbox);
  for (const rel of files) {
    vm.runInContext(read(rel), sandbox, { filename: rel });
  }
  vm.runInContext(`globalThis.__exports = { ${exportsList.join(', ')} };`, sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

function loadDomain() {
  return loadContext(['js/domain/lifecycle-ops.js'], ['optimizeDataDomain']);
}

function mkT(id, overrides = {}) {
  return {
    id,
    content: `Task ${id}`,
    status: 0,
    checklist_id: 'l1',
    parent_id: '',
    tasks: [],
    history: [],
    deleted: false,
    ...overrides
  };
}

function mkState(taskList, lists, extra = {}) {
  const tasks = {};
  for (const t of taskList) tasks[t.id] = t;
  return {
    selId: null,
    editId: null,
    hoistId: null,
    msel: new Set(),
    listId: 'l1',
    data: {
      tasks,
      lists,
      settings: {},
      deletedItems: [],
      currentListId: 'l1',
      ...extra
    }
  };
}

function history(n) {
  return Array.from({ length: n }, (_, i) => ({ at: `2026-01-0${(i % 9) + 1}T00:00:00.000Z`, type: 'title', changes: { step: i } }));
}

// ── optimizeDataDomain ───────────────────────────────────────────────

test('optimizeDataDomain removes untitled tasks and promotes their titled children into the vacated slot', () => {
  const { optimizeDataDomain } = loadDomain();
  const state = mkState([
    mkT('a', { tasks: ['u2'] }),
    mkT('u2', { content: '', parent_id: 'a' }),
    mkT('u', { content: '   ', tasks: ['c', 'd'] }),
    mkT('c', { parent_id: 'u' }),
    mkT('d', { parent_id: 'u' }),
    mkT('b')
  ], { l1: { id: 'l1', root_tasks: ['a', 'u', 'b'] } });

  const stats = optimizeDataDomain(state);

  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['a', 'c', 'd', 'b']);
  assert.equal(state.data.tasks.c.parent_id, '');
  assert.equal(state.data.tasks.d.parent_id, '');
  assert.deepEqual(Array.from(state.data.tasks.a.tasks), []);
  assert.equal(state.data.tasks.u, undefined);
  assert.equal(state.data.tasks.u2, undefined);
  assert.equal(stats.untitled, 2);
  assert.equal(stats.removed, 2);
});

test('optimizeDataDomain collapses nested untitled tasks down to the titled leaf', () => {
  const { optimizeDataDomain } = loadDomain();
  const state = mkState([
    mkT('u1', { content: '', tasks: ['u2'] }),
    mkT('u2', { content: '', parent_id: 'u1', tasks: ['t'] }),
    mkT('t', { parent_id: 'u2' })
  ], { l1: { id: 'l1', root_tasks: ['u1'] } });

  optimizeDataDomain(state);

  assert.deepEqual(Object.keys(state.data.tasks), ['t']);
  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['t']);
  assert.equal(state.data.tasks.t.parent_id, '');
});

test('optimizeDataDomain removes completed and invalidated tasks with their subtrees in every list', () => {
  const { optimizeDataDomain } = loadDomain();
  const state = mkState([
    mkT('open'),
    mkT('done', { status: 1, tasks: ['child'] }),
    mkT('child', { parent_id: 'done' }),
    mkT('inv', { status: 2, checklist_id: 'l2' }),
    mkT('open2', { checklist_id: 'l2' })
  ], {
    l1: { id: 'l1', root_tasks: ['open', 'done'] },
    l2: { id: 'l2', archived: true, root_tasks: ['inv', 'open2'] }
  });

  const stats = optimizeDataDomain(state);

  assert.deepEqual(Object.keys(state.data.tasks).sort(), ['open', 'open2']);
  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['open']);
  assert.deepEqual(Array.from(state.data.lists.l2.root_tasks), ['open2']);
  assert.equal(stats.completed, 2);
  assert.equal(stats.removed, 3);
});

test('optimizeDataDomain purges deleted tasks, their unflagged descendants, Restore Deleted and dangling ids', () => {
  const { optimizeDataDomain } = loadDomain();
  // "Wipe completed" flags only the branch root; its children keep deleted:false.
  const state = mkState([
    mkT('keep', { tasks: ['gone', 'ghost'] }),
    mkT('gone', { parent_id: 'keep', deleted: true }),
    mkT('wiped', { deleted: true, tasks: ['orphan'] }),
    mkT('orphan', { parent_id: 'wiped', due: '2026-01-01' })
  ], { l1: { id: 'l1', root_tasks: ['keep', 'missing'] } }, {
    deletedItems: [{ taskId: 'wiped', snapshot: {}, deletedAt: '2026-01-01' }, { taskId: 'x', snapshot: {}, deletedAt: '2026-01-02' }]
  });

  const stats = optimizeDataDomain(state);

  assert.deepEqual(Object.keys(state.data.tasks), ['keep']);
  assert.deepEqual(Array.from(state.data.tasks.keep.tasks), []);
  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['keep']);
  assert.deepEqual(Array.from(state.data.deletedItems), []);
  assert.equal(stats.deleted, 2);
  assert.equal(stats.removed, 3);
  assert.equal(stats.deletedItemsCleared, 2);
});

test('optimizeDataDomain keeps live tasks a deleted task still lists but no longer parents (extract-branch, moves)', () => {
  const { optimizeDataDomain } = loadDomain();
  // extractBranchDomain re-homes children to a new list but leaves parent_id on the old source.
  const state = mkState([
    mkT('src', { deleted: true, tasks: [] }),
    mkT('moved', { parent_id: 'src', checklist_id: 'l2' }),
    mkT('stale', { deleted: true, tasks: ['elsewhere'] }),
    mkT('elsewhere', { checklist_id: 'l2' })
  ], {
    l1: { id: 'l1', root_tasks: [] },
    l2: { id: 'l2', root_tasks: ['moved', 'elsewhere'] }
  });

  optimizeDataDomain(state);

  assert.deepEqual(Object.keys(state.data.tasks).sort(), ['elsewhere', 'moved']);
  assert.deepEqual(Array.from(state.data.lists.l2.root_tasks), ['moved', 'elsewhere']);
});

test('optimizeDataDomain keeps only the last 4 history entries per task', () => {
  const { optimizeDataDomain } = loadDomain();
  const long = history(7);
  const state = mkState([
    mkT('a', { history: long }),
    mkT('b', { history: history(4) }),
    mkT('c', { history: undefined })
  ], { l1: { id: 'l1', root_tasks: ['a', 'b', 'c'] } });

  const stats = optimizeDataDomain(state);

  assert.deepEqual(state.data.tasks.a.history.map(h => h.changes.step), [3, 4, 5, 6]);
  assert.equal(state.data.tasks.b.history.length, 4);
  assert.equal(state.data.tasks.c.history, undefined);
  assert.equal(stats.historyTrimmedTasks, 1);
  assert.equal(stats.historyEntriesRemoved, 3);
});

test('optimizeDataDomain clears selection, hoist and multi-select that point at removed tasks', () => {
  const { optimizeDataDomain } = loadDomain();
  const state = mkState([
    mkT('live'),
    mkT('done', { status: 1 })
  ], { l1: { id: 'l1', root_tasks: ['live', 'done'] } });
  state.selId = 'done';
  state.hoistId = 'done';
  state.editId = 'done';
  state.msel = new Set(['live', 'done']);

  optimizeDataDomain(state);

  assert.equal(state.selId, null);
  assert.equal(state.hoistId, null);
  assert.equal(state.editId, null);
  assert.deepEqual(Array.from(state.msel), ['live']);
});

test('optimizeDataDomain on empty data is a no-op', () => {
  const { optimizeDataDomain } = loadDomain();
  const state = { msel: new Set(), data: { lists: {}, tasks: {}, settings: {} } };

  const stats = optimizeDataDomain(state);

  assert.equal(stats.removed, 0);
  assert.equal(stats.historyTrimmedTasks, 0);
  assert.deepEqual(Array.from(state.data.deletedItems), []);
});

// ── optimizeRepoRemote ───────────────────────────────────────────────

const SYNC_TS = '2026-09-27T10:00:00.000Z';

function remoteFile(data, exportedAt = SYNC_TS) {
  const payload = { version: 1, exportedAt, data };
  return { sha: 'file-sha', content: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64') };
}

function repoState() {
  const state = mkState([
    mkT('keep', { history: history(6) }),
    mkT('blank', { content: '' }),
    mkT('done', { status: 1 }),
    mkT('trash', { deleted: true })
  ], { l1: { id: 'l1', name: 'Inbox', root_tasks: ['keep', 'blank', 'done'] } }, {
    deletedItems: [{ taskId: 'trash', snapshot: {}, deletedAt: SYNC_TS }]
  });
  Object.assign(state.data.settings, {
    syncProvider: 'repo',
    repoToken: 'token',
    repoOwner: 'octocat',
    repoName: 'backups',
    repoBranch: 'main',
    repoPath: 'monkeygtd-backup.json',
    gistLastLocalSaveAt: SYNC_TS,
    syncLastAt: SYNC_TS
  });
  return state;
}

function makeApp(state) {
  const calls = { toast: [], save: 0, render: 0, pushUndo: 0 };
  const app = {
    toast: msg => { calls.toast.push(msg); },
    save: (opts = {}) => {
      calls.save += 1;
      if (opts.touchLocalSaveAt !== false) state.data.settings.gistLastLocalSaveAt = new Date().toISOString();
    },
    render: () => { calls.render += 1; },
    syncSettings: () => {},
    pushUndo: () => { calls.pushUndo += 1; },
    snap: () => ({})
  };
  return { app, calls };
}

// Remote copy equals local, so the pre-optimize sync is a no-op and the only write is the final push.
function makeFetch(state, handlers = {}) {
  const calls = [];
  const remoteData = JSON.parse(JSON.stringify(state.data));
  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const call = { url, method, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);

    if (url.includes('/git/ref/heads/')) {
      if (handlers.headRef) return handlers.headRef(call);
      return { ok: true, status: 200, json: async () => ({ object: { sha: 'commit-sha' } }) };
    }
    if (url.endsWith('/git/refs')) {
      if (handlers.createRef) return handlers.createRef(call, calls.filter(c => c.url.endsWith('/git/refs')).length);
      return { ok: true, status: 201, json: async () => ({}) };
    }
    if (url.includes('monkeygtd-inbox.ndjson')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    if (method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({}) };
    }
    if (handlers.backup) return handlers.backup(call);
    return { ok: true, status: 200, json: async () => remoteFile(remoteData) };
  };
  return { fetchMock, calls };
}

function loadRemote(fetchMock) {
  return loadContext(
    ['js/domain/lifecycle-ops.js', 'js/infra/repo-sync.js'],
    ['optimizeRepoRemote', 'repoSnapshotTagName'],
    { fetch: fetchMock }
  );
}

function pushedData(call) {
  const body = JSON.parse(Buffer.from(call.body.content, 'base64').toString('utf8'));
  return body.data;
}

test('repoSnapshotTagName uses the local cleansing date, with a time suffix on request', () => {
  const { repoSnapshotTagName } = loadRemote(async () => ({}));
  const d = new Date(2026, 8, 7, 4, 5, 6);

  assert.equal(repoSnapshotTagName(d, false), 'pre-optimize-2026-09-07');
  assert.equal(repoSnapshotTagName(d, true), 'pre-optimize-2026-09-07-040506');
});

test('optimizeRepoRemote tags a snapshot of the branch head, then cleanses and pushes', async () => {
  const state = repoState();
  const { fetchMock, calls } = makeFetch(state);
  const { optimizeRepoRemote } = loadRemote(fetchMock);
  const { app, calls: appCalls } = makeApp(state);

  const result = await optimizeRepoRemote(app, state, { silent: true });

  assert.ok(result, 'expected optimize to succeed');
  assert.match(result.tag, /^pre-optimize-\d{4}-\d{2}-\d{2}$/);

  const refIdx = calls.findIndex(c => c.url.endsWith('/git/refs'));
  const putIdx = calls.findIndex(c => c.method === 'PUT');
  assert.ok(refIdx > -1 && putIdx > refIdx, 'tag must be created before the cleansed data is pushed');
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1, 'pre-optimize sync should not push when already in sync');
  assert.equal(calls[refIdx].url, 'https://api.github.com/repos/octocat/backups/git/refs');
  assert.deepEqual(calls[refIdx].body, { ref: `refs/tags/${result.tag}`, sha: 'commit-sha' });
  assert.ok(calls.some(c => c.url === 'https://api.github.com/repos/octocat/backups/git/ref/heads/main'));

  const pushed = pushedData(calls[putIdx]);
  assert.deepEqual(Object.keys(pushed.tasks), ['keep']);
  assert.deepEqual(pushed.lists.l1.root_tasks, ['keep']);
  assert.equal(pushed.tasks.keep.history.length, 4);
  assert.deepEqual(pushed.deletedItems, []);
  assert.equal(pushed.settings.repoToken, undefined, 'token must not be pushed');

  assert.deepEqual(result.stats && { u: result.stats.untitled, c: result.stats.completed, d: result.stats.deleted },
    { u: 1, c: 1, d: 1 });
  assert.equal(appCalls.pushUndo, 1);
  assert.match(state.data.settings.repoLastSyncSummary, /^Optimized \(snapshot pre-optimize-/);
});

test('optimizeRepoRemote falls back to a timestamped tag when today\'s tag already exists', async () => {
  const state = repoState();
  const { fetchMock, calls } = makeFetch(state, {
    createRef: (call, n) => (n === 1
      ? { ok: false, status: 422, json: async () => ({ message: 'Reference already exists' }) }
      : { ok: true, status: 201, json: async () => ({}) })
  });
  const { optimizeRepoRemote } = loadRemote(fetchMock);
  const { app } = makeApp(state);

  const result = await optimizeRepoRemote(app, state, { silent: true });

  assert.ok(result);
  assert.match(result.tag, /^pre-optimize-\d{4}-\d{2}-\d{2}-\d{6}$/);
  const refCalls = calls.filter(c => c.url.endsWith('/git/refs'));
  assert.equal(refCalls.length, 2);
  assert.equal(refCalls[1].body.ref, `refs/tags/${result.tag}`);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 1);
});

test('optimizeRepoRemote leaves data untouched and pushes nothing when the snapshot tag cannot be created', async () => {
  const state = repoState();
  const before = JSON.stringify(state.data.tasks);
  const { fetchMock, calls } = makeFetch(state, {
    createRef: () => ({ ok: false, status: 403, json: async () => ({ message: 'Resource not accessible by personal access token' }) })
  });
  const { optimizeRepoRemote } = loadRemote(fetchMock);
  const { app, calls: appCalls } = makeApp(state);

  const result = await optimizeRepoRemote(app, state, { silent: false });

  assert.equal(result, false);
  assert.equal(JSON.stringify(state.data.tasks), before);
  assert.equal(calls.filter(c => c.method === 'PUT').length, 0);
  assert.equal(appCalls.pushUndo, 0);
  assert.match(appCalls.toast.at(-1), /Tag create failed \(403\)/);
});

test('optimizeRepoRemote aborts before tagging when the pre-optimize sync fails', async () => {
  const state = repoState();
  const before = JSON.stringify(state.data.tasks);
  const { fetchMock, calls } = makeFetch(state, {
    backup: () => ({ ok: false, status: 500, json: async () => ({}) })
  });
  const { optimizeRepoRemote } = loadRemote(fetchMock);
  const { app } = makeApp(state);

  const result = await optimizeRepoRemote(app, state, { silent: true });

  assert.equal(result, false);
  assert.equal(JSON.stringify(state.data.tasks), before);
  assert.equal(calls.some(c => c.url.includes('/git/')), false);
});

test('optimizeRepoRemote refuses without repo configuration', async () => {
  const state = repoState();
  state.data.settings.repoOwner = '';
  const { fetchMock, calls } = makeFetch(state);
  const { optimizeRepoRemote } = loadRemote(fetchMock);
  const { app, calls: appCalls } = makeApp(state);

  const result = await optimizeRepoRemote(app, state, { silent: false });

  assert.equal(result, false);
  assert.equal(calls.length, 0);
  assert.deepEqual(appCalls.toast, ['Set repo token/owner/name/path first']);
});

// ── UI wiring ────────────────────────────────────────────────────────

function loadOptimizeUi(overrides) {
  return loadContext(['js/ui/utilities-controller.js'], ['optimizeRepoUi'], { OPTIMIZE_HISTORY_LIMIT: 4, ...overrides });
}

test('optimizeRepoUi only runs for the repo provider and after confirmation', async () => {
  const runs = [];
  const prompts = [];
  let answer = false;
  const { optimizeRepoUi } = loadOptimizeUi({
    confirm: msg => { prompts.push(msg); return answer; },
    optimizeRepoRemote: async () => { runs.push(1); return { tag: 't' }; }
  });
  const toasts = [];
  let provider = 'gist';
  const app = { syncProvider: () => provider, toast: m => toasts.push(m) };

  assert.equal(await optimizeRepoUi(app, {}), false);
  assert.equal(prompts.length, 0);
  assert.match(toasts[0], /GitHub Repo sync provider/);

  provider = 'repo';
  assert.equal(await optimizeRepoUi(app, {}), false);
  assert.equal(runs.length, 0);
  assert.match(prompts[0], /last 4 history entries/);

  answer = true;
  assert.deepEqual(await optimizeRepoUi(app, {}), { tag: 't' });
  assert.equal(runs.length, 1);
});

test('Optimize repo is reachable from repo sync settings, the command palette and App', () => {
  const html = read('app.html');
  const repoFields = html.slice(html.indexOf('id="repo-sync-fields"'), html.indexOf('id="gist-sync-status"'));
  assert.match(repoFields, /onclick="App\.optimizeRepo\(\)"[^>]*>Optimize Repo</);

  const { buildCommandPaletteItems } = loadContext(['js/ui/command-palette-commands.js'], ['buildCommandPaletteItems']);
  let optimizeCalls = 0;
  const items = buildCommandPaletteItems({ optimizeRepo: () => { optimizeCalls += 1; }, select: () => [] }, { data: { settings: {} }, msel: new Set() });
  const item = items.find(i => i.l === 'Optimize repo');
  assert.ok(item, 'Expected Optimize repo in command palette');
  item.fn();
  assert.equal(optimizeCalls, 1);

  assert.match(read('js/app.js'), /async optimizeRepo\(\)\{ return optimizeRepoUi\(this, S\); \}/);
});

// ── Time sessions ────────────────────────────────────────────────────

function loadDomainWithTime() {
  return loadContext(['js/core/utils.js', 'js/domain/time-tracking-ops.js', 'js/domain/lifecycle-ops.js'], ['optimizeDataDomain']);
}

function timeSession(taskId, daysAgo, nowMs) {
  const end = nowMs - daysAgo * 24 * 60 * 60 * 1000;
  return { id: `s-${taskId}-${daysAgo}`, taskId, start: new Date(end - 3600000).toISOString(), end: new Date(end).toISOString(), source: 'timer', taskTitle: `Task ${taskId}`, listId: 'l1', listName: 'L1' };
}

test('optimizeDataDomain keeps time sessions of removed tasks but drops ones past the retention window', () => {
  const { optimizeDataDomain } = loadDomainWithTime();
  const nowMs = Date.parse('2026-10-05T12:00:00.000Z');
  const state = mkState([mkT('live'), mkT('done', { status: 1 })], { l1: { id: 'l1', root_tasks: ['live', 'done'] } }, {
    timeSessions: [timeSession('done', 400, nowMs), timeSession('done', 10, nowMs), timeSession('live', 2, nowMs)]
  });

  const stats = optimizeDataDomain(state, { nowMs });

  assert.equal(state.data.tasks.done, undefined);
  assert.equal(stats.timeSessionsPruned, 1);
  assert.deepEqual(Array.from(state.data.timeSessions, s => s.id), ['s-done-10', 's-live-2']);
});

test('optimizeDataDomain honours the time retention setting (0 keeps every session)', () => {
  const { optimizeDataDomain } = loadDomainWithTime();
  const nowMs = Date.parse('2026-10-05T12:00:00.000Z');
  const sessions = () => [timeSession('live', 400, nowMs), timeSession('live', 10, nowMs)];

  const forever = mkState([mkT('live')], { l1: { id: 'l1', root_tasks: ['live'] } }, { timeSessions: sessions(), settings: { timeRetentionDays: 0 } });
  assert.equal(optimizeDataDomain(forever, { nowMs }).timeSessionsPruned, 0);
  assert.equal(forever.data.timeSessions.length, 2);

  const week = mkState([mkT('live')], { l1: { id: 'l1', root_tasks: ['live'] } }, { timeSessions: sessions(), settings: { timeRetentionDays: 7 } });
  assert.equal(optimizeDataDomain(week, { nowMs }).timeSessionsPruned, 2);
  assert.equal(week.data.timeSessions.length, 0);
});

test('optimizeRepoUi lists the time-session retention step in its confirmation', async () => {
  const prompts = [];
  const { optimizeRepoUi } = loadContext(['js/domain/time-tracking-ops.js', 'js/ui/utilities-controller.js'], ['optimizeRepoUi'], {
    OPTIMIZE_HISTORY_LIMIT: 4,
    confirm: msg => { prompts.push(msg); return false; }
  });
  const app = { syncProvider: () => 'repo', toast: () => {} };

  await optimizeRepoUi(app, { data: { settings: { timeRetentionDays: 90 } } });
  await optimizeRepoUi(app, { data: { settings: { timeRetentionDays: 0 } } });

  assert.match(prompts[0], /6\. Drop time sessions older than 90 days/);
  assert.match(prompts[0], /7\. Push the result to the repo/);
  assert.match(prompts[1], /6\. Keep all time sessions/);
});
