const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadQueryContext(state) {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    todayS: () => '2026-07-09',
    tomorrowS: () => '2026-07-10',
    cmpDate: (a, b) => String(a || '').localeCompare(String(b || '')),
    esc: (v) => String(v || ''),
    walkTasks: () => {},
    skipChildren: Symbol('skipChildren')
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/queries.js'), 'utf8');
  vm.runInContext(`${source}\n;globalThis.__exports = { registerAppQueries };`, sandbox, { filename: 'queries.js' });

  const handlers = new Map();
  const app = {
    queryService: {
      register: (name, fn) => handlers.set(name, fn)
    }
  };

  sandbox.__exports.registerAppQueries(app, {
    state,
    walkTasks: sandbox.walkTasks,
    skipChildren: sandbox.skipChildren,
    todayS: sandbox.todayS,
    tomorrowS: sandbox.tomorrowS,
    cmpDate: sandbox.cmpDate,
    esc: sandbox.esc
  });

  return {
    dueSections: () => handlers.get('due.sections')()
  };
}

function buildState(showCompleted) {
  return {
    listId: 'l1',
    data: {
      settings: { showCompleted },
      lists: {
        l1: { id: 'l1', name: 'Main', root_tasks: ['a', 'b'] }
      },
      tasks: {
        a: {
          id: 'a',
          checklist_id: 'l1',
          deleted: false,
          status: 0,
          content: 'Open overdue',
          due: '2026-07-01',
          due_asap: false,
          tasks: []
        },
        b: {
          id: 'b',
          checklist_id: 'l1',
          deleted: false,
          status: 1,
          content: 'Done overdue',
          due: '2026-07-01',
          due_asap: false,
          tasks: []
        },
        c: {
          id: 'c',
          checklist_id: 'l1',
          deleted: false,
          status: 1,
          content: 'Done no due',
          due: '',
          due_asap: false,
          tasks: []
        }
      }
    }
  };
}

test('due.sections excludes completed due tasks when showCompleted is false', () => {
  const state = buildState(false);
  const ctx = loadQueryContext(state);

  const sections = ctx.dueSections();
  const ids = sections.flatMap(sec => sec.items.map(t => t.id));

  assert.equal(ids.includes('a'), true);
  assert.equal(ids.includes('b'), false);
});

test('due.sections includes completed due tasks when showCompleted is true', () => {
  const state = buildState(true);
  const ctx = loadQueryContext(state);

  const sections = ctx.dueSections();
  const ids = sections.flatMap(sec => sec.items.map(t => t.id));

  assert.equal(ids.includes('a'), true);
  assert.equal(ids.includes('b'), true);
});

test('due.sections sorts by priority before due date', () => {
  const state = buildState(true);
  state.data.tasks.a.color = 1;
  state.data.tasks.b.color = 5;
  state.data.tasks.b.status = 0;
  state.data.tasks.d = {
    id: 'd',
    checklist_id: 'l1',
    deleted: false,
    status: 0,
    content: 'Medium overdue',
    due: '2026-07-01',
    due_asap: false,
    color: 3,
    tasks: []
  };

  const ctx = loadQueryContext(state);
  const sections = ctx.dueSections();
  const overdue = sections.find(s => s.title === 'Overdue');
  const ids = Array.from(overdue?.items || [], t => t.id);

  assert.deepEqual(ids.slice(0, 3), ['b', 'd', 'a']);
});
