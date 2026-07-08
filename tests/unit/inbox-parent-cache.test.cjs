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
    addEventListener(type, cb) {
      this.listeners[type] = cb;
    },
    focus() {},
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
    }
  };
}

function bootInbox(localSeed = {}) {
  const elements = {
    taskForm: createElement('taskForm'),
    statusMessage: createElement('statusMessage'),
    authWarning: createElement('authWarning'),
    submitBtn: createElement('submitBtn'),
    credsSetup: createElement('credsSetup'),
    credsToken: createElement('credsToken'),
    credsId: createElement('credsId'),
    saveCredsBtn: createElement('saveCredsBtn'),
    taskTitle: createElement('taskTitle'),
    taskParentId: createElement('taskParentId'),
    taskParentTitle: createElement('taskParentTitle'),
    taskDueDate: createElement('taskDueDate'),
    parentSuggestions: createElement('parentSuggestions'),
    recentParents: createElement('recentParents'),
    taskDescription: createElement('taskDescription')
  };

  const inputs = [
    elements.taskTitle,
    elements.taskParentId,
    elements.taskParentTitle,
    elements.taskDueDate,
    elements.taskDescription
  ];
  elements.taskForm.reset = () => {
    inputs.forEach((el) => {
      el.value = '';
    });
  };

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
  let inboxContent = '';

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
                }
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

      return { ok: true, text: async () => inboxContent, json: async () => ({}) };
    },
    setTimeout: () => {},
    Date,
    JSON,
    console,
    crypto: {
      randomUUID: () => 'uuid-fixed'
    }
  };

  vm.runInNewContext(readInboxScript(), context);

  if (window._listeners.load) {
    window._listeners.load();
  }

  return {
    elements,
    localStorage,
    fetchCalls,
    getInboxContent: () => inboxContent
  };
}

function credsSeed() {
  return {
    mgtd3: JSON.stringify({ settings: { gistToken: 'tok_123', gistId: 'gid_123' } })
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

test('Inbox shows default parent seeds when cache is empty', () => {
  const { elements } = bootInbox(credsSeed());
  // 4 default parents should be rendered
  assert.equal(elements.recentParents.children.length, 4);
  assert.equal(elements.recentParents.style.display, 'flex');
  const firstPill = elements.recentParents.children[0].children[0];
  assert.equal(firstPill.textContent.includes('Email'), true);
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
