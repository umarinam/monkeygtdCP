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

test('syncRepoBidirectionalRemote no-op does not bump timestamps or push on next auto tick', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    fetchCalls.push({ url, method: options.method || 'GET' });
    return { ok: true, status: 200, json: async () => repoGetResponse(sameTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  const { app } = makeAppCounters();

  const first = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  const second = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(state.data.settings.syncLastAt, sameTs);
  assert.equal(state.data.settings.repoLastSyncAt, undefined);
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 0);
});

test('syncRepoBidirectionalRemote push does not self-trigger another push from sync save timestamp', async () => {
  const localTs = '2026-07-18T12:00:00.000Z';
  const remoteTs = '2026-07-18T10:00:00.000Z';
  const fetchCalls = [];
  let pushedExportedAt = '';

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    fetchCalls.push({ url, method });

    if (method === 'PUT') {
      const body = JSON.parse(options.body || '{}');
      const raw = Buffer.from(String(body.content || ''), 'base64').toString('utf8');
      pushedExportedAt = JSON.parse(raw).exportedAt || '';
      return { ok: true, status: 200, json: async () => ({}) };
    }

    const remoteAt = pushedExportedAt || remoteTs;
    return { ok: true, status: 200, json: async () => repoGetResponse(remoteAt) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(localTs);
  const app = {
    toast: () => {},
    render: () => {},
    syncSettings: () => {},
    save: (options) => {
      state.data.settings = state.data.settings || {};
      if (!options || options.touchLocalSaveAt !== false) {
        state.data.settings.gistLastLocalSaveAt = '2099-01-01T00:00:00.000Z';
      }
    }
  };

  const first = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  const second = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(first, true);
  assert.equal(second, true);
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 1);
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

test('syncRepoBidirectionalRemote fails gracefully after repeated repo write conflicts', async () => {
  const localTs = '2026-07-18T12:00:00.000Z';
  const remoteTs = '2026-07-18T10:00:00.000Z';
  const statusEl = { textContent: '', style: {} };
  let putAttempts = 0;

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';

    if (method === 'PUT') {
      putAttempts += 1;
      return {
        ok: false,
        status: 409,
        json: async () => ({ message: 'sha does not match latest commit' })
      };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(remoteTs) };
  };

  const documentMock = {
    getElementById: (id) => (id === 'gist-sync-status' ? statusEl : null)
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock, document: documentMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, false);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 0);
  assert.equal(putAttempts, 4);
  assert.equal(statusEl.textContent, 'Repo write conflict after multiple retries. Remote changed repeatedly; run Sync now again.');
});

test('syncRepoBidirectionalRemote returns clear error when remote backup file is empty', async () => {
  const localTs = '2026-07-18T12:00:00.000Z';
  const statusEl = { textContent: '', style: {} };

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const asText = String(url);
    const accept = String(options?.headers?.Accept || '');

    if (method === 'GET' && asText.includes('/contents/') && accept.includes('vnd.github+json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'sha-1',
          content: ''
        })
      };
    }

    if (method === 'GET' && asText.includes('/contents/') && accept.includes('vnd.github.raw')) {
      return {
        ok: true,
        status: 200,
        text: async () => ''
      };
    }

    return { ok: false, status: 500, json: async () => ({}) };
  };

  const documentMock = {
    getElementById: (id) => (id === 'gist-sync-status' ? statusEl : null)
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock, document: documentMock });
  const state = makeState(localTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, false);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.equal(calls.syncSettings, 0);
  assert.equal(statusEl.textContent, 'Remote backup file is empty. Push local data to repair it.');
});

test('syncRepoBidirectionalRemote pulls successfully via download_url when content field is empty', async () => {
  const localTs = '2026-07-18T10:00:00.000Z';
  const remoteTs = '2026-07-18T12:00:00.000Z';

  const payloadText = JSON.stringify({
    version: 1,
    exportedAt: remoteTs,
    data: {
      tasks: {},
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
      currentListId: 'l1',
      settings: {}
    }
  });

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const asText = String(url);
    const accept = String(options?.headers?.Accept || '');

    if (method === 'GET' && asText.includes('/contents/') && accept.includes('vnd.github+json')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'sha-1',
          content: '',
          download_url: 'https://raw.githubusercontent.test/backup.json',
          name: 'monkeygtd-backup.json'
        })
      };
    }

    if (method === 'GET' && asText.includes('/contents/') && accept.includes('vnd.github.raw')) {
      return {
        ok: false,
        status: 404,
        text: async () => ''
      };
    }

    if (method === 'GET' && asText.includes('raw.githubusercontent.test/backup.json')) {
      return {
        ok: true,
        status: 200,
        text: async () => payloadText
      };
    }

    return { ok: false, status: 500, json: async () => ({}) };
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
});

