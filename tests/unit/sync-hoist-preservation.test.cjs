const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGistSync() {
  const sourcePath = path.join(process.cwd(), 'js/infra/gist-sync.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  
  const sandbox = {
    console,
    Date,
    JSON,
    Promise,
    setInterval, clearInterval,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    document: { getElementById: () => null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports = { syncGistBidirectionalRemote };`, sandbox);
  return sandbox.__exports;
}

function loadRepoSync() {
  const sourcePath = path.join(process.cwd(), 'js/infra/repo-sync.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  
  const sandbox = {
    console,
    Date,
    JSON,
    Promise,
    fetch: async () => ({ ok: true, json: async () => ({}), text: async () => '' }),
    document: { getElementById: () => null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports = { syncRepoBidirectionalRemote };`, sandbox);
  return sandbox.__exports;
}

test('gist pull preserves hoist state when hoisted task still exists', async () => {
  const { syncGistBidirectionalRemote } = loadGistSync();
  
  const state = {
    data: {
      tasks: {
        h1: { id: 'h1', content: 'Parent', deleted: false, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T10:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false }
      },
      lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
      currentListId: 'l1',
      settings: { gistToken: 'token', gistId: 'gist-id', gistFilename: 'monkeygtd-backup.json', gistLastLocalSaveAt: '2026-06-27T10:00:00.000Z', gistLastSyncAt: '2026-06-27T10:00:00.000Z' }
    },
    listId: 'l1',
    hoistId: 'h1',
    selId: 'h1',
    filter: '#tag1',
    msel: new Set(['h1']),
    editId: null
  };

  const fetchMock = async (url) => {
    if (String(url).includes('/gists/')) {
      return {
        ok: true,
        json: async () => ({
          updated_at: '2026-06-27T12:00:00.000Z',
          files: {
            'monkeygtd-backup.json': {
              filename: 'monkeygtd-backup.json',
              truncated: false,
              content: JSON.stringify({
                version: 1,
                exportedAt: '2026-06-27T12:00:00.000Z',
                data: {
                  tasks: { h1: { id: 'h1', content: 'Parent', deleted: false, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T12:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false } },
                  lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
                  currentListId: 'l1',
                  settings: {}
                }
              })
            }
          }
        })
      };
    }
    return { ok: true, text: async () => '' };
  };

  const app = {
    toast: () => {},
    save: () => {},
    render: () => {},
    syncSettings: () => {}
  };

  const originalFetch = global.fetch;
  global.fetch = fetchMock;
  
  try {
    const sandbox = vm.createContext({ console, Date, JSON, Promise, setInterval, clearInterval, fetch: fetchMock, document: { getElementById: () => null }, localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} } });
    const source = fs.readFileSync(path.join(process.cwd(), 'js/infra/gist-sync.js'), 'utf8');
    vm.runInContext(`${source}\n;globalThis.__exp = { syncGistBidirectionalRemote };`, sandbox);
    await sandbox.__exp.syncGistBidirectionalRemote(app, state, { silent: true, auto: true });
    
    assert.equal(state.hoistId, 'h1');
    assert.equal(state.selId, 'h1');
    assert.equal(state.filter, '#tag1');
    assert.equal(state.msel.size, 1);
    assert.equal(state.msel.has('h1'), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test('gist pull clears hoist if hoisted task was deleted', async () => {
  const state = {
    data: {
      tasks: { h1: { id: 'h1', content: 'Parent', deleted: false, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T10:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false } },
      lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
      currentListId: 'l1',
      settings: { gistToken: 'token', gistId: 'gist-id', gistFilename: 'monkeygtd-backup.json', gistLastLocalSaveAt: '2026-06-27T10:00:00.000Z', gistLastSyncAt: '2026-06-27T10:00:00.000Z' }
    },
    listId: 'l1',
    hoistId: 'h1',
    selId: 'h1',
    filter: '',
    msel: new Set(),
    editId: null
  };

  const fetchMock = async (url) => {
    if (String(url).includes('/gists/')) {
      return {
        ok: true,
        json: async () => ({
          updated_at: '2026-06-27T12:00:00.000Z',
          files: {
            'monkeygtd-backup.json': {
              filename: 'monkeygtd-backup.json',
              truncated: false,
              content: JSON.stringify({
                version: 1,
                exportedAt: '2026-06-27T12:00:00.000Z',
                data: {
                  tasks: { h1: { id: 'h1', content: 'Parent', deleted: true, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T12:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false } },
                  lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
                  currentListId: 'l1',
                  settings: {}
                }
              })
            }
          }
        })
      };
    }
    return { ok: true, text: async () => '' };
  };

  const app = {
    toast: () => {},
    save: () => {},
    render: () => {},
    syncSettings: () => {}
  };

  const sandbox = vm.createContext({ console, Date, JSON, Promise, setInterval, clearInterval, fetch: fetchMock, document: { getElementById: () => null }, localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} } });
  const source = fs.readFileSync(path.join(process.cwd(), 'js/infra/gist-sync.js'), 'utf8');
  vm.runInContext(`${source}\n;globalThis.__exp = { syncGistBidirectionalRemote };`, sandbox);
  await sandbox.__exp.syncGistBidirectionalRemote(app, state, { silent: true, auto: true });
  
  assert.equal(state.hoistId, null);
  assert.equal(state.selId, null);
});

test('repo pull preserves hoist state when hoisted task still exists', async () => {
  const state = {
    data: {
      tasks: {
        h1: { id: 'h1', content: 'Parent', deleted: false, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T10:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false }
      },
      lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
      currentListId: 'l1',
      settings: { repoToken: 'token', repoOwner: 'owner', repoName: 'repo', repoBranch: 'main', repoPath: 'backup.json', repoLastLocalSaveAt: '2026-06-27T10:00:00.000Z', repoLastSyncAt: '2026-06-27T10:00:00.000Z' }
    },
    listId: 'l1',
    hoistId: 'h1',
    selId: 'h1',
    filter: '#tag2',
    msel: new Set(['h1']),
    editId: null
  };

  const fetchMock = async (url) => {
    if (String(url).includes('/repos/')) {
      return {
        ok: true,
        json: async () => ({
          content: Buffer.from(JSON.stringify({
            version: 1,
            exportedAt: '2026-06-27T12:00:00.000Z',
            data: {
              tasks: { h1: { id: 'h1', content: 'Parent', deleted: false, tasks: [], status: 0, checklist_id: 'l1', parent_id: '', tags: {}, tags_as_text: '', color: 0, due: '', due_asap: false, assignees: [], notes: [], comments_count: 0, history: [], update_line: '', updated_at: '2026-06-27T12:00:00.000Z', created_at: '2026-06-27T10:00:00.000Z', completed_at: '', _collapsed: false } },
              lists: { l1: { id: 'l1', name: 'Test', root_tasks: ['h1'] } },
              currentListId: 'l1',
              settings: {}
            }
          })).toString('base64')
        })
      };
    }
    return { ok: true, text: async () => '' };
  };

  const app = {
    toast: () => {},
    save: () => {},
    render: () => {},
    syncSettings: () => {}
  };

  const sandbox = vm.createContext({ console, Date, JSON, Promise, Buffer, fetch: fetchMock, document: { getElementById: () => null }, localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} } });
  const source = fs.readFileSync(path.join(process.cwd(), 'js/infra/repo-sync.js'), 'utf8');
  vm.runInContext(`${source}\n;globalThis.__exp = { syncRepoBidirectionalRemote };`, sandbox);
  await sandbox.__exp.syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  
  assert.equal(state.hoistId, 'h1');
  assert.equal(state.selId, 'h1');
  assert.equal(state.filter, '#tag2');
  assert.equal(state.msel.size, 1);
  assert.equal(state.msel.has('h1'), true);
});
