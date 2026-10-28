const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function load(rel, names, extra = {}) {
  const sandbox = {
    console,
    md: s => s,
    esc: s => String(s),
    getDueCls: () => '',
    fmtDue: t => t.due || '',
    document: { getElementById: () => null, querySelectorAll: () => [] },
    ...extra
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), sandbox, { filename: rel });
  vm.runInContext(`globalThis.__exports = { ${names.join(', ')} };`, sandbox);
  return sandbox.__exports;
}

function buildState() {
  const task = {
    id: 't1',
    checklist_id: 'l1',
    parent_id: null,
    deleted: false,
    status: 1,
    content: 'Send invoice',
    tags_as_text: '',
    assignees: [],
    due: '2026-07-09',
    due_asap: false,
    color: 0,
    tasks: [],
    created_at: '2026-07-01T09:00:00Z',
    updated_at: '2026-07-05T09:00:00Z',
    completed_at: '2026-07-06T09:00:00Z'
  };
  return {
    page: 'due',
    filter: '',
    selId: null,
    msel: new Set(),
    collapsedDueSections: new Set(),
    data: {
      settings: { showCompleted: true, relativeDates: false, showTaskJsonChip: false, showTaskHistoryChip: false },
      lists: { l1: { id: 'l1', name: 'Main', style: 'none', root_tasks: ['t1'] } },
      tasks: { t1: task }
    }
  };
}

function renderDue(state) {
  const dueNode = { innerHTML: '' };
  const { renderDueUi } = load('js/ui/render-controller.js', ['renderDueUi'], {
    document: { getElementById: id => (id === 'due-c' ? dueNode : null), querySelectorAll: () => [] }
  });
  const app = {
    select: name => (name === 'due.sections' ? [{ title: 'Today', items: [state.data.tasks.t1] }] : null)
  };
  renderDueUi(app, state);
  return dueNode.innerHTML;
}

test('sd shows details on the first press and re-renders the current page', () => {
  const state = buildState();
  const toasts = [];
  let renders = 0;
  const app = { render: () => { renders++; }, toast: m => toasts.push(m) };
  const { toggleDetailsUi } = load('js/ui/utilities-controller.js', ['toggleDetailsUi']);

  toggleDetailsUi(app, state);
  assert.equal(state.showDetails, true);
  assert.equal(renders, 1);
  assert.deepEqual(toasts, ['Details visible']);

  toggleDetailsUi(app, state);
  assert.equal(state.showDetails, false);
  assert.equal(renders, 2);
  assert.equal(toasts[1], 'Details hidden');
});

test('sd works with no task selected, as on the Due page before a row is picked', () => {
  const { handleTwoKeySequence } = load('js/ui/keyboard-controller.js', ['handleTwoKeySequence'], { setTimeout, clearTimeout });
  const state = { selId: null, kbuf: '', kbtimer: null, msel: new Set() };
  let toggles = 0;
  const app = { showKH: () => {}, clearKH: () => {}, toggleDetails: () => { toggles++; } };

  for (const key of ['s', 'd']) handleTwoKeySequence(app, state, { key, preventDefault() {} });

  assert.equal(toggles, 1);
  assert.equal(state.kbuf, '');
  clearTimeout(state.kbtimer);
});

test('due page shows each task\'s created, updated and done dates while details are on', () => {
  const state = buildState();
  state.showDetails = true;
  const html = renderDue(state);
  assert.match(html, /class="tdetail on">Created: 2026-07-01 · Updated: 2026-07-05 · Done: 2026-07-06</);
});

test('due page leaves details out while they are off', () => {
  const html = renderDue(buildState());
  assert.equal(html.includes('Created:'), false);
});

test('list rows render details from state, so they survive a re-render', () => {
  const state = buildState();
  const { buildTaskItemUi } = load('js/ui/render-controller.js', ['buildTaskItemUi']);
  const list = state.data.lists.l1;

  assert.match(buildTaskItemUi({}, state, 't1', 0, list), /class="tdetail">Created: 2026-07-01/);
  state.showDetails = true;
  assert.match(buildTaskItemUi({}, state, 't1', 0, list), /class="tdetail on">Created: 2026-07-01/);
});

test('the on class makes a detail line visible', () => {
  const css = fs.readFileSync(path.join(process.cwd(), 'styles.css'), 'utf8');
  assert.equal(css.includes('.tdetail.on{display:block}'), true);
});
