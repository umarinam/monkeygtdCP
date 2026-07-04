const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDeleteTaskDomain() {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/task-crud-ops.js'), 'utf8');
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    now: () => '2026-07-04T00:00:00.000Z',
    logTaskHistory: () => {}
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}; globalThis.__exports = { deleteTaskDomain };`, sandbox, {
    filename: 'task-crud-ops.js'
  });
  return sandbox.__exports.deleteTaskDomain;
}

test('deleteTaskDomain keeps selection on next visible task instead of first item', () => {
  const deleteTaskDomain = loadDeleteTaskDomain();

  const state = {
    listId: 'l1',
    selId: 'b',
    data: {
      deletedItems: [],
      lists: {
        l1: { id: 'l1', root_tasks: ['a', 'b', 'c'] }
      },
      tasks: {
        a: { id: 'a', checklist_id: 'l1', parent_id: '', tasks: [], deleted: false },
        b: { id: 'b', checklist_id: 'l1', parent_id: '', tasks: [], deleted: false },
        c: { id: 'c', checklist_id: 'l1', parent_id: '', tasks: [], deleted: false }
      }
    }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    sibList: () => state.data.lists.l1.root_tasks,
    visible: () => state.data.lists.l1.root_tasks.filter(id => !state.data.tasks[id].deleted),
    save: () => {},
    render: () => {}
  };

  deleteTaskDomain(app, state, 'b');

  assert.equal(state.data.tasks.b.deleted, true);
  assert.deepEqual(state.data.lists.l1.root_tasks, ['a', 'c']);
  assert.equal(state.selId, 'c');
});
