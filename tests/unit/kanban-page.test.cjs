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

test('renderKanbanUi renders project swimlanes from top-level tasks', () => {
  const docNodes = { 'kanban-c': { innerHTML: '' } };
  const { renderKanbanUi } = loadRenderController(docNodes);
  const state = {
    listId: 'l1',
    data: {
      lists: { l1: { id: 'l1', root_tasks: ['p1', 'p2'] } },
      tasks: {
        p1: { id: 'p1', content: 'Project Alpha', status: 0, tasks: ['a1', 'a2'] },
        a1: { id: 'a1', content: 'Alpha Open', status: 0, tasks: [] },
        a2: { id: 'a2', content: 'Alpha Invalid', status: 2, tasks: [] },
        p2: { id: 'p2', content: 'Project Beta', status: 0, tasks: ['b1'] },
        b1: { id: 'b1', content: 'Beta Done', status: 1, tasks: [] }
      }
    }
  };

  const app = { showPage: () => {} };
  renderKanbanUi(app, state);

  assert.equal(docNodes['kanban-c'].innerHTML.includes('Project Alpha'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Project Beta'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Open 1'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Done 1'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Invalid 1'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('kanban-new-task-p1'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('kanban-new-task-p2'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes("App.setTaskStatus('a1',0)"), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes("App.setTaskStatus('b1',1)"), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes("App.setTaskStatus('a2',2)"), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Alpha Open'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Beta Done'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('Alpha Invalid'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('App.jumpTo(\'p1\')'), true);
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
  assert.equal(docNodes['kanban-c'].innerHTML.includes('No projects yet'), true);
  assert.equal(docNodes['kanban-c'].innerHTML.includes('kanban-new-task'), true);
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
