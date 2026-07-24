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

test('Enter adds sibling when NOT in hoist mode', () => {
  const docMap = {
    'ea-task-1': { value: 'Task 1' }
  };
  const { editKeyUi } = loadEditorController(docMap);

  const state = {
    hoistId: null,
    editId: 'task-1',
    selId: 'task-1',
    pendingNewEditId: null,
    pendingNewEditPrevId: null,
    data: {
      tasks: {
        'task-1': { id: 'task-1', content: 'Task 1' }
      }
    }
  };

  let addTaskCall = null;
  const app = {
    isInlineAutocompleteOpen: () => false,
    hideInlineAutocomplete: () => {},
    saveEdit: (id, content) => {},
    addTask: (parentId, asChild, content) => {
      addTaskCall = { parentId, asChild, content };
      return 'new-task-id';
    },
    renderList: () => {},
    startEdit: (id) => {}
  };

  const e = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    preventDefault: () => {}
  };

  editKeyUi(app, state, e, 'task-1');

  assert.equal(addTaskCall.asChild, false, 'Enter without hoist should add sibling');
});

test('Enter adds child when in hoist mode', () => {
  const docMap = {
    'ea-task-1': { value: 'Task 1' }
  };
  const { editKeyUi } = loadEditorController(docMap);

  const state = {
    hoistId: 'parent-id',
    editId: 'task-1',
    selId: 'task-1',
    pendingNewEditId: null,
    pendingNewEditPrevId: null,
    data: {
      tasks: {
        'parent-id': { id: 'parent-id', content: 'Parent' },
        'task-1': { id: 'task-1', content: 'Task 1' }
      }
    }
  };

  let addTaskCall = null;
  const app = {
    isInlineAutocompleteOpen: () => false,
    hideInlineAutocomplete: () => {},
    saveEdit: (id, content) => {},
    addTask: (parentId, asChild, content) => {
      addTaskCall = { parentId, asChild, content };
      return 'new-task-id';
    },
    renderList: () => {},
    startEdit: (id) => {}
  };

  const e = {
    key: 'Enter',
    shiftKey: false,
    ctrlKey: false,
    preventDefault: () => {}
  };

  editKeyUi(app, state, e, 'task-1');

  assert.equal(addTaskCall.asChild, true, 'Enter with hoist should add child');
});
