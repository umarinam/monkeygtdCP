const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function readInboxScript() {
  const html = fs.readFileSync('Inbox.html', 'utf8');
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  assert.ok(match, 'Inbox.html should contain an inline script block');
  return match[1];
}

function createElement(id) {
  let innerHtml = '';
  const el = {
    id,
    value: '',
    style: { display: '' },
    disabled: false,
    className: '',
    textContent: '',
    children: [],
    listeners: {},
    classList: {
      _set: new Set(),
      add(cls) { this._set.add(cls); },
      remove(cls) { this._set.delete(cls); },
      toggle(cls, on) {
        if (on) this._set.add(cls); else this._set.delete(cls);
      },
      contains(cls) { return this._set.has(cls); }
    },
    addEventListener(type, cb) {
      this.listeners[type] = cb;
    },
    focusCount: 0,
    focus() {
      this.focusCount++;
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    reset() {}
  };

  Object.defineProperty(el, 'innerHTML', {
    get() {
      return innerHtml;
    },
    set(next) {
      innerHtml = String(next || '');
      if (innerHtml === '') el.children = [];
    }
  });

  // <select>-like elements expose their <option> children as .options
  Object.defineProperty(el, 'options', {
    get() {
      return el.children;
    }
  });

  return el;
}

function createStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    snapshot() {
      return Object.fromEntries(map);
    }
  };
}

// Date stand-in with a settable "now", so due-today behavior is deterministic
// and a page left open past midnight can be simulated. Use local-time ISO
// strings (no Z) so the local calendar date is the same in every timezone.
function createClock(localIso) {
  let nowMs = new Date(localIso).getTime();
  class ClockDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(nowMs);
      else super(...args);
    }
    static now() {
      return nowMs;
    }
  }
  return {
    Date: ClockDate,
    set(nextLocalIso) {
      nowMs = new Date(nextLocalIso).getTime();
    }
  };
}

