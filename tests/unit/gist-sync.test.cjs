










































































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
