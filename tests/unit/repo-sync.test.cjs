const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRepoSyncModule(overrides = {}) {
  const sourcePath = path.join(process.cwd(), 'js/infra/repo-sync.js');
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
    },
    Buffer
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__repoExports = { syncRepoBidirectionalRemote, startRepoAutoSyncRemote };`,
    sandbox,
    { filename: 'repo-sync.js' }
  );

  return {
    sandbox,
    ...sandbox.__repoExports
  };
}

function makeState(localTimestamp) {
  return {
    data: {
      tasks: {},
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
      currentListId: 'l1',
      settings: {
        repoToken: 'token',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'main',
        repoPath: 'monkeygtd-backup.json',
        gistLastLocalSaveAt: localTimestamp,
        syncLastAt: localTimestamp
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

function repoGetResponse(updatedAt = '2026-07-18T12:00:00.000Z') {
  const payload = {
    version: 1,
    exportedAt: updatedAt,
    data: {
      tasks: {},
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
      currentListId: 'l1',
      settings: {}
    }
  };

  return {
    sha: 'sha-1',
    content: Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  };
}

test('syncRepoBidirectionalRemote pulls when repo copy is newer', async () => {
  const localTs = '2026-07-18T10:00:00.000Z';
  const remoteTs = '2026-07-18T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    return { ok: true, status: 200, json: async () => repoGetResponse(remoteTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.syncSettings, 1);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pulled');
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 0);
});

test('syncRepoBidirectionalRemote pushes when local copy is newer', async () => {
  const localTs = '2026-07-18T12:00:00.000Z';
  const remoteTs = '2026-07-18T10:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    fetchCalls.push({ url, method });

    if (method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({}) };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(remoteTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 1);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pushed');
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 1);
});

test('syncRepoBidirectionalRemote does nothing when versions are equal', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    return { ok: true, status: 200, json: async () => repoGetResponse(sameTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 1);
  assert.equal(state.data.settings.repoLastSyncSummary, 'In sync');
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 0);
});

test('syncRepoBidirectionalRemote retries once when repo write conflicts', async () => {
  const localTs = '2026-07-18T12:00:00.000Z';
  const remoteTs = '2026-07-18T10:00:00.000Z';
  const fetchCalls = [];
  let putAttempts = 0;

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    fetchCalls.push({ url, method });

    if (method === 'PUT') {
      putAttempts += 1;
      if (putAttempts === 1) {
        return { ok: false, status: 409, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(remoteTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 1);
  assert.equal(calls.syncSettings, 1);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pushed');
  assert.equal(putAttempts, 2);
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 2);
});