function bootInbox(localSeed = {}, options = {}) {
  const elements = {
    taskForm: createElement('taskForm'),
    statusMessage: createElement('statusMessage'),
    authWarning: createElement('authWarning'),
    submitBtn: createElement('submitBtn'),
    syncInfo: createElement('syncInfo'),
    credsSetup: createElement('credsSetup'),
    credsToken: createElement('credsToken'),
    credsId: createElement('credsId'),
    saveCredsBtn: createElement('saveCredsBtn'),
    credsSetupRepo: createElement('credsSetupRepo'),
    credsRepoToken: createElement('credsRepoToken'),
    credsRepoOwner: createElement('credsRepoOwner'),
    credsRepoName: createElement('credsRepoName'),
    credsRepoBranch: createElement('credsRepoBranch'),
    saveRepoCredsBtn: createElement('saveRepoCredsBtn'),
    taskTitle: createElement('taskTitle'),
    taskParentId: createElement('taskParentId'),
    taskParentTitle: createElement('taskParentTitle'),
    taskDueDate: createElement('taskDueDate'),
    parentSuggestions: createElement('parentSuggestions'),
    recentParents: createElement('recentParents'),
    taskDescription: createElement('taskDescription'),
    taskListId: createElement('taskListId'),
    taskParentTaskId: createElement('taskParentTaskId'),
    refreshListsBtn: createElement('refreshListsBtn'),
    listsStatus: createElement('listsStatus'),
    entrySummary: createElement('entrySummary'),
    advancedParent: createElement('advancedParent')
  };

  const inputs = [
    elements.taskTitle,
    elements.taskParentId,
    elements.taskParentTitle,
    elements.taskDueDate,
    elements.taskDescription,
    elements.taskListId,
    elements.taskParentTaskId
  ];
  elements.taskForm.reset = () => {
    inputs.forEach((el) => {
      el.value = '';
    });
  };

  const backupPayload = options.backupPayload || null;
  const backupFilename = options.backupFilename || 'monkeygtd-backup.json';
  const extraGistFiles = options.extraGistFiles || null;
  const repoBackupPath = options.repoBackupPath || 'monkeygtd-backup.json';
  // Simulates GitHub Contents API's >1MB behavior: content comes back empty,
  // and only the download_url fallback is wired up to actually succeed here
  // (git_url and the raw Accept header both fall through to the inert
  // catch-all below), so this proves the full fallback chain is exercised
  // end-to-end rather than accidentally short-circuiting on the first step.
  const repoBackupOversized = !!options.repoBackupOversized;
  const repoBackupDownloadUrl = `https://raw.githubusercontent.com/octocat/private-backups/main/${repoBackupPath}`;

  const document = {
    getElementById(id) {
      return elements[id];
    },
    createElement(tag) {
      const el = createElement(tag);
      el.tagName = String(tag || '').toUpperCase();
      return el;
    }
  };

  const window = {
    _listeners: {},
    addEventListener(type, cb) {
      this._listeners[type] = cb;
    }
  };

  const localStorage = createStorage(localSeed);
  const fetchCalls = [];
  const timers = [];
  let inboxContent = '';
  let repoInboxContent = '';
  let repoInboxSha = '';

  const context = {
    window,
    document,
    localStorage,
    fetch: async (url, options) => {
      const method = (options && options.method) || 'GET';
      fetchCalls.push({ url, method, options });

      if (String(url).includes('/gists/')) {
        if (method === 'GET') {
          return {
            ok: true,
            json: async () => ({
              files: {
                'monkeygtd-inbox.ndjson': {
                  filename: 'monkeygtd-inbox.ndjson',
                  truncated: false,
                  content: inboxContent
                },
                ...(backupPayload ? {
                  [backupFilename]: {
                    filename: backupFilename,
                    truncated: false,
                    content: JSON.stringify(backupPayload)
                  }
                } : {}),
                ...(extraGistFiles || {})
              }
            })
          };
        }

        if (method === 'PATCH') {
          const body = JSON.parse(options.body || '{}');
          inboxContent = body.files['monkeygtd-inbox.ndjson'].content;
          return { ok: true, json: async () => ({}) };
        }
      }

      if (String(url).includes('/contents/monkeygtd-inbox.ndjson')) {
        if (method === 'GET') {
          if (!repoInboxContent) return { ok: false, status: 404, json: async () => ({}) };
          return {
            ok: true,
            json: async () => ({
              sha: repoInboxSha,
              content: Buffer.from(repoInboxContent, 'utf8').toString('base64')
            })
          };
        }

        if (method === 'PUT') {
          const body = JSON.parse(options.body || '{}');
          repoInboxContent = Buffer.from(body.content || '', 'base64').toString('utf8');
          repoInboxSha = 'repo-inbox-sha-2';
          return { ok: true, json: async () => ({ content: { sha: repoInboxSha } }) };
        }
      }

      if (String(url).includes(`/contents/${repoBackupPath}`) && method === 'GET') {
        if (!backupPayload) return { ok: false, status: 404, json: async () => ({}) };
        if (repoBackupOversized) {
          const acceptsRaw = options?.headers?.Accept === 'application/vnd.github.raw';
          if (acceptsRaw) {
            // Simulate this fallback also not yielding content, so the test
            // actually exercises the last-resort download_url step below.
            return { ok: true, text: async () => '' };
          }
          return {
            ok: true,
            json: async () => ({
              sha: 'backup-sha-1',
              content: '',
              encoding: 'none',
              git_url: 'https://api.github.com/repos/octocat/private-backups/git/blobs/fake-blob-sha',
              download_url: repoBackupDownloadUrl
            })
          };
        }
        return {
          ok: true,
          json: async () => ({
            sha: 'backup-sha-1',
            content: Buffer.from(JSON.stringify(backupPayload), 'utf8').toString('base64')
          })
        };
      }

      if (String(url) === repoBackupDownloadUrl && method === 'GET') {
        return { ok: true, text: async () => JSON.stringify(backupPayload) };
      }

      return { ok: true, text: async () => inboxContent, json: async () => ({}) };
    },
    setTimeout: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    clearTimeout: () => {},
    Date: options.clock ? options.clock.Date : Date,
    JSON,
    console,
    crypto: {
      randomUUID: () => 'uuid-fixed'
    },
    btoa: (text) => Buffer.from(String(text), 'binary').toString('base64'),
    atob: (b64) => Buffer.from(String(b64), 'base64').toString('binary')
  };

  vm.runInNewContext(readInboxScript(), context);

  if (window._listeners.load) {
    window._listeners.load();
  }

  return {
    elements,
    window,
    localStorage,
    fetchCalls,
    runTimers: () => timers.splice(0).forEach((fn) => fn()),
    getInboxContent: () => inboxContent,
    getRepoInboxContent: () => repoInboxContent
  };
}

function credsSeed() {
  return {
    mgtd3: JSON.stringify({ settings: { gistToken: 'tok_123', gistId: 'gid_123' } })
  };
}

