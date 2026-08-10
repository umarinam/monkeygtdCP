const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClipboardOps(overrides = {}) {
  const utils = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/clipboard-ops.js'), 'utf8');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    navigator: overrides.navigator || { clipboard: { writeText: () => Promise.resolve() } }
  };

  vm.createContext(sandbox);
  vm.runInContext(utils, sandbox, { filename: 'utils.js' });
  vm.runInContext(source, sandbox, { filename: 'clipboard-ops.js' });
  vm.runInContext('globalThis.__exports = { copyDomain, pasteDomain, dupDomain };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

function makeApp(state) {
  return {
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    sibList: (id) => {
      const t = state.data.tasks[id];
      if (!t) return null;
      const parent = t.parent_id ? state.data.tasks[t.parent_id] : null;
      return parent ? parent.tasks : state.data.lists[state.listId].root_tasks;
    }
  };
}

function baseState() {
  return {
    listId: 'l1',
    selId: null,
    msel: new Set(),
    clipboard: null,
    clipboardIndex: null,
    data: {
      settings: {},
      lists: { l1: { id: 'l1', root_tasks: ['p1'] } },
      tasks: {
        p1: { id: 'p1', content: 'Parent', status: 0, deleted: false, _collapsed: false, checklist_id: 'l1', parent_id: '', tasks: ['c1'] },
        c1: { id: 'c1', content: 'Child', status: 0, deleted: false, _collapsed: false, checklist_id: 'l1', parent_id: 'p1', tasks: ['g1'] },
        g1: { id: 'g1', content: 'Grandchild', status: 0, deleted: false, _collapsed: false, checklist_id: 'l1', parent_id: 'c1', tasks: [] }
      }
    }
  };
}

test('pasteDomain gives pasted subtasks fresh ids instead of reusing the originals', () => {
  const { copyDomain, pasteDomain } = loadClipboardOps();
  const state = baseState();
  const app = makeApp(state);

  state.selId = 'p1';
  copyDomain(app, state);
  state.selId = 'p1';
  pasteDomain(app, state);

  const originalIds = new Set(['p1', 'c1', 'g1']);
  const allIds = Object.keys(state.data.tasks);
  const pastedIds = allIds.filter(id => !originalIds.has(id));

  // one pasted parent + one pasted child + one pasted grandchild = 3 new tasks
  assert.equal(pastedIds.length, 3);

  const pastedParent = state.data.tasks[pastedIds.find(id => state.data.tasks[id].content === 'Parent')];
  const pastedChild = state.data.tasks[pastedParent.tasks[0]];
  const pastedGrandchild = state.data.tasks[pastedChild.tasks[0]];

  assert.notEqual(pastedChild.id, 'c1');
  assert.notEqual(pastedGrandchild.id, 'g1');
  assert.equal(pastedChild.parent_id, pastedParent.id);
  assert.equal(pastedGrandchild.parent_id, pastedChild.id);

  // originals must be untouched: still owned by the original parent chain
  assert.equal(state.data.tasks.c1.parent_id, 'p1');
  assert.equal(state.data.tasks.g1.parent_id, 'c1');
  assert.equal(state.data.tasks.p1.tasks.includes(pastedChild.id), false);
});

test('pasteDomain does not alias original child tasks into the pasted copy', () => {
  const { copyDomain, pasteDomain } = loadClipboardOps();
  const state = baseState();
  const app = makeApp(state);

  state.selId = 'p1';
  copyDomain(app, state);
  state.selId = 'p1';
  pasteDomain(app, state);

  const originalChildTaskCount = Object.values(state.data.tasks).filter(t => t.content === 'Child').length;
  assert.equal(originalChildTaskCount, 2);

  // mutating the pasted child must not affect the original
  const pastedParentId = state.data.lists.l1.root_tasks.find(id => id !== 'p1' && state.data.tasks[id].content === 'Parent');
  const pastedChildId = state.data.tasks[pastedParentId].tasks[0];
  state.data.tasks[pastedChildId].content = 'Edited pasted child';

  assert.equal(state.data.tasks.c1.content, 'Child');
});

test('dupDomain gives duplicated subtasks fresh ids instead of reusing the originals', () => {
  const { dupDomain } = loadClipboardOps();
  const state = baseState();
  const app = makeApp(state);

  dupDomain(app, state, 'p1');

  const originalIds = new Set(['p1', 'c1', 'g1']);
  const allIds = Object.keys(state.data.tasks);
  const dupedIds = allIds.filter(id => !originalIds.has(id));

  assert.equal(dupedIds.length, 3);

  const dupedParentId = state.selId;
  const dupedParent = state.data.tasks[dupedParentId];
  const dupedChild = state.data.tasks[dupedParent.tasks[0]];
  const dupedGrandchild = state.data.tasks[dupedChild.tasks[0]];

  assert.notEqual(dupedChild.id, 'c1');
  assert.notEqual(dupedGrandchild.id, 'g1');
  assert.equal(dupedChild.parent_id, dupedParent.id);
  assert.equal(dupedGrandchild.parent_id, dupedChild.id);

  // the original branch keeps its own children, untouched
  assert.equal(state.data.tasks.p1.tasks.includes(dupedChild.id), false);
  assert.equal(state.data.tasks.c1.parent_id, 'p1');
});
