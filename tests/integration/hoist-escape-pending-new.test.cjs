const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function buildSandbox() {
  const keyboardSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/keyboard-controller.js'), 'utf8');
  const taskCrudSource = fs.readFileSync(path.join(process.cwd(), 'js/domain/task-crud-ops.js'), 'utf8');

  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
    document: {
      activeElement: null,
      getElementById: (id) => {
        if (id === 'ea-new1') return { value: '' };
        return { classList: { contains: () => true } };
      }
    },
    now: () => '2026-07-19T00:00:00.000Z',
    logTaskHistory: () => {}
  };

  vm.createContext(sandbox);
  vm.runInContext(`${taskCrudSource}\n${keyboardSource}\n;globalThis.__mods = { deleteTaskDomain, handleGlobalKey };`, sandbox, {
    filename: 'integration-hoist-escape.js'
  });
  return sandbox.__mods;
}

function buildVisibleIds(state) {
  const out = [];
  const seen = new Set();

  const walk = (id) => {
    if (!id || seen.has(id)) return;
    const task = state.data.tasks[id];
    if (!task || task.deleted) return;
    seen.add(id);
    out.push(id);
    (task.tasks || []).forEach(walk);
  };

  const roots = state.hoistId ? [state.hoistId] : (state.data.lists[state.listId].root_tasks || []);
  roots.forEach(walk);
  return out;
}

test('Escape cancel in hoist mode keeps hoist active with real delete domain flow', () => {
  const { deleteTaskDomain, handleGlobalKey } = buildSandbox();

  const state = {
    listId: 'l1',
    page: 'list',
    filter: '',
    editId: 'new1',
    selId: 'new1',
    hoistId: 'h1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    kbuf: '',
    kbtimer: null,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      lists: {
        l1: { id: 'l1', root_tasks: ['h1', 'x1'] }
      },
      tasks: {
        h1: { id: 'h1', deleted: false, parent_id: '', tasks: ['old1', 'new1'] },
        old1: { id: 'old1', deleted: false, parent_id: 'h1', tasks: [] },
        new1: { id: 'new1', deleted: false, parent_id: 'h1', tasks: [] },
        x1: { id: 'x1', deleted: false, parent_id: '', tasks: [] }
      },
      deletedItems: []
    }
  };

  const app = {
    snap: () => ({}),
    pushUndo: () => {},
    save: () => {},
    sibList: (id) => {
      const t = state.data.tasks[id];
      if (!t) return null;
      if (t.parent_id) return state.data.tasks[t.parent_id].tasks;
      return state.data.lists[state.listId].root_tasks;
    },
    visible: () => buildVisibleIds(state),
    render: () => {
      state.hoistId = null;
    },
    deleteTask: (id) => deleteTaskDomain(app, state, id),
    renderList: () => {},
    closeAll: () => {},
    showShortcuts: () => {}
  };

  const e = {
    key: 'Escape',
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);

  assert.equal(state.data.tasks.new1.deleted, true);
  assert.equal(state.selId, 'old1');
  assert.equal(state.hoistId, 'h1');
  assert.equal(state.pendingNewEditId, null);
  assert.equal(state.pendingNewEditPrevId, null);
  assert.equal(state.editId, null);
});