function repoCredsSeed() {
  return {
    mgtd3: JSON.stringify({
      settings: {
        syncProvider: 'repo',
        repoToken: 'repo_tok_123',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'main',
        repoPath: 'monkeygtd-backup.json'
      }
    })
  };
}

test('Inbox submit queues addChild with parentId and due, then caches parent id with title', async () => {
  const { elements, localStorage, fetchCalls, getInboxContent } = bootInbox(credsSeed());

  elements.taskTitle.value = 'Follow up with design team';
  elements.taskDescription.value = 'Use latest mock.';
  elements.taskParentId.value = 'p-42';
  elements.taskParentTitle.value = 'Website Redesign';
  elements.taskDueDate.value = '2026-07-15';

  await elements.taskForm.listeners.submit({ preventDefault() {} });

  assert.equal(fetchCalls.some((c) => c.method === 'GET' && String(c.url).includes('/gists/')), true);
  assert.equal(fetchCalls.some((c) => c.method === 'PATCH' && String(c.url).includes('/gists/')), true);

  const lines = getInboxContent().trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const queued = JSON.parse(lines[0]);
  assert.equal(queued.action, 'addChild');
  assert.equal(queued.parentTaskId, 'p-42');
  assert.equal(queued.due, '2026-07-15');
  assert.equal(queued.title, 'Follow up with design team');

  const cache = JSON.parse(localStorage.getItem('mgtd3_inbox_parent_cache'));
  assert.equal(Array.isArray(cache), true);
  assert.equal(cache[0].id, 'p-42');
  assert.equal(cache[0].title, 'Website Redesign');
});

test('Inbox submit without parent queues addInbox request', async () => {
  const { elements, getInboxContent } = bootInbox(credsSeed());

  elements.taskTitle.value = 'Capture idea';
  elements.taskDescription.value = 'No parent selected';
  elements.taskParentId.value = '';
  elements.taskParentTitle.value = '';
  elements.taskDueDate.value = '2026-07-30';

  await elements.taskForm.listeners.submit({ preventDefault() {} });

  const line = getInboxContent().trim();
  const queued = JSON.parse(line);
  assert.equal(queued.action, 'addInbox');
  assert.equal(queued.parentTaskId, undefined);
  assert.equal(queued.due, '2026-07-30');
});

test('Inbox submit in repo provider mode queues via Repo Contents API', async () => {
  const { elements, fetchCalls, getRepoInboxContent } = bootInbox(repoCredsSeed());

  elements.taskTitle.value = 'Queued via repo';
  elements.taskDescription.value = '';
  elements.taskParentId.value = '';
  elements.taskParentTitle.value = '';
  elements.taskDueDate.value = '2026-08-01';

  await elements.taskForm.listeners.submit({ preventDefault() {} });

  assert.equal(fetchCalls.some((c) => c.method === 'GET' && String(c.url).includes('/contents/monkeygtd-inbox.ndjson')), true);
  assert.equal(fetchCalls.some((c) => c.method === 'PUT' && String(c.url).includes('/contents/monkeygtd-inbox.ndjson')), true);

  const line = getRepoInboxContent().trim();
  const queued = JSON.parse(line);
  assert.equal(queued.action, 'addInbox');
  assert.equal(queued.due, '2026-08-01');
  assert.equal(queued.title, 'Queued via repo');
});

test('Inbox shows default parent seeds when cache is empty', () => {
  const { elements } = bootInbox(credsSeed());
  // 4 default parents should be rendered
  assert.equal(elements.recentParents.children.length, 4);
  assert.equal(elements.recentParents.style.display, 'flex');
  const firstPill = elements.recentParents.children[0].children[0];
  assert.equal(firstPill.textContent.includes('Email'), true);
});

test('Inbox displays Gist mode and inbox file name on load', () => {
  const { elements } = bootInbox(credsSeed());
  assert.equal(elements.syncInfo.textContent, 'Gist mode • Inbox: monkeygtd-inbox.ndjson');
});

test('Inbox displays Repo mode and computed inbox path on load', () => {
  const { elements } = bootInbox(repoCredsSeed());
  assert.equal(elements.syncInfo.textContent, 'Repo mode • Inbox: monkeygtd-inbox.ndjson');
});