test('syncRepoBidirectionalRemote pulls successfully via git_url blob when content field is empty', async () => {
  const localTs = '2026-07-18T10:00:00.000Z';
  const remoteTs = '2026-07-18T12:00:00.000Z';

  const payloadText = JSON.stringify({
    version: 1,
    exportedAt: remoteTs,
    data: {
      tasks: {},
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: [] } },
      currentListId: 'l1',
      settings: {}
    }
  });

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const asText = String(url);

    if (method === 'GET' && asText.includes('/contents/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'sha-2',
          content: '',
          git_url: 'https://api.github.com/repos/octocat/private-backups/git/blobs/blob-sha',
          name: 'monkeygtd-backup.json'
        })
      };
    }

    if (method === 'GET' && asText.includes('/git/blobs/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          content: Buffer.from(payloadText, 'utf8').toString('base64')
        })
      };
    }

    return { ok: false, status: 500, json: async () => ({}) };
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
});

test('syncRepoBidirectionalRemote applies queued addChild inbox requests', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const queueLine = JSON.stringify({
    id: 'req-1',
    action: 'addChild',
    parentTaskId: 'p1',
    content: 'Queued child task',
    due: '2026-07-21'
  });
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, method, body: options.body || '' });

    if (method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({}) };
    }

    if (urlStr.includes('monkeygtd-inbox.ndjson')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'inbox-sha-1',
          content: Buffer.from(queueLine, 'utf8').toString('base64')
        })
      };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(sameTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
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
    updated_at: sameTs,
    created_at: sameTs,
    completed_at: '',
    deleted: false,
    _collapsed: false
  };
  state.data.lists.l1.root_tasks = ['p1'];
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

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
  assert.equal(child.due, '2026-07-21');

  const queuePut = fetchCalls.find(c => c.method === 'PUT' && String(c.url).includes('monkeygtd-inbox.ndjson'));
  assert.equal(!!queuePut, true);
  const putBody = JSON.parse(queuePut.body);
  const writtenRaw = Buffer.from(putBody.content, 'base64').toString('utf8');
  assert.equal(writtenRaw, '');
});

test('syncRepoBidirectionalRemote applies queued addInbox inbox requests with due date', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const queueLine = JSON.stringify({
    id: 'req-inbox-1',
    action: 'addInbox',
    content: 'Queued root task',
    due: '2026-07-20'
  });
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, method, body: options.body || '' });

    if (method === 'PUT') {
      return { ok: true, status: 200, json: async () => ({}) };
    }

    if (urlStr.includes('monkeygtd-inbox.ndjson')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          sha: 'inbox-sha-2',
          content: Buffer.from(queueLine, 'utf8').toString('base64')
        })
      };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(sameTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save >= 1, true);
  assert.equal(calls.render >= 1, true);

  const roots = state.data.lists.l1.root_tasks || [];
  assert.equal(roots.length, 1);
  const task = state.data.tasks[roots[0]];
  assert.equal(!!task, true);
  assert.equal(task.parent_id, '');
  assert.equal(task.content, 'Queued root task');
  assert.equal(task.due, '2026-07-20');

  const queuePut = fetchCalls.find(c => c.method === 'PUT' && String(c.url).includes('monkeygtd-inbox.ndjson'));
  assert.equal(!!queuePut, true);
});

test('syncRepoBidirectionalRemote leaves inbox queue untouched when there is nothing to process', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const fetchCalls = [];

  const fetchMock = async (url, options = {}) => {
    const method = options.method || 'GET';
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, method });

    if (urlStr.includes('monkeygtd-inbox.ndjson')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }

    return { ok: true, status: 200, json: async () => repoGetResponse(sameTs) };
  };

  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch: fetchMock });
  const state = makeState(sameTs);
  const { app, calls } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(calls.save, 0);
  assert.equal(calls.render, 0);
  assert.equal(state.data.settings.repoLastSyncSummary, 'In sync');
  assert.equal(fetchCalls.filter(c => c.method === 'PUT').length, 0);
});

// Fake repo whose inbox file shrinks when the app PUTs it, like the real API.
function makeStatefulRepoFetch(remoteTs, inboxLine) {
  const repo = { inbox: inboxLine, backupPushes: [], failBackupPush: false };
  const remotePayload = {
    version: 1,
    exportedAt: remoteTs,
    data: {
      tasks: { p1: { id: 'p1', content: 'Parent', status: 0, checklist_id: 'l1', parent_id: '', tasks: [] } },
      lists: { l1: { id: 'l1', name: 'Inbox', root_tasks: ['p1'] } },
      currentListId: 'l1',
      settings: {}
    }
  };
  const fetch = async (url, options = {}) => {
    const method = options.method || 'GET';
    const isInbox = String(url).includes('monkeygtd-inbox.ndjson');
    if (method === 'PUT') {
      if (!isInbox && repo.failBackupPush) return { ok: false, status: 500, json: async () => ({}) };
      const raw = Buffer.from(JSON.parse(options.body).content, 'base64').toString('utf8');
      if (isInbox) repo.inbox = raw;
      else repo.backupPushes.push(JSON.parse(raw));
      return { ok: true, status: 200, json: async () => ({}) };
    }
    const raw = isInbox ? repo.inbox : JSON.stringify(remotePayload);
    return {
      ok: true,
      status: 200,
      json: async () => ({ sha: isInbox ? 'inbox-sha' : 'sha-1', content: Buffer.from(raw, 'utf8').toString('base64') }),
      text: async () => raw
    };
  };
  return { repo, fetch };
}

