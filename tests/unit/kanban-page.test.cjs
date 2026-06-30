const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderController(docNodes = {}) {
  const sourcePath = path.join(process.cwd(), 'js/ui/render-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const defaultNode = {
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    innerHTML: '',
    textContent: ''
  };

  const sandbox = {
    console,
    md: (s) => s,
    esc: (s) => String(s),
    getDueCls: () => '',
    fmtDue: () => '',
    document: {
      getElementById: (id) => docNodes[id] || defaultNode,
      querySelectorAll: () => []
    },
    requestAnimationFrame: (fn) => fn()
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports = { renderKanbanUi, showPageUi, renderCurrentPageUi };`, sandbox, { filename: 'render-controller.js' });
  return sandbox.__exports;
}

function loadKeyboardController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/keyboard-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sandbox = {
    console,
    document: { getElementById: () => ({ classList: { contains: () => true } }) },
    setTimeout,
    clearTimeout
  };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports = { handleTwoKeySequence };`, sandbox, { filename: 'keyboard-controller.js' });
  return sandbox.__exports;
}

test('app shell includes a kanban page entry and container', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  assert.equal(/App\.showPage\('kanban'\)/.test(html), true);
  assert.equal(/id="kanban-page"/.test(html), true);
  assert.equal(/id="kanban-c"/.test(html), true);
});

test('renderKanbanUi renders status columns for active list tasks', () => {
  const docNodes = { 'kanban-c': { innerHTML: '' } };
  const { renderKanbanUi } = loadRenderController(docNodes);
  const state = {
    listId: 'l1',
    data: {
      lists: { l1: { id: 'l1', root_tasks: ['t1', 't2'] } },
      tasks: {
        t1: { id: 't1', content: 'Open task', status: 0, tasks: ['t1a'] },
        t1a: { id: 't1a', content: 'Invalid child', status: 2, tasks: [] },
        t2: { id: 't2', content: 'Done task', status: 1, tasks: [] }
      }
    }
  };

  const app = { showPage: () => {} };
  renderKanbanUi(app, state);

  assert.equal(docNodes['kanban-c'].innerHTML.includes('Open (1)'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Done (1)'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Invalid (1)'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Open task'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Done task'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Invalid child'), true);
});

test('renderKanbanUi shows empty state when active list has no tasks', () => {
  const docNodes = { 'kanban-c': { innerHTML: '' } };
  const { renderKanbanUi } = loadRenderController(docNodes);
  const state = {
    listId: 'l1',
    data: {
      lists: { l1: { id: 'l1', root_tasks: [] } },
      tasks: {}
    }
  };
  renderKanbanUi({ showPage: () => {} }, state);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('No tasks yet'), true);
});

test('showPageUi and gk shortcut support kanban navigation', () => {
  const docNodes = {
    'home-page': { classList: { add: () => {}, remove: () => {} } },
    'list-page': { classList: { add: () => {}, remove: () => {} } },
    'due-page': { classList: { add: () => {}, remove: () => {} } },
    'kanban-page': { classList: { add: () => {}, remove: () => {} } },
    'tags-page': { classList: { add: () => {}, remove: () => {} } }
  };
  const { showPageUi } = loadRenderController(docNodes);
  const { handleTwoKeySequence } = loadKeyboardController();

  const state = { page: 'list', kbuf: '', kbtimer: null, selId: null };
  const calls = { renderKanban: 0, syncSB: 0, showPage: '' };
  const app = {
    renderHome: () => {},
    renderList: () => {},
    renderDue: () => {},
    renderKanban: () => { calls.renderKanban += 1; },
    renderTags: () => {},
    syncSB: () => { calls.syncSB += 1; },
    showPage: (p) => { calls.showPage = p; },
    showKH: () => {},
    clearKH: () => {}
  };

  showPageUi(app, state, 'kanban');
  assert.equal(state.page, 'kanban');
  assert.equal(calls.renderKanban, 1);
  assert.equal(calls.syncSB, 1);

  const shortcutState = {
    selId: 't1',
    kbuf: '',
    kbtimer: null
  };
  const event = { ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => {}, key: 'g' };
  handleTwoKeySequence(app, shortcutState, event);
  event.key = 'k';
  handleTwoKeySequence(app, shortcutState, event);
  assert.equal(calls.showPage, 'kanban');
});