test('Inbox parent suggestions load from cache and auto-fill parent title for known IDs', () => {
  const seed = {
    ...credsSeed(),
    mgtd3_inbox_parent_cache: JSON.stringify([
      { id: 'parent-a', title: 'Quarterly Planning', updatedAt: '2026-07-01T09:00:00.000Z' }
    ])
  };

  const { elements } = bootInbox(seed);

  assert.equal(elements.parentSuggestions.children.length, 1);
  assert.equal(elements.parentSuggestions.children[0].value, 'parent-a');
  assert.equal(elements.parentSuggestions.children[0].label, 'parent-a - Quarterly Planning');
  assert.equal(elements.recentParents.children.length, 1);
  assert.equal(elements.recentParents.style.display, 'flex');

  elements.taskParentTitle.value = '';
  elements.taskParentId.value = 'parent-a';
  elements.taskParentId.listeners.input();
  assert.equal(elements.taskParentTitle.value, 'Quarterly Planning');

  elements.taskParentId.value = '';
  elements.taskParentTitle.value = '';
  const recentRow = elements.recentParents.children[0];
  const selectBtn = recentRow.children[0];
  selectBtn.listeners.click();
  assert.equal(elements.taskParentId.value, 'parent-a');
  assert.equal(elements.taskParentTitle.value, 'Quarterly Planning');

  const removeBtn = recentRow.children[1];
  removeBtn.listeners.click({ preventDefault() {}, stopPropagation() {} });
  // After removing the one user item, cache is empty so defaults (4) are shown
  assert.equal(elements.recentParents.children.length, 4);
  assert.equal(elements.recentParents.style.display, 'flex');
  assert.equal(elements.taskParentId.value, '');
  assert.equal(elements.taskParentTitle.value, '');
});

function backupSeed() {
  return {
    lists: {
      l1: { id: 'l1', name: 'Work Projects', archived: false, root_tasks: ['t1', 't2'] },
      l2: { id: 'l2', name: 'Personal', archived: false, root_tasks: ['t3'] },
      l3: { id: 'l3', name: 'Archived Stuff', archived: true, root_tasks: [] }
    },
    tasks: {
      t1: { id: 't1', content: 'Website Redesign', deleted: false, checklist_id: 'l1', tasks: [] },
      t2: { id: 't2', content: 'Q3 Planning\nsome notes', deleted: false, checklist_id: 'l1', tasks: [] },
      t3: { id: 't3', content: 'Home Renovation', deleted: false, checklist_id: 'l2', tasks: [] }
    }
  };
}

