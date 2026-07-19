const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadKeyboard() {
  const sourcePath = path.join(process.cwd(), 'js/ui/keyboard-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: (id) => {
        if (id === 'ov-cp') return { classList: { contains: () => true } };
        if (id.startsWith('ov-')) return { classList: { contains: () => true } };
        return { classList: { contains: () => true } };
      }
    },
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__k = { handleGlobalKey };`, sandbox, { filename: 'keyboard-controller.js' });
  return sandbox.__k;
}

test('handleGlobalKey Escape deletes pending empty new task and reselects previous', () => {
  const { handleGlobalKey } = loadKeyboard();

  const state = {
    editId: 'new1',
    selId: 'new1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    page: 'list',
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        old1: { id: 'old1', deleted: false },
        new1: { id: 'new1', deleted: false }
      }
    }
  };

  const calls = { deleteTask: 0, renderList: 0 };
  const app = {
    deleteTask: (id) => {
      calls.deleteTask += 1;
      if (state.data.tasks[id]) state.data.tasks[id].deleted = true;
    },
    renderList: () => { calls.renderList += 1; },
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

  assert.equal(calls.deleteTask, 1);
  assert.equal(state.selId, 'old1');
  assert.equal(state.editId, null);
  assert.equal(state.pendingNewEditId, null);
  assert.equal(state.pendingNewEditPrevId, null);
});

test('handleGlobalKey Escape cancel keeps hoist mode while deleting pending empty task', () => {
  const { handleGlobalKey } = loadKeyboard();

  const state = {
    editId: 'new1',
    selId: 'new1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    page: 'list',
    filter: '',
    hoistId: 'h1',
    kbuf: '',
    kbtimer: null,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        h1: { id: 'h1', deleted: false },
        old1: { id: 'old1', deleted: false },
        new1: { id: 'new1', deleted: false }
      }
    }
  };

  const app = {
    deleteTask: (id) => {
      if (state.data.tasks[id]) state.data.tasks[id].deleted = true;
      state.hoistId = null;
    },
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

  assert.equal(state.hoistId, 'h1');
  assert.equal(state.selId, 'old1');
});

test('handleGlobalKey Escape pending-new cancel is idempotent for same event object', () => {
  const { handleGlobalKey } = loadKeyboard();

  const state = {
    editId: 'new1',
    selId: 'new1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    page: 'list',
    filter: '',
    hoistId: 'h1',
    kbuf: '',
    kbtimer: null,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        h1: { id: 'h1', deleted: false },
        old1: { id: 'old1', deleted: false },
        new1: { id: 'new1', deleted: false }
      }
    }
  };

  let unhoistCalls = 0;
  const app = {
    deleteTask: (id) => {
      if (state.data.tasks[id]) state.data.tasks[id].deleted = true;
    },
    renderList: () => {},
    render: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    unHoist: () => {
      unhoistCalls += 1;
      state.hoistId = null;
    }
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
  handleGlobalKey(app, state, e);

  assert.equal(unhoistCalls, 0);
  assert.equal(state.hoistId, 'h1');
  assert.equal(state.selId, 'old1');
});
