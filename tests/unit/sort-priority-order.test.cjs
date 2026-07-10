const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTaskOpsContext() {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    cmpDate: (a, b) => String(a || '').localeCompare(String(b || '')),
    now: () => '2026-07-10T00:00:00.000Z',
    prompt: () => ''
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/task-ops.js'), 'utf8');
  vm.runInContext(source, sandbox, { filename: 'task-ops.js' });
  vm.runInContext('globalThis.__exports = { applySortDomain };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

function makeState() {
  return {
    listId: 'l1',
    hoistId: '',
    data: {
      lists: {
        l1: {
          id: 'l1',
          name: 'Main',
          root_tasks: ['a', 'b', 'c', 'd', 'e']
        }
      },
      tasks: {
        a: { id: 'a', content: 'A', color: 1, tasks: [] },
        b: { id: 'b', content: 'B', color: 3, tasks: [] },
        c: { id: 'c', content: 'C', color: 9, tasks: [] },
        d: { id: 'd', content: 'D', color: 0, tasks: [] },
        e: { id: 'e', content: 'E', color: 'high', tasks: [] }
      }
    }
  };
}

function makeApp() {
  return {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    closeModal: () => {},
    renderList: () => {},
    toast: () => {}
  };
}

test('applySortDomain sorts by priority with 1 as highest', () => {
  const { applySortDomain } = loadTaskOpsContext();
  const state = makeState();
  const app = makeApp();

  applySortDomain(app, state, true, { field: 'priority', reverse: false, shallow: true });

  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['a', 'b', 'c', 'd', 'e']);
});

test('applySortDomain reverse priority inverts 1-as-highest order', () => {
  const { applySortDomain } = loadTaskOpsContext();
  const state = makeState();
  const app = makeApp();

  applySortDomain(app, state, true, { field: 'priority', reverse: true, shallow: true });

  assert.deepEqual(Array.from(state.data.lists.l1.root_tasks), ['d', 'e', 'c', 'b', 'a']);
});