test('Inbox loads remote lists into the List dropdown, excluding archived lists', async () => {
  const { elements } = bootInbox(credsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();

  const values = elements.taskListId.children.map((o) => o.value);
  const labels = elements.taskListId.children.map((o) => o.textContent);
  assert.deepEqual(values, ['', 'l2', 'l1']);
  assert.deepEqual(labels, ['Default (let sync decide)', 'Personal', 'Work Projects']);
});

test('Inbox finds the backup under a differently-named .json file when gistFilename does not match (mirrors gistPickFile fallback)', async () => {
  const seed = {
    mgtd3: JSON.stringify({ settings: { gistToken: 'tok_123', gistId: 'gid_123', gistFilename: 'monkeygtd-backup.json' } })
  };
  // The real file in the gist is named differently than the configured
  // gistFilename (e.g. renamed once, or never matched). The app's own
  // pull/sync path (gistPickFile) tolerates this by falling back to any
  // .json file - the Inbox picker must do the same instead of reporting
  // "not found"/"empty".
  const { elements } = bootInbox(seed, { backupPayload: backupSeed(), backupFilename: 'my-renamed-backup.json' });

  await elements.refreshListsBtn.listeners.click();

  const values = elements.taskListId.children.map((o) => o.value);
  assert.deepEqual(values, ['', 'l2', 'l1']);
  assert.equal(elements.listsStatus.textContent.includes('Could not load'), false);
});

test('Inbox reports an empty backup file (not a silent fallback) when the exact gistFilename match exists but is empty', async () => {
  const seed = {
    mgtd3: JSON.stringify({ settings: { gistToken: 'tok_123', gistId: 'gid_123', gistFilename: 'monkeygtd-backup.json' } })
  };
  // Matches gistPickFile's precedence: an exact filename match wins even if
  // a different .json file also exists, so a genuinely-empty file at the
  // expected name is NOT silently bypassed in favor of the other file.
  const { elements } = bootInbox(seed, {
    backupPayload: backupSeed(),
    backupFilename: 'some-other-backup.json',
    extraGistFiles: {
      'monkeygtd-backup.json': { filename: 'monkeygtd-backup.json', truncated: false, content: '' }
    }
  });

  await elements.refreshListsBtn.listeners.click();

  assert.equal(elements.taskListId.children.length, 0);
  assert.equal(elements.listsStatus.textContent.includes('monkeygtd-backup.json'), true);
  assert.equal(elements.listsStatus.textContent.includes('some-other-backup.json'), true);
});

test('Inbox populates the Parent task dropdown from the selected list\'s root tasks only', async () => {
  const { elements } = bootInbox(credsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();

  elements.taskListId.value = 'l1';
  elements.taskListId.listeners.change();

  assert.equal(elements.taskParentTaskId.disabled, false);
  const options = elements.taskParentTaskId.children.map((o) => ({ v: o.value, t: o.textContent }));
  assert.deepEqual(options, [
    { v: '', t: 'No parent — add to list root' },
    { v: 't1', t: 'Website Redesign' },
    { v: 't2', t: 'Q3 Planning' }
  ]);
});

test('Inbox selecting a Parent task fills in the manual Parent ID/Title fields used at submit time', async () => {
  const { elements, getInboxContent } = bootInbox(credsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();
  elements.taskListId.value = 'l1';
  elements.taskListId.listeners.change();

  elements.taskParentTaskId.value = 't2';
  elements.taskParentTaskId.listeners.change();
  assert.equal(elements.taskParentId.value, 't2');
  assert.equal(elements.taskParentTitle.value, 'Q3 Planning');

  elements.taskTitle.value = 'Draft the outline';
  await elements.taskForm.listeners.submit({ preventDefault() {} });

  const queued = JSON.parse(getInboxContent().trim());
  assert.equal(queued.action, 'addChild');
  assert.equal(queued.parentTaskId, 't2');
  assert.equal(queued.listId, undefined);
});

test('Inbox submitting with a list chosen but no parent adds the task to that list\'s root', async () => {
  const { elements, getInboxContent } = bootInbox(credsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();
  elements.taskListId.value = 'l2';
  elements.taskListId.listeners.change();

  elements.taskTitle.value = 'Buy paint';
  await elements.taskForm.listeners.submit({ preventDefault() {} });

  const queued = JSON.parse(getInboxContent().trim());
  assert.equal(queued.action, 'addInbox');
  assert.equal(queued.listId, 'l2');
  assert.equal(queued.parentTaskId, undefined);
});

test('Inbox switching lists clears a previously selected parent and refreshes its options', async () => {
  const { elements } = bootInbox(credsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();
  elements.taskListId.value = 'l1';
  elements.taskListId.listeners.change();
  elements.taskParentTaskId.value = 't1';
  elements.taskParentTaskId.listeners.change();
  assert.equal(elements.taskParentId.value, 't1');

  elements.taskListId.value = 'l2';
  elements.taskListId.listeners.change();

  assert.equal(elements.taskParentId.value, '');
  assert.equal(elements.taskParentTitle.value, '');
  const options = elements.taskParentTaskId.children.map((o) => o.value);
  assert.deepEqual(options, ['', 't3']);
});

test('Inbox loads lists via the Repo Contents API when repo provider is configured', async () => {
  const { elements } = bootInbox(repoCredsSeed(), { backupPayload: backupSeed() });

  await elements.refreshListsBtn.listeners.click();

  const values = elements.taskListId.children.map((o) => o.value);
  assert.deepEqual(values, ['', 'l2', 'l1']);
});

test('Inbox falls back to download_url when a repo backup file exceeds the Contents API 1MB inline limit', async () => {
  // Reproduces the reported bug: "<file>.json is empty" even though the app
  // itself syncs fine. GitHub's Contents API omits `content` for files over
  // 1MB; the app's own repoFetchFile() falls back to git_url, then the raw
  // Accept header, then download_url. The Inbox picker must do the same
  // instead of treating an empty inline `content` as a genuinely empty file.
  const seed = {
    mgtd3: JSON.stringify({
      settings: {
        syncProvider: 'repo',
        repoToken: 'repo_tok_123',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'main',
        repoPath: 'ToDoH2-2026.json'
      }
    })
  };

  const { elements } = bootInbox(seed, {
    backupPayload: backupSeed(),
    repoBackupPath: 'ToDoH2-2026.json',
    repoBackupOversized: true
  });

  await elements.refreshListsBtn.listeners.click();

  const values = elements.taskListId.children.map((o) => o.value);
  assert.deepEqual(values, ['', 'l2', 'l1']);
  assert.equal(elements.listsStatus.textContent.includes('Could not load'), false);
});

test('Inbox falls back to manual Parent ID entry when the remote backup cannot be loaded', async () => {
  const { elements } = bootInbox(credsSeed()); // no backupPayload seeded -> 404s

  await elements.refreshListsBtn.listeners.click();

  // populateListDropdown() is never called on a failed fetch with no cache, so
  // the JS leaves the dropdown's static "Default" option (defined in the real
  // HTML, outside the scope of this inline-script-only test harness) alone.
  assert.equal(elements.taskListId.children.length, 0);
  assert.equal(elements.listsStatus.textContent.includes('Could not load lists'), true);
  assert.equal(elements.listsStatus.classList.contains('error'), true);
});

function backupCacheSeed(backup = backupSeed()) {
  return {
    mgtd3_inbox_backup_cache: JSON.stringify({ ...backup, fetchedAt: '2026-09-27T08:00:00.000Z' })
  };
}

function prefsSeed(prefs) {
  return { mgtd3_inbox_prefs: JSON.stringify(prefs) };
}

function chipTexts(elements) {
  return elements.entrySummary.children.map((c) => c.textContent);
}

// Lets the fake fetch chain behind a fire-and-forget submit (Enter key) settle.
function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function readPrefs(localStorage) {
  return JSON.parse(localStorage.getItem('mgtd3_inbox_prefs'));
}

test('Inbox starts in quick entry mode: due today, default list, options summarized in one line', () => {
  const clock = createClock('2026-09-27T09:00:00');
  const { elements } = bootInbox(credsSeed(), { clock });

  assert.equal(elements.taskDueDate.value, '2026-09-27');
  assert.equal(elements.taskListId.children.length, 0, 'no remembered list, so no placeholder option');
  assert.deepEqual(chipTexts(elements), ['📋 Default list', '📅 Due today']);
});

test('Inbox remembers the selected list, parent and due date across sessions', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const first = bootInbox({ ...credsSeed(), ...backupCacheSeed() }, { clock });

  first.elements.taskListId.value = 'l1';
  first.elements.taskListId.listeners.change();
  first.elements.taskParentTaskId.value = 't2';
  first.elements.taskParentTaskId.listeners.change();
  first.elements.taskDueDate.value = '2026-10-02';
  first.elements.taskDueDate.listeners.change();

  assert.deepEqual(readPrefs(first.localStorage), {
    listId: 'l1',
    listName: 'Work Projects',
    parentId: 't2',
    parentTitle: 'Q3 Planning',
    due: '2026-10-02'
  });

  // Reopen the page with the same browser storage.
  const second = bootInbox(first.localStorage.snapshot(), { clock });
  const el = second.elements;
  const oct2 = new Date('2026-10-02T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

  assert.equal(el.taskListId.value, 'l1');
  assert.equal(el.taskParentTaskId.value, 't2');
  assert.equal(el.taskParentId.value, 't2');
  assert.equal(el.taskDueDate.value, '2026-10-02');
  assert.deepEqual(chipTexts(el), ['📋 Work Projects', '↳ Q3 Planning', `📅 Due ${oct2}`]);

  el.taskTitle.value = 'Draft agenda';
  await el.taskForm.listeners.submit({ preventDefault() {} });

  const queued = JSON.parse(second.getInboxContent().trim());
  assert.equal(queued.action, 'addChild');
  assert.equal(queued.parentTaskId, 't2');
  assert.equal(queued.due, '2026-10-02');
});

test('Inbox keeps a remembered list selected even before the lists have loaded', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  // No backup cache and no reachable backup: the list options never load.
  const seed = { ...credsSeed(), ...prefsSeed({ listId: 'l2', listName: 'Personal', due: 'today' }) };
  const { elements, getInboxContent } = bootInbox(seed, { clock });

  assert.equal(elements.taskListId.value, 'l2');
  assert.deepEqual(chipTexts(elements), ['📋 Personal', '📅 Due today']);

  elements.taskTitle.value = 'Buy paint';
  await elements.taskForm.listeners.submit({ preventDefault() {} });

  const queued = JSON.parse(getInboxContent().trim());
  assert.equal(queued.action, 'addInbox');
  assert.equal(queued.listId, 'l2');
  assert.equal(queued.due, '2026-09-27');
});

test('Inbox sends on Enter in the title, keeps the presets, clears the text, and ignores repeat presses while sending', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const seed = { ...credsSeed(), ...prefsSeed({ listId: 'l2', listName: 'Personal', due: 'today' }) };
  const { elements, getInboxContent } = bootInbox(seed, { clock });

  elements.taskTitle.value = 'Call plumber';
  elements.taskDescription.value = 'About the leak';
  elements.taskTitle.listeners.keydown({ key: 'a', preventDefault() { throw new Error('should not intercept'); } });

  let prevented = 0;
  const enter = { key: 'Enter', preventDefault() { prevented++; } };
  elements.taskTitle.listeners.keydown(enter);
  elements.taskTitle.listeners.keydown(enter); // pressed again while the first send is in flight
  await settle();

  const lines = getInboxContent().trim().split(/\r?\n/);
  assert.equal(lines.length, 1);
  const queued = JSON.parse(lines[0]);
  assert.equal(queued.title, 'Call plumber');
  assert.equal(queued.listId, 'l2');
  assert.equal(queued.due, '2026-09-27');
  assert.equal(prevented, 2);

  assert.equal(elements.taskTitle.value, '');
  assert.equal(elements.taskDescription.value, '');
  assert.equal(elements.taskTitle.focusCount > 0, true, 'title is refocused for the next entry');
  assert.equal(elements.taskListId.value, 'l2');
  assert.equal(elements.taskDueDate.value, '2026-09-27');
});

test('Inbox Clear empties the typed text but keeps the remembered list and due date', () => {
  const clock = createClock('2026-09-27T09:00:00');
  const seed = { ...credsSeed(), ...prefsSeed({ listId: 'l2', listName: 'Personal', due: '2026-10-05' }) };
  const { elements } = bootInbox(seed, { clock });

  elements.taskTitle.value = 'Half-typed';
  elements.taskDescription.value = 'notes';
  let prevented = false;
  elements.taskForm.listeners.reset({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true, 'native reset would wipe the presets');
  assert.equal(elements.taskTitle.value, '');
  assert.equal(elements.taskDescription.value, '');
  assert.equal(elements.taskListId.value, 'l2');
  assert.equal(elements.taskDueDate.value, '2026-10-05');
});

test('Inbox restores "due today" as the current day, a lapsed date as today, and a future date as-is', () => {
  const clock = createClock('2026-09-28T09:00:00');

  const today = bootInbox({ ...credsSeed(), ...prefsSeed({ due: 'today' }) }, { clock });
  assert.equal(today.elements.taskDueDate.value, '2026-09-28');

  const lapsed = bootInbox({ ...credsSeed(), ...prefsSeed({ due: '2026-09-20' }) }, { clock });
  assert.equal(lapsed.elements.taskDueDate.value, '2026-09-28');
  assert.deepEqual(chipTexts(lapsed.elements), ['📋 Default list', '📅 Due today']);

  const future = bootInbox({ ...credsSeed(), ...prefsSeed({ due: '2026-09-29' }) }, { clock });
  assert.equal(future.elements.taskDueDate.value, '2026-09-29');
  assert.deepEqual(chipTexts(future.elements), ['📋 Default list', '📅 Due tomorrow']);

  const corrupt = bootInbox({ ...credsSeed(), mgtd3_inbox_prefs: '{not json' }, { clock });
  assert.equal(corrupt.elements.taskDueDate.value, '2026-09-28');
});

test('Inbox remembers a cleared due date as "no due date"', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const first = bootInbox(credsSeed(), { clock });

  first.elements.taskDueDate.value = '';
  first.elements.taskDueDate.listeners.change();
  assert.equal(readPrefs(first.localStorage).due, 'none');

  const second = bootInbox(first.localStorage.snapshot(), { clock });
  assert.equal(second.elements.taskDueDate.value, '');
  assert.deepEqual(chipTexts(second.elements), ['📋 Default list', '📅 No due date']);

  second.elements.taskTitle.value = 'Someday idea';
  await second.elements.taskForm.listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(second.getInboxContent().trim()).due, undefined);
});

test('Inbox rolls an untouched "due today" forward when the page is left open past midnight', async () => {
  const clock = createClock('2026-09-27T23:50:00');
  const { elements, window, getInboxContent } = bootInbox(credsSeed(), { clock });
  assert.equal(elements.taskDueDate.value, '2026-09-27');

  clock.set('2026-09-28T00:10:00');
  window._listeners.focus();
  assert.equal(elements.taskDueDate.value, '2026-09-28');
  assert.deepEqual(chipTexts(elements), ['📋 Default list', '📅 Due today']);

  clock.set('2026-09-29T08:00:00'); // no focus event this time; submit must still catch it
  elements.taskTitle.value = 'Morning task';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(getInboxContent().trim()).due, '2026-09-29');
});

test('Inbox does not roll a specific date the user picked when the day changes', async () => {
  const clock = createClock('2026-09-27T23:50:00');
  const { elements, getInboxContent } = bootInbox(credsSeed(), { clock });

  elements.taskDueDate.value = '2026-09-30';
  elements.taskDueDate.listeners.change();
  clock.set('2026-09-28T00:10:00');

  elements.taskTitle.value = 'Pinned date';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(getInboxContent().trim()).due, '2026-09-30');
});

