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

test('ensureSelectionVisibleUi picks the next visible task, in document order, when the selected task is hidden', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = { selId: 't2', msel: new Set() };
  const app = {
    visible: () => ['t1', 't3', 't4'],
    select: name => (name === 'tasks.documentOrder' ? ['t1', 't2', 't3', 't4'] : [])
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't3');
});

test('ensureSelectionVisibleUi picks the previous visible task when nothing visible follows', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = { selId: 't4', msel: new Set() };
  const app = {
    visible: () => ['t1', 't2', 't3'],
    select: () => ['t1', 't2', 't3', 't4']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't3');
});

test('ensureSelectionVisibleUi skips neighbours that are hidden too', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = { selId: 't2', msel: new Set() };
  const app = {
    visible: () => ['t1', 't5'],
    select: () => ['t1', 't2', 't3', 't4', 't5']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't5');
});

test('ensureSelectionVisibleUi leaves a still-visible selection alone', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = { selId: 't3', msel: new Set() };
  const app = {
    visible: () => ['t1', 't3'],
    select: () => ['t1', 't2', 't3']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't3');
});

test('ensureSelectionVisibleUi falls back to the first visible task when the hidden task cannot be located', () => {
  const ensureSelectionVisibleUi = loadGuard();

  const state = { selId: 'gone', msel: new Set() };
  const app = {
    visible: () => ['t1', 't3'],
    select: () => ['t1', 't2', 't3']
  };

  ensureSelectionVisibleUi(app, state);

  assert.equal(state.selId, 't1');
});

test('ensureSelectionVisibleUi rehomes selection to first visible when no position info is available', () => {
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