async function syncQueuedInboxAgainstNewerRepo(remoteTs) {
  const queueLine = JSON.stringify({ id: 'req-pull-1', action: 'addInbox', content: 'Queued while remote changed' });
  const { repo, fetch } = makeStatefulRepoFetch(remoteTs, queueLine);
  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch });
  // Local copy predates the remote one, which another device pushed with task p1 in it.
  const state = makeState('2026-07-18T10:00:00.000Z');
  const { app } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  return { changed, repo, state };
}

function assertPulledWithQueuedTask({ changed, repo, state }) {
  assert.equal(changed, true);
  assert.equal(state.data.tasks.p1?.content, 'Parent', 'remote-only task should be pulled');
  const queued = Object.values(state.data.tasks).filter(t => t.content === 'Queued while remote changed');
  assert.equal(queued.length, 1, 'queued inbox task should survive the pull');
  assert.equal(state.data.lists.l1.root_tasks.includes(queued[0].id), true);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pulled + inbox imported 1');
  assert.equal(repo.inbox, '');
  // The only push comes after the pull, so it carries the remote's task plus the imported one.
  assert.equal(repo.backupPushes.length, 1);
  const pushedContents = Object.values(repo.backupPushes[0].data.tasks).map(t => t.content).sort();
  assert.deepEqual(pushedContents, ['Parent', 'Queued while remote changed']);
}

test('syncRepoBidirectionalRemote pulls a newer repo copy before pushing queued inbox requests', async () => {
  assertPulledWithQueuedTask(await syncQueuedInboxAgainstNewerRepo('2026-07-18T12:00:00.000Z'));
});

test('syncRepoBidirectionalRemote keeps queued inbox tasks when a far-future repo copy wins the pull', async () => {
  assertPulledWithQueuedTask(await syncQueuedInboxAgainstNewerRepo('2099-01-01T00:00:00.000Z'));
});

test('syncRepoBidirectionalRemote retries pushing pulled inbox imports on the next sync after a failed push', async () => {
  const queueLine = JSON.stringify({ id: 'req-retry-1', action: 'addInbox', content: 'Queued before a failed push' });
  const { repo, fetch } = makeStatefulRepoFetch('2026-07-18T12:00:00.000Z', queueLine);
  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch });
  const state = makeState('2026-07-18T10:00:00.000Z');
  const app = {
    toast: () => {},
    render: () => {},
    syncSettings: () => {},
    save: (options) => {
      if (!options || options.touchLocalSaveAt !== false) {
        state.data.settings.gistLastLocalSaveAt = new Date().toISOString();
      }
    }
  };

  repo.failBackupPush = true;
  const first = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  assert.equal(first, true);
  assert.equal(repo.backupPushes.length, 0);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pulled + inbox imported 1 (not pushed)');

  repo.failBackupPush = false;
  const second = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  assert.equal(second, true);
  assert.equal(repo.backupPushes.length, 1, 'next sync should push, not pull over the imported task');
  const pushedContents = Object.values(repo.backupPushes[0].data.tasks).map(t => t.content).sort();
  assert.deepEqual(pushedContents, ['Parent', 'Queued before a failed push']);
});

test('syncRepoBidirectionalRemote pushes inbox imports when versions are otherwise equal', async () => {
  const sameTs = '2026-07-18T12:00:00.000Z';
  const queueLine = JSON.stringify({ id: 'req-eq-1', action: 'addInbox', content: 'Queued with nothing else new' });
  const { repo, fetch } = makeStatefulRepoFetch(sameTs, queueLine);
  const { syncRepoBidirectionalRemote } = loadRepoSyncModule({ fetch });
  const state = makeState(sameTs);
  state.data.tasks.p1 = { id: 'p1', content: 'Parent', status: 0, checklist_id: 'l1', parent_id: '', tasks: [] };
  state.data.lists.l1.root_tasks = ['p1'];
  const { app } = makeAppCounters();

  const changed = await syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });

  assert.equal(changed, true);
  assert.equal(repo.backupPushes.length, 1);
  const pushedContents = Object.values(repo.backupPushes[0].data.tasks).map(t => t.content).sort();
  assert.deepEqual(pushedContents, ['Parent', 'Queued with nothing else new']);
  assert.equal(state.data.settings.repoLastSyncSummary, 'Pushed');
  assert.equal(repo.inbox, '');
});