test('Inbox drops a remembered parent once loaded lists show it was deleted, so the request cannot get stuck', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const backup = backupSeed();
  backup.tasks.t1.deleted = true;
  const seed = {
    ...credsSeed(),
    ...backupCacheSeed(backup),
    ...prefsSeed({ listId: 'l1', listName: 'Work Projects', parentId: 't1', parentTitle: 'Website Redesign', due: 'today' })
  };
  const { elements, localStorage, getInboxContent } = bootInbox(seed, { clock });

  assert.equal(elements.taskParentId.value, '');
  assert.equal(elements.taskParentTitle.value, '');
  assert.equal(readPrefs(localStorage).parentId, '');
  assert.equal(elements.taskListId.value, 'l1');
  assert.deepEqual(chipTexts(elements), ['📋 Work Projects', '📅 Due today']);

  elements.taskTitle.value = 'Lands at list root instead';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  const queued = JSON.parse(getInboxContent().trim());
  assert.equal(queued.action, 'addInbox');
  assert.equal(queued.listId, 'l1');
});

test('Inbox falls back to Default when the remembered list is archived, without forgetting the choice', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const seed = { ...credsSeed(), ...backupCacheSeed(), ...prefsSeed({ listId: 'l3', listName: 'Archived Stuff', due: 'today' }) };
  const { elements, localStorage, getInboxContent } = bootInbox(seed, { clock });

  assert.equal(elements.taskListId.value, '');
  assert.deepEqual(chipTexts(elements), ['📋 Default list', '📅 Due today']);
  // A stale cache could be missing a list that does exist, so the preference itself is kept.
  assert.equal(readPrefs(localStorage).listId, 'l3');

  elements.taskTitle.value = 'Goes to the default list';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  assert.equal(JSON.parse(getInboxContent().trim()).listId, undefined);
});

