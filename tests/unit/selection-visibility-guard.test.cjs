const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadGuard() {
  const sandbox = { console, JSON, Math, Date };
  vm.createContext(sandbox);

  const source = fs.readFileSync(path.join(process.cwd(), 'js/ui/render-controller.js'), 'utf8');
  vm.runInContext(
    `${source}; globalThis.__exports = { ensureSelectionVisibleUi };`,
    sandbox,
    { filename: 'render-controller.js' }
  );

  return sandbox.__exports.ensureSelectionVisibleUi;
}

test('ensureSelectionVisibleUi rehomes selection to first visible when selected task is hidden', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = {
    selId: 't2',
    msel: new Set(['t2'])
  };
  const app = {
    visible: () => ['t1', 't3']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't1');
  assert.deepEqual(Array.from(state.msel), []);
});

test('ensureSelectionVisibleUi preserves null selection when tasks are visible', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = {
    selId: null,
    msel: new Set(['tX'])
  };
  const app = {
    visible: () => ['t1', 't2']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, null);
  assert.deepEqual(Array.from(state.msel), []);
});

test('ensureSelectionVisibleUi clears selection when no tasks are visible', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = {
    selId: 't2',
    msel: new Set(['t2', 't3'])
  };
  const app = {
    visible: () => []
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, null);
  assert.deepEqual(Array.from(state.msel), []);
});
