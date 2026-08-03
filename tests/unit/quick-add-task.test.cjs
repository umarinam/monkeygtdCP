const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModalController(docNodes = {}) {
  const sourcePath = path.join(process.cwd(), 'js/ui/modal-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const defaultNode = { value: '', focus: () => {} };

  const sandbox = {
    console,
    setTimeout: (fn) => fn(),
    document: {
      getElementById: (id) => docNodes[id] || defaultNode
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__quickAddExports = { openQuickAddUi, submitQuickAddUi, quickAddKeyUi };`,
    sandbox,
    { filename: 'modal-controller.js' }
  );
  return sandbox.__quickAddExports;
}

function makeState(listOverrides = {}) {
  return {
    listId: 'l1',
    page: 'list',
    selId: null,
    data: {
      lists: {
        l1: { id: 'l1', name: 'My Tasks', root_tasks: [], ...listOverrides }
      },
      tasks: {}
    }
  };
}

function makeApp() {
  const calls = [];
  return {
    calls,
    openModal: (id) => calls.push(['openModal', id]),
    closeModal: (id) => calls.push(['closeModal', id]),
    dispatch: (name, payload) => {
      calls.push(['dispatch', name, payload]);
      return 'new-task-id';
    },
    renderList: () => calls.push(['renderList']),
    toast: (msg) => calls.push(['toast', msg]),
    submitQuickAdd: () => calls.push(['submitQuickAdd'])
  };
}

test('app shell exposes a quick-add button and modal reachable without any existing task', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  assert.equal(/id="quickadd-btn"/.test(html), true);
  assert.equal(/onclick="App\.openQuickAdd\(\)"/.test(html), true);
  assert.equal(/id="ov-quickadd"/.test(html), true);
  assert.equal(/id="qa-input"/.test(html), true);
});

test('submitQuickAddUi adds a task to an empty list via dispatch, with no pre-existing task required', () => {
  const qaInput = { value: '  Buy milk  ', focus: () => {} };
  const { submitQuickAddUi } = loadModalController({ 'qa-input': qaInput });
  const state = makeState(); // root_tasks: [] -- simulates a brand new, fully empty list
  const app = makeApp();

  submitQuickAddUi(app, state);

  const dispatched = app.calls.find(c => c[0] === 'dispatch');
  assert.equal(dispatched[1], 'task.add');
  assert.equal(dispatched[2].afterId, '');
  assert.equal(dispatched[2].asChild, false);
  assert.equal(dispatched[2].content, 'Buy milk');
  assert.equal(state.selId, 'new-task-id');
  assert.equal(app.calls.some(c => c[0] === 'closeModal' && c[1] === 'ov-quickadd'), true);
  assert.equal(app.calls.some(c => c[0] === 'renderList'), true);
});

test('submitQuickAddUi ignores blank input without dispatching a command', () => {
  const qaInput = { value: '   ', focus: () => {} };
  const { submitQuickAddUi } = loadModalController({ 'qa-input': qaInput });
  const state = makeState();
  const app = makeApp();

  submitQuickAddUi(app, state);

  assert.equal(app.calls.some(c => c[0] === 'dispatch'), false);
  assert.equal(app.calls.some(c => c[0] === 'toast'), true);
});

test('submitQuickAddUi refuses to add when no list is open', () => {
  const qaInput = { value: 'Orphan task', focus: () => {} };
  const { submitQuickAddUi } = loadModalController({ 'qa-input': qaInput });
  const state = makeState();
  state.listId = null;
  const app = makeApp();

  submitQuickAddUi(app, state);

  assert.equal(app.calls.some(c => c[0] === 'dispatch'), false);
  assert.deepEqual(app.calls[0], ['toast', 'Open a list first']);
});

test('quickAddKeyUi submits on Enter and closes the modal on Escape', () => {
  const { quickAddKeyUi } = loadModalController();
  const state = makeState();
  const app = makeApp();

  let prevented = false;
  quickAddKeyUi(app, state, { key: 'Enter', shiftKey: false, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(app.calls, [['submitQuickAdd']]);

  app.calls.length = 0;
  quickAddKeyUi(app, state, { key: 'Escape', preventDefault: () => {} });
  assert.deepEqual(app.calls, [['closeModal', 'ov-quickadd']]);
});

test('quick-add modal is registered as a tracked overlay so global shortcuts are suppressed while it is open', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'js/ui/keyboard-controller.js'), 'utf8');
  assert.equal(/'due repeat tags notes move sort export import restore wc settings task-json task-history list-json all-lists-json shortcuts quickadd'/.test(src), true);
});
