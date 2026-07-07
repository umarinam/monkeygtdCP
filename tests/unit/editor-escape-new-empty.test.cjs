const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditorController(docMap) {
  const sourcePath = path.join(process.cwd(), 'js/ui/editor-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: (id) => docMap[id] || null
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__editor = { editKeyUi };`, sandbox, { filename: 'editor-controller.js' });
  return sandbox.__editor;
}

test('Esc deletes untouched newly added task and restores previous selection', () => {
  const docMap = {
    'ea-new1': { value: '' }
  };
  const { editKeyUi } = loadEditorController(docMap);

  const state = {
    editId: 'new1',
    selId: 'new1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    data: {
      tasks: {
        old1: { id: 'old1', deleted: false },
        new1: { id: 'new1', deleted: false }
      }
    }
  };

  const calls = { deleteTask: 0, renderList: 0 };
  const app = {
    isInlineAutocompleteOpen: () => false,
    deleteTask: (id) => {
      calls.deleteTask += 1;
      if (state.data.tasks[id]) state.data.tasks[id].deleted = true;
    },
    renderList: () => { calls.renderList += 1; }
  };

  const e = {
    key: 'Escape',
    preventDefault: () => {}
  };

  editKeyUi(app, state, e, 'new1');

  assert.equal(calls.deleteTask, 1);
  assert.equal(state.selId, 'old1');
  assert.equal(state.editId, null);
  assert.equal(state.pendingNewEditId, null);
  assert.equal(state.pendingNewEditPrevId, null);
});

test('Esc does not delete newly added task when user typed content', () => {
  const docMap = {
    'ea-new1': { value: 'draft' }
  };
  const { editKeyUi } = loadEditorController(docMap);

  const state = {
    editId: 'new1',
    selId: 'new1',
    pendingNewEditId: 'new1',
    pendingNewEditPrevId: 'old1',
    data: {
      tasks: {
        old1: { id: 'old1', deleted: false },
        new1: { id: 'new1', deleted: false }
      }
    }
  };

  const calls = { deleteTask: 0, renderList: 0 };
  const app = {
    isInlineAutocompleteOpen: () => false,
    deleteTask: () => { calls.deleteTask += 1; },
    renderList: () => { calls.renderList += 1; }
  };

  const e = {
    key: 'Escape',
    preventDefault: () => {}
  };

  editKeyUi(app, state, e, 'new1');

  assert.equal(calls.deleteTask, 0);
  assert.equal(calls.renderList, 1);
  assert.equal(state.editId, null);
  assert.equal(state.pendingNewEditId, null);
  assert.equal(state.pendingNewEditPrevId, null);
});
