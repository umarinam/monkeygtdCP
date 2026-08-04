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
    dueSections: (payload) => handlers.get('due.sections')(payload)
  };
}

function buildState() {
  return {
    listId: 'l1',
    data: {
      settings: { showCompleted: true },
      lists: {
        l1: { id: 'l1', name: 'Main', root_tasks: ['a', 'b'] }
      },
      tasks: {
        a: {
          id: 'a',
          checklist_id: 'l1',
          deleted: false,
          status: 0,
          content: 'Buy milk',
          tags_as_text: '',
          assignees: [],
          due: '2026-07-01',
          due_asap: false,
          tasks: []
        },
        b: {
          id: 'b',
          checklist_id: 'l1',
          deleted: false,
          status: 0,
          content: 'Ship release',
          tags_as_text: '',
          assignees: [],
          due: '2026-07-01',
          due_asap: false,
          tasks: []
        }
      }
    }
  };
}

function loadSearchController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/search-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: () => ({ classList: { toggle: () => {}, remove: () => {} }, value: '' })
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__searchExports = { applySearchInputUi, clearSearchUi };`,
    sandbox,
    { filename: 'search-controller.js' }
  );
  return sandbox.__searchExports;
}

test('due.sections without a query returns all due tasks (backward compatible)', () => {
  const ctx = loadQueryContext(buildState());
  const sections = ctx.dueSections();
  const ids = sections.flatMap(sec => sec.items.map(t => t.id));

  assert.equal(ids.includes('a'), true);
  assert.equal(ids.includes('b'), true);
});

test('due.sections filters tasks by the search query text', () => {
  const ctx = loadQueryContext(buildState());
  const sections = ctx.dueSections({ q: 'milk' });
  const ids = Array.from(sections.flatMap(sec => sec.items.map(t => t.id)));

  assert.deepEqual(ids, ['a']);
});

test('applySearchInputUi re-renders the Due page when it is the active page', () => {
  const { applySearchInputUi } = loadSearchController();
  const state = { page: 'due', filter: '' };
  const calls = { renderList: 0, renderDue: 0, syncSB: 0 };
  const app = {
    renderList: () => calls.renderList++,
    renderDue: () => calls.renderDue++,
    syncSB: () => calls.syncSB++
  };

  applySearchInputUi(app, state, 'milk');

  assert.equal(state.filter, 'milk');
  assert.equal(calls.renderDue, 1);
  assert.equal(calls.renderList, 0);
  assert.equal(calls.syncSB, 1);
});

test('clearSearchUi re-renders the Due page when it is the active page', () => {
  const { clearSearchUi } = loadSearchController();
  const state = { page: 'due', filter: 'milk' };
  const calls = { renderList: 0, renderDue: 0 };
  const app = {
    renderList: () => calls.renderList++,
    renderDue: () => calls.renderDue++,
    syncSB: () => {}
  };

  clearSearchUi(app, state);

  assert.equal(state.filter, '');
  assert.equal(calls.renderDue, 1);
  assert.equal(calls.renderList, 0);
});

test('applySearchInputUi still re-renders the List page as before', () => {
  const { applySearchInputUi } = loadSearchController();
  const state = { page: 'list', filter: '' };
  const calls = { renderList: 0, renderDue: 0 };
  const app = {
    renderList: () => calls.renderList++,
    renderDue: () => calls.renderDue++,
    syncSB: () => {}
  };

  applySearchInputUi(app, state, 'milk');

  assert.equal(calls.renderList, 1);
  assert.equal(calls.renderDue, 0);
});