test('Inbox restores a pasted parent ID and opens the manual section, since the dropdown cannot show it', async () => {
  const clock = createClock('2026-09-27T09:00:00');
  const seed = {
    ...credsSeed(),
    ...backupCacheSeed(),
    ...prefsSeed({ listId: 'l1', listName: 'Work Projects', parentId: 'nested-9', parentTitle: 'Deep task', due: 'today' })
  };
  const { elements, getInboxContent } = bootInbox(seed, { clock });

  assert.equal(elements.taskParentId.value, 'nested-9');
  assert.equal(elements.taskParentTaskId.value, '');
  assert.equal(elements.advancedParent.open, true);
  // The list is irrelevant for a pasted parent, so the summary doesn't claim it.
  assert.deepEqual(chipTexts(elements), ['↳ Deep task', '📅 Due today']);

  elements.taskTitle.value = 'Under the nested task';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  const queued = JSON.parse(getInboxContent().trim());
  assert.equal(queued.action, 'addChild');
  assert.equal(queued.parentTaskId, 'nested-9');
});

test('Inbox shows the status for the next task after an earlier success message auto-hid', async () => {
  const { elements, runTimers } = bootInbox(credsSeed());

  elements.taskTitle.value = 'First';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  runTimers(); // the 5s auto-hide fires
  assert.equal(elements.statusMessage.style.display, 'none');

  elements.taskTitle.value = 'Second';
  await elements.taskForm.listeners.submit({ preventDefault() {} });
  assert.equal(elements.statusMessage.className, 'status success');
  assert.equal(elements.statusMessage.style.display, '', 'inline display:none must not hide later messages');
});
