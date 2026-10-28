const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Renders the due page with the real queries (due.sections, stats.progress) and tree walker.
function renderDuePage(state) {
  const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
  const dueNode = { innerHTML: '' };
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    md: s => s,
    esc: s => String(s),
    getDueCls: () => '',
    fmtDue: t => t.due || '',
    todayS: () => '2026-07-09',
    tomorrowS: () => '2026-07-10',
    cmpDate: (a, b) => String(a || '').localeCompare(String(b || '')),
    document: {
      getElementById: id => (id === 'due-c' ? dueNode : { classList: { add() {}, remove() {} } }),
      querySelectorAll: () => []
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(read('js/core/traversal.js'), sandbox, { filename: 'traversal.js' });
  vm.runInContext(read('js/domain/queries.js'), sandbox, { filename: 'queries.js' });
  vm.runInContext(read('js/ui/render-controller.js'), sandbox, { filename: 'render-controller.js' });
  vm.runInContext('globalThis.__exports = { registerAppQueries, renderDueUi, walkTasks, SKIP_CHILDREN };', sandbox);
  const { registerAppQueries, renderDueUi, walkTasks, SKIP_CHILDREN } = sandbox.__exports;

  const handlers = new Map();
  const app = {
    queryService: { register: (name, fn) => handlers.set(name, fn) },
    select: (name, payload) => handlers.get(name)(payload)
  };
  registerAppQueries(app, {
    state,
    walkTasks,
    skipChildren: SKIP_CHILDREN,
    todayS: sandbox.todayS,
    tomorrowS: sandbox.tomorrowS,
    cmpDate: sandbox.cmpDate,
    esc: sandbox.esc
  });

  renderDueUi(app, state);
  return dueNode.innerHTML;
}

function task(id, fields = {}) {
  return {
    id,
    checklist_id: 'l1',
    parent_id: null,
    deleted: false,
    status: 0,
    content: id,
    tags_as_text: '',
    assignees: [],
    due: null,
    due_asap: false,
    tasks: [],
    ...fields
  };
}

function buildState(tasks) {
  return {
    filter: '',
    selId: null,
    collapsedDueSections: new Set(),
    data: {
      settings: { showCompleted: true, relativeDates: false },
      lists: { l1: { id: 'l1', name: 'Main', root_tasks: Object.keys(tasks).filter(id => !tasks[id].parent_id) } },
      tasks
    }
  };
}

// Pull out the due row rendered for one task.
function dueRow(html, id) {
  const start = html.indexOf(`App.selectDueTask('${id}')`);
  assert.notEqual(start, -1, `row for ${id} rendered`);
  const next = html.indexOf('App.selectDueTask(', start + 1);
  return html.slice(start, next === -1 ? html.length : next);
}

test('due task shows how many of its sub-tasks are still open, including nested ones', () => {
  const html = renderDuePage(buildState({
    project: task('project', { content: 'Launch site', due: '2026-07-09', tasks: ['c1', 'c2', 'c3', 'c4'] }),
    c1: task('c1', { parent_id: 'project', tasks: ['g1', 'g2'] }),
    g1: task('g1', { parent_id: 'c1' }),
    g2: task('g2', { parent_id: 'c1', status: 1 }),
    c2: task('c2', { parent_id: 'project', status: 1 }),
    c3: task('c3', { parent_id: 'project', status: 2 }),
    c4: task('c4', { parent_id: 'project', deleted: true })
  }));

  const row = dueRow(html, 'project');
  assert.match(row, /class="dkids"[^>]*>2 open</);
  assert.match(row, /title="2 of 5 sub-tasks open"/);
});

test('due task with no open sub-tasks shows no open-children count', () => {
  const html = renderDuePage(buildState({
    leaf: task('leaf', { content: 'Call bank', due: '2026-07-09' }),
    closed: task('closed', { content: 'Wrap up', due: '2026-07-10', tasks: ['d1', 'd2', 'gone'] }),
    d1: task('d1', { parent_id: 'closed', status: 1 }),
    d2: task('d2', { parent_id: 'closed', status: 2 }),
    gone: task('gone', { parent_id: 'closed', deleted: true })
  }));

  assert.doesNotMatch(dueRow(html, 'leaf'), /dkids/);
  assert.doesNotMatch(dueRow(html, 'closed'), /dkids/);
});

test('open-children count is a styled chip on the due page', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
  assert.equal(css.includes('.dkids{'), true);
});
