const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderController(docNodes = {}) {
  const sourcePath = path.join(process.cwd(), 'js/ui/render-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const defaultNode = {
    className: '',
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
      querySelectorAll: () => [],
      querySelector: () => null
    },
    requestAnimationFrame: (fn) => fn()
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__renderExports = { renderListUi, buildTaskItemUi, getTaskListLayoutClassName };`,
    sandbox,
    { filename: 'render-controller.js' }
  );
  return sandbox.__renderExports;
}

function loadSeedData() {
  const sourcePath = path.join(process.cwd(), 'js/core/utils.js');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sandbox = {
    console,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: { body: { classList: { add: () => {}, remove: () => {} } } },
    window: {},
    crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__utilsExports = { seedData };`, sandbox, { filename: 'utils.js' });
  return sandbox.__utilsExports.seedData;
}

function makeState(settings = {}) {
  return {
    listId: 'l1',
    page: 'list',
    hoistId: null,
    selId: 'p1',
    msel: new Set(),
    editId: null,
    filter: '',
    showNotes: false,
    data: {
      settings: {
        showCompleted: true,
        moveCompletedDown: false,
        hideFuture: false,
        relativeDates: false,
        taskDensity: 'relaxed',
        emphasizeParentTasks: true,
        indentGuideStyle: 'subtle',
        branchSpacing: 'relaxed',
        focusMode: 'path',
        contentWidth: 'measure',
        ...settings
      },
      lists: {
        l1: { id: 'l1', name: 'My Tasks', style: 'none', root_tasks: ['p1', 'p2'] }
      },
      tasks: {
        p1: {
          id: 'p1',
          checklist_id: 'l1',
          content: 'Parent one',
          status: 0,
          color: 0,
          tasks: ['c1'],
          tags_as_text: '',
          assignees: [],
          comments_count: 0,
          due: '',
          due_asap: false,
          repeating_due: null,
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
          _collapsed: false,
          parent_id: ''
        },
        c1: {
          id: 'c1',
          checklist_id: 'l1',
          content: 'Child one',
          status: 0,
          color: 0,
          tasks: [],
          tags_as_text: '',
          assignees: [],
          comments_count: 0,
          due: '',
          due_asap: false,
          repeating_due: null,
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
          _collapsed: false,
          parent_id: 'p1'
        },
        p2: {
          id: 'p2',
          checklist_id: 'l1',
          content: 'Parent two',
          status: 0,
          color: 0,
          tasks: [],
          tags_as_text: '',
          assignees: [],
          comments_count: 0,
          due: '',
          due_asap: false,
          repeating_due: null,
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
          _collapsed: false,
          parent_id: ''
        }
      }
    }
  };
}

test('renderListUi applies configured layout classes to the task list container', () => {
  const taskListEl = { className: '', innerHTML: '', onclick: null, addEventListener: () => {} };
  const titleEl = { textContent: '' };
  const { renderListUi } = loadRenderController({ 'task-list': taskListEl, 'list-title': titleEl });

  const state = makeState();
  const app = {
    renderBreadcrumbs: () => {},
    scrollSel: () => {},
    visible: () => ['p1', 'c1', 'p2']
  };

  renderListUi(app, state);

  assert.match(taskListEl.className, /density-relaxed/);
  assert.match(taskListEl.className, /parents-strong/);
  assert.match(taskListEl.className, /guides-subtle/);
  assert.match(taskListEl.className, /branches-relaxed/);
  assert.match(taskListEl.className, /focus-path/);
  assert.match(taskListEl.className, /measure-readable/);
  assert.equal(titleEl.textContent, 'My Tasks');
});

test('buildTaskItemUi marks parent, depth, and focus states for configurable styling', () => {
  const { buildTaskItemUi } = loadRenderController();
  const state = makeState();
  const app = { sibIdx: () => 1 };

  const selectedParentHtml = buildTaskItemUi(app, state, 'p1', 0, state.data.lists.l1);
  const otherParentHtml = buildTaskItemUi(app, state, 'p2', 0, state.data.lists.l1);
  const childHtml = buildTaskItemUi(app, state, 'c1', 1, state.data.lists.l1);

  assert.match(selectedParentHtml, /class="ti[^"]*has-kids[^"]*depth-0[^"]*focus-active/);
  assert.equal(selectedParentHtml.includes('class="igw"'), true);
  assert.match(childHtml, /class="ti[^"]*leaf[^"]*depth-1[^"]*focus-path/);
  assert.match(otherParentHtml, /class="ti[^"]*focus-dim/);
});

test('settings modal exposes configurable task list layout controls', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');

  for (const id of ['s-density', 's-parent-emphasis', 's-guides', 's-branches', 's-focus', 's-measure']) {
    assert.equal(html.includes(`id="${id}"`), true, `Missing settings control ${id}`);
  }
});

test('task list layout falls back to the calmer default profile', () => {
  const { getTaskListLayoutClassName } = loadRenderController();
  const className = getTaskListLayoutClassName({});

  assert.match(className, /density-comfortable/);
  assert.match(className, /parents-strong/);
  assert.match(className, /guides-subtle/);
  assert.match(className, /branches-relaxed/);
  assert.match(className, /focus-off/);
  assert.match(className, /measure-readable/);
});

test('seedData uses the calmer task list layout defaults', () => {
  const seedData = loadSeedData();
  const data = seedData();
  const settings = data.settings || {};

  assert.equal(settings.taskDensity, 'comfortable');
  assert.equal(settings.emphasizeParentTasks, true);
  assert.equal(settings.indentGuideStyle, 'subtle');
  assert.equal(settings.branchSpacing, 'relaxed');
  assert.equal(settings.focusMode, 'off');
  assert.equal(settings.contentWidth, 'measure');
});

test('indent guide modes define explicit and visibly distinct CSS rules', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');

  assert.equal(css.includes('.igw{display:flex;align-self:stretch}'), true);
  assert.equal(css.includes('#task-list.guides-full .ig::before{'), true);
  assert.equal(css.includes('#task-list.guides-subtle .ig::before{'), true);
  assert.equal(css.includes('#task-list.guides-none .ig::before{'), true);
  assert.equal(css.includes('border-left:2px solid color-mix(in srgb, var(--text) 22%, var(--border))'), true);
  assert.equal(css.includes('border-left:1px solid color-mix(in srgb, var(--border) 45%, transparent)'), true);
  assert.equal(css.includes('border-left:none'), true);
});