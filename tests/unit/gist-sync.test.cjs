










































































const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGistSyncModule(overrides = {}) {
  const sourcePath = path.join(process.cwd(), 'js/infra/gist-sync.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Promise,
    setInterval: overrides.setInterval || setInterval,
    clearInterval: overrides.clearInterval || clearInterval,
    fetch: overrides.fetch || (async () => ({ ok: true, json: async () => ({}), text: async () => '' })),
    document: overrides.document || { getElementById: () => null },
    localStorage: overrides.localStorage || {
      getItem: () => '',
      setItem: () => {},
      removeItem: () => {}
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__gistExports = { syncGistBidirectionalRemote, startGistAutoSyncRemote };`,
    sandbox,
    { filename: 'gist-sync.js' }
  );

  return {
    sandbox,
    ...sandbox.__gistExports
  };
}

function makeState(localTimestamp) {
  return {
    data: {
      tasks: {},
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
      currentListId: 'l1',
      settings: {
        gistToken: 'token',
        gistId: 'gist-id',
        gistFilename: 'monkeygtd-backup.json',
        gistAutoSyncEnabled: true,
        gistAutoSyncIntervalMin: 5,
        gistLastLocalSaveAt: localTimestamp,
        gistLastSyncAt: localTimestamp
      }
    },
    listId: 'l1',
    msel: new Set()
  };
}

function makeAppCounters() {
  const calls = {
    toast: 0,
    save: 0,
    render: 0,
    syncSettings: 0
  };

  return {
    app: {
      toast: () => { calls.toast += 1; },
      save: () => { calls.save += 1; },
      render: () => { calls.render += 1; },
      syncSettings: () => { calls.syncSettings += 1; }
    },
    calls
  };
}

function metaResponse(updatedAt = '2026-06-27T12:00:00.000Z') {
  return {
    updated_at: updatedAt,
    files: {
      'monkeygtd-backup.json': {
        filename: 'monkeygtd-backup.json',
        truncated: false,
        content: JSON.stringify({
          version: 1,
          exportedAt: updatedAt,
          data: {
            tasks: {},
            lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
            currentListId: 'l1',
            settings: {}
          }
        })
      }
    }
  };
}

function metaResponseWithInbox(updatedAt = '2026-06-27T12:00:00.000Z', inboxLine = '') {
  return {
    updated_at: updatedAt,
    files: {
      'monkeygtd-backup.json': {
        filename: 'monkeygtd-backup.json',
        truncated: false,
        content: JSON.stringify({
          version: 1,
          exportedAt: updatedAt,
          data: {
            tasks: {
              p1: {
                id: 'p1',
                content: 'Parent',
                status: 0,
                checklist_id: 'l1',
                parent_id: '',
                tasks: [],
                tags: {},
                tags_as_text: '',
                color: 0,
                due: '',
                due_asap: false,
                assignees: [],
                notes: [],
                comments_count: 0,
                history: [],
                update_line: '',
                updated_at: updatedAt,
                created_at: updatedAt,
                completed_at: '',
                deleted: false,
                _collapsed: false
              }
            },
            lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: ['p1'] } },
            currentListId: 'l1',
            settings: {}
          }
        })
      },
      'monkeygtd-inbox.ndjson': {
        filename: 'monkeygtd-inbox.ndjson',
        truncated: false,
        content: inboxLine
      }
    }
  };
}

test('syncGistBidirectionalRemote pulls when gist is newer', async () => {
  const localTs = '2026-06-27T10:00:00.000Z';
  const remoteTs = '2026-06-27T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }

    if (String(url).includes('/gists/')) {
      return { ok: true, json: async () => metaResponse(remoteTs) };
    }

    return { ok: true, text: async () => '' };
  };

  const { syncGistBidirectionalRemote } = loadGistSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncGistBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.syncSettings, 1);
  assert.equal(fetchCalls.filter(c => c.method === 'PATCH').length, 0);
});

test('syncGistBidirectionalRemote pushes when local is newer', async () => {
  const localTs = '2026-06-27T12:00:00.000Z';
  const remoteTs = '2026-06-27T10:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    if ((options.method || 'GET') === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }

    if (String(url).includes('/gists/')) {
      return { ok: true, json: async () => metaResponse(remoteTs) };
    }

    return { ok: true, text: async () => '' };
  };

  const { syncGistBidirectionalRemote } = loadGistSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncGistBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 1);
  assert.equal(fetchCalls.filter(c => c.method === 'PATCH').length, 1);
});

test('syncGistBidirectionalRemote does nothing when versions are equal', async () => {
  const sameTs = '2026-06-27T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    if (String(url).includes('/gists/')) {
      return { ok: true, json: async () => metaResponse(sameTs) };
    }
    return { ok: true, text: async () => '' };
  };

  const { syncGistBidirectionalRemote } = loadGistSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncGistBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 0);
  assert.equal(fetchCalls.filter(c => c.method === 'PATCH').length, 0);
});

test('startGistAutoSyncRemote schedules and replaces existing timer every 5 minutes', () => {
  const intervals = [];
  const clears = [];

  const { startGistAutoSyncRemote } = loadGistSyncModule({
    setInterval: (fn, ms) => {
      const id = { fn, ms };
      intervals.push(id);
      return id;
    },
    clearInterval: (id) => {
      clears.push(id);
    }
  });

  const state = makeState('2026-06-27T12:00:00.000Z');
  state.gistAutoSyncTimer = { old: true };
  const { app } = makeAppCounters();

  startGistAutoSyncRemote(app, state, { intervalMs: 5 * 60 * 1000 });

  assert.equal(clears.length, 1);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 5 * 60 * 1000);
  assert.equal(state.gistAutoSyncTimer, intervals[0]);
});

test('startGistAutoSyncRemote does not schedule when auto sync is disabled', () => {
  const intervals = [];
  const clears = [];

  const { startGistAutoSyncRemote } = loadGistSyncModule({
    setInterval: (fn, ms) => {
      const id = { fn, ms };
      intervals.push(id);
      return id;
    },
    clearInterval: (id) => {
      clears.push(id);
    }
  });

  const state = makeState('2026-06-27T12:00:00.000Z');
  state.data.settings.gistAutoSyncEnabled = false;
  state.gistAutoSyncTimer = { old: true };
  const { app } = makeAppCounters();

  const started = startGistAutoSyncRemote(app, state, {});

  assert.equal(started, false);
  assert.equal(clears.length, 1);
  assert.equal(intervals.length, 0);
  assert.equal(state.gistAutoSyncTimer, null);
});

test('startGistAutoSyncRemote uses configured interval minutes from settings', () => {
  const intervals = [];

  const { startGistAutoSyncRemote } = loadGistSyncModule({
    setInterval: (fn, ms) => {
      const id = { fn, ms };
      intervals.push(id);
      return id;
    },
    clearInterval: () => {}
  });

  const state = makeState('2026-06-27T12:00:00.000Z');
  state.data.settings.gistAutoSyncIntervalMin = 7;
  const { app } = makeAppCounters();

  const started = startGistAutoSyncRemote(app, state, {});

  assert.equal(started, true);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0].ms, 7 * 60 * 1000);
});

test('syncGistBidirectionalRemote applies queued addChild inbox requests', async () => {
  const sameTs = '2026-06-27T12:00:00.000Z';
  const queueLine = JSON.stringify({
    id: 'req-1',
    action: 'addChild',
    parentTaskId: 'p1',
    content: 'Queued child task'
  });
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    fetchCalls.push({ url, method, body: options.body || '' });
    if (method === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }
    if (String(url).includes('/gists/')) {
      return { ok: true, json: async () => metaResponseWithInbox(sameTs, queueLine) };
    }
    return { ok: true, text: async () => '' };
  };

  const { syncGistBidirectionalRemote } = loadGistSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  state.data.tasks.p1 = {
    id: 'p1',
    content: 'Parent',
    status: 0,
    checklist_id: 'l1',
    parent_id: '',
    tasks: [],
    tags: {},
    tags_as_text: '',
    color: 0,
    due: '',
    due_asap: false,
    assignees: [],
    notes: [],
    comments_count: 0,
    history: [],
    update_line: '',
    updated_at: sameTs,
    created_at: sameTs,
    completed_at: '',
    deleted: false,
    _collapsed: false
  };
  state.data.lists.l1.root_tasks = ['p1'];
  const { app, calls } = makeAppCounters();

  const changed = await syncGistBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save >= 1, true);
  assert.equal(calls.render >= 1, true);
  const parent = state.data.tasks.p1;
  assert.equal(Array.isArray(parent.tasks), true);
  assert.equal(parent.tasks.length, 1);
  const child = state.data.tasks[parent.tasks[0]];
  assert.equal(!!child, true);
  assert.equal(child.parent_id, 'p1');
  assert.equal(child.content, 'Queued child task');

  const queuePatch = fetchCalls.find(c => c.method === 'PATCH' && String(c.body || '').includes('monkeygtd-inbox.ndjson'));
  assert.equal(!!queuePatch, true);
});
