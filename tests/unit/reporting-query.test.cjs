const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadQueriesContext() {
  const sandbox = {
    console,
    JSON,
    Math,
    Date
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/queries.js'), 'utf8');
  vm.runInContext(`${source}; globalThis.__exports = { registerAppQueries };`, sandbox, {
    filename: 'queries.js'
  });
  return sandbox.__exports;
}

function makeAppAndState() {
  const handlers = new Map();
  const state = {
    listId: 'l1',
    selId: null,
    data: {
      settings: {
        showCompleted: true
      },
      lists: {
        l1: { id: 'l1', name: 'Main', root_tasks: ['t-added', 't-mod', 't-comp', 't-untouched'] }
      },
      tasks: {
        't-added': {
          id: 't-added',
          content: 'Added task',
          checklist_id: 'l1',
          parent_id: '',
          tasks: [],
          deleted: false,
          status: 0,
          created_at: '2026-06-10T10:00:00.000Z',
          updated_at: '2026-06-10T10:00:00.000Z',
          completed_at: '',
          history: []
        },
        't-mod': {
          id: 't-mod',
          content: 'Modified task',
          checklist_id: 'l1',
          parent_id: '',
          tasks: [],
          deleted: false,
          status: 0,
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-06-11T10:00:00.000Z',
          completed_at: '',
          history: [{ at: '2026-06-11T10:00:00.000Z', type: 'title', changes: { from: 'a', to: 'b' } }]
        },
        't-comp': {
          id: 't-comp',
          content: 'Completed task',
          checklist_id: 'l1',
          parent_id: '',
          tasks: [],
          deleted: false,
          status: 1,
          created_at: '2026-05-01T10:00:00.000Z',
          updated_at: '2026-06-12T10:00:00.000Z',
          completed_at: '2026-06-12T10:00:00.000Z',
          history: [{ at: '2026-06-12T10:00:00.000Z', type: 'status', changes: { from: 0, to: 1 } }]
        },
        't-untouched': {
          id: 't-untouched',
          content: 'Untouched task',
          checklist_id: 'l1',
          parent_id: '',
          tasks: [],
          deleted: false,
          status: 0,
          created_at: '2026-01-01T10:00:00.000Z',
          updated_at: '2026-01-01T10:00:00.000Z',
          completed_at: '',
          history: []
        }
      },
      deletedItems: [
        {
          taskId: 't-deleted',
          deletedAt: '2026-06-13T10:00:00.000Z',
          snapshot: {
            id: 't-deleted',
            content: 'Deleted task',
            checklist_id: 'l1',
            parent_id: '',
            tasks: [],
            created_at: '2026-06-01T10:00:00.000Z',
            updated_at: '2026-06-13T10:00:00.000Z',
            completed_at: '',
            history: [{ at: '2026-06-13T10:00:00.000Z', type: 'deletion', changes: { action: 'soft-delete' } }]
          }
        }
      ]
    }
  };

  const app = {
    queryService: {
      register(name, fn) {
        handlers.set(name, fn);
      }
    },
    flatIds: () => [],
    expMD: () => '',
    expOPML: () => '',
    expTXT: () => ''
  };

  return { app, state, handlers };
}

test('report.rows classifies tasks by date range activity', () => {
  const { registerAppQueries } = loadQueriesContext();
  const { app, state, handlers } = makeAppAndState();

  registerAppQueries(app, {
    state,
    walkTasks: () => {},
    skipChildren: Symbol('skip-children'),
    todayS: () => '2026-06-10',
    tomorrowS: () => '2026-06-11',
    cmpDate: () => 0,
    esc: (s) => String(s || '')
  });

  const rows = handlers.get('report.rows')({ start: '2026-06-10', end: '2026-06-14' });
  const byId = Object.fromEntries(rows.map(r => [r.id, r.statusKey]));

  assert.equal(byId['t-added'], 'added');
  assert.equal(byId['t-mod'], 'modified');
  assert.equal(byId['t-comp'], 'completed');
  assert.equal(byId['t-deleted'], 'deleted');
  assert.equal(byId['t-untouched'], 'untouched');
});

test('report.rows returns empty output for invalid ranges', () => {
  const { registerAppQueries } = loadQueriesContext();
  const { app, state, handlers } = makeAppAndState();

  registerAppQueries(app, {
    state,
    walkTasks: () => {},
    skipChildren: Symbol('skip-children'),
    todayS: () => '2026-06-10',
    tomorrowS: () => '2026-06-11',
    cmpDate: () => 0,
    esc: (s) => String(s || '')
  });

  const rows = handlers.get('report.rows')({ start: '2026-06-14', end: '2026-06-10' });
  assert.equal(Array.isArray(rows), true);
  assert.equal(rows.length, 0);
});
