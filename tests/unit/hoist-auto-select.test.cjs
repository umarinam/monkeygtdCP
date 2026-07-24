const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadNavigationController(docMap = {}) {
  const sourcePath = path.join(process.cwd(), 'js/ui/navigation-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: (id) => docMap[id] || null
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__nav = { hoistTaskUi, unHoistUi };`, sandbox, { filename: 'navigation-controller.js' });
  return sandbox.__nav;
}

test('hoistTaskUi sets both hoistId and selId to the focused task', () => {
  const { hoistTaskUi } = loadNavigationController();

  const state = {
    hoistId: null,
    selId: null
  };

  let renderCalls = 0;
  let toastCalls = [];
  const app = {
    renderList: () => { renderCalls += 1; },
    toast: (msg) => { toastCalls.push(msg); }
  };

  hoistTaskUi(app, state, 'task-123');

  assert.equal(state.hoistId, 'task-123', 'hoistId should be set to focused task');
  assert.equal(state.selId, 'task-123', 'selId should be set to focused task for auto-selection');
  assert.equal(renderCalls, 1, 'renderList should be called once');
  assert.deepEqual(toastCalls, ['Focused'], 'toast should show "Focused" message');
});

test('unHoistUi clears hoist and rerenders', () => {
  const { unHoistUi } = loadNavigationController();

  const state = {
    hoistId: 'task-123',
    selId: 'task-123'
  };

  let renderCalls = 0;
  const app = {
    renderList: () => { renderCalls += 1; }
  };

  unHoistUi(app, state);

  assert.equal(state.hoistId, null, 'hoistId should be null');
  assert.equal(state.selId, 'task-123', 'selId should remain unchanged (not cleared by unhoist)');
  assert.equal(renderCalls, 1, 'renderList should be called once');
});
