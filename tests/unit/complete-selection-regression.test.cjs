const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// The app's JS files are classic scripts sharing one global scope, so load the
// real ones into a single sandbox to exercise complete -> render -> selection.
function loadApp() {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    Set,
    Array,
    now: () => '2026-10-04T00:00:00.000Z',
    logTaskHistory: () => {},
    todayS: () => '2026-10-04',
    tomorrowS: () => '2026-10-05',
    cmpDate: () => 0,
    esc: s => String(s || '')
  };
  vm.createContext(sandbox);
  for (const file of ['js/core/traversal.js', 'js/domain/queries.js', 'js/ui/render-controller.js', 'js/domain/task-crud-ops.js']) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), file), 'utf8'), sandbox, { filename: file });
  }
  vm.runInContext(
    'globalThis.__exports = { registerAppQueries, ensureSelectionVisibleUi, toggleStatusDomain, invalidateDomain, walkTasks, SKIP_CHILDREN };',
    sandbox
  );
  return sandbox.__exports;
}

const lib = loadApp();

// Arrays built inside the vm have a different prototype; compare by value.
const plain = v => JSON.parse(JSON.stringify(v));

function makeWorld(shape, settings = {}) {
  // shape: array of [id, parentId|'' , extra?] in tree order
  const tasks = {};
  const roots = [];
  for (const [id, parent, extra] of shape) {
    tasks[id] = {
      id, content: id, checklist_id: 'l1', parent_id: parent, tasks: [], status: 0, deleted: false,
      _collapsed: false, repeating_due: null, ...extra
    };
    if (parent) tasks[parent].tasks.push(id);
    else roots.push(id);
  }

  const state = {
    listId: 'l1',
    selId: null,
    hoistId: null,
    msel: new Set(),
    data: { settings: { showCompleted: false, ...settings }, lists: { l1: { id: 'l1', root_tasks: roots } }, tasks }
  };

  const handlers = new Map();
  const app = {
    queryService: { register: (name, fn) => handlers.set(name, fn) },
    select: (name, payload) => handlers.get(name)(payload),
    visible: () => app.select('tasks.visible'),
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    checkAutoClose: () => {},
    render: () => lib.ensureSelectionVisibleUi(app, state)
  };
  lib.registerAppQueries(app, {
    state,
    walkTasks: lib.walkTasks,
    skipChildren: lib.SKIP_CHILDREN,
    todayS: () => '2026-10-04',
    tomorrowS: () => '2026-10-05',
    cmpDate: () => 0,
    esc: s => String(s || '')
  });
  return { state, app };
}

const flat = () => makeWorld([['a', ''], ['b', ''], ['c', ''], ['d', ''], ['e', '']]);

test('completing the selected task with completed hidden selects the NEXT visible task, not the top', () => {
  const { state, app } = flat();
  state.selId = 'c';

  lib.toggleStatusDomain(app, state, 'c');

  assert.equal(state.data.tasks.c.status, 1);
  assert.deepEqual(plain(app.visible()), ['a', 'b', 'd', 'e']);
  assert.equal(state.selId, 'd');
});

test('completing the last visible task selects the PREVIOUS task', () => {
  const { state, app } = flat();
  state.selId = 'e';

  lib.toggleStatusDomain(app, state, 'e');

  assert.equal(state.selId, 'd');
});

test('completing the first task selects the next task', () => {
  const { state, app } = flat();
  state.selId = 'a';

  lib.toggleStatusDomain(app, state, 'a');

  assert.equal(state.selId, 'b');
});

test('completing the only task clears the selection', () => {
  const { state, app } = makeWorld([['solo', '']]);
  state.selId = 'solo';

  lib.toggleStatusDomain(app, state, 'solo');

  assert.equal(state.selId, null);
});

test('completing a parent skips its own hidden subtree and lands on the next sibling', () => {
  const { state, app } = makeWorld([
    ['p0', ''],
    ['p1', ''], ['p1a', 'p1'], ['p1b', 'p1'],
    ['p2', '']
  ]);
  state.selId = 'p1';

  lib.toggleStatusDomain(app, state, 'p1');

  assert.deepEqual(plain(app.visible()), ['p0', 'p2']);
  assert.equal(state.selId, 'p2');
});

test('completing the last child lands on the previous sibling, not the top of the list', () => {
  const { state, app } = makeWorld([
    ['top', ''],
    ['parent', ''], ['kid1', 'parent'], ['kid2', 'parent']
  ]);
  state.selId = 'kid2';

  lib.toggleStatusDomain(app, state, 'kid2');

  assert.equal(state.selId, 'kid1');
});

test('invalidating the selected task (also hidden) selects the next visible task', () => {
  const { state, app } = flat();
  state.selId = 'b';

  lib.invalidateDomain(app, state, 'b');

  assert.equal(state.data.tasks.b.status, 2);
  assert.equal(state.selId, 'c');
});

test('completing several selected tasks at once lands on the next visible task after them', () => {
  const { state, app } = flat();
  state.selId = 'b';
  state.msel = new Set(['b', 'c']);

  lib.toggleStatusDomain(app, state, 'b');
  lib.toggleStatusDomain(app, state, 'c');

  assert.deepEqual(plain(app.visible()), ['a', 'd', 'e']);
  assert.equal(state.selId, 'd');
});

test('selection is left alone when completed tasks stay visible', () => {
  const { state, app } = makeWorld([['a', ''], ['b', ''], ['c', '']], { showCompleted: true });
  state.selId = 'b';

  lib.toggleStatusDomain(app, state, 'b');

  assert.equal(state.data.tasks.b.status, 1);
  assert.equal(state.selId, 'b');
});

test('re-opening a task that is still visible keeps it selected', () => {
  const { state, app } = makeWorld([['a', ''], ['b', ''], ['c', '']], { showCompleted: true });
  state.selId = 'b';
  state.data.tasks.b.status = 1;

  lib.toggleStatusDomain(app, state, 'b');

  assert.equal(state.data.tasks.b.status, 0);
  assert.equal(state.selId, 'b');
});

test('tasks.documentOrder lists hidden-completed and collapsed descendants but not deleted tasks', () => {
  const { state, app } = makeWorld([
    ['a', ''],
    ['b', '', { status: 1 }], ['b1', 'b'],
    ['c', '', { _collapsed: true }], ['c1', 'c'],
    ['d', '', { deleted: true }],
    ['e', '']
  ]);

  assert.deepEqual(plain(app.select('tasks.documentOrder')), ['a', 'b', 'b1', 'c', 'c1', 'e']);
  assert.deepEqual(plain(app.visible()), ['a', 'c', 'e']);
});

test('tasks.documentOrder respects hoisting', () => {
  const { state, app } = makeWorld([['a', ''], ['h', ''], ['h1', 'h'], ['h2', 'h'], ['z', '']]);
  state.hoistId = 'h';

  assert.deepEqual(plain(app.select('tasks.documentOrder')), ['h', 'h1', 'h2']);
});
