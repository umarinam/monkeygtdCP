const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/render-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    md: (s) => s,
    esc: (s) => String(s),
    getDueCls: () => '',
    fmtDue: () => '',
    document: {
      getElementById: () => ({ classList: { add: () => {}, remove: () => {} }, innerHTML: '', textContent: '' }),
      querySelectorAll: () => []
    },
    requestAnimationFrame: (fn) => fn()
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__renderExports = { buildTaskTreeUi };`, sandbox, { filename: 'render-controller.js' });
  return sandbox.__renderExports;
}

function mkTask(id, content) {
  return {
    id,
    content,
    status: 0,
    color: 0,
    tasks: [],
    tags_as_text: '',
    assignees: [],
    comments_count: 0,
    due: '',
    due_asap: false,
    repeating_due: null,
    created_at: '2026-07-01T00:00:00.000Z',
    updated_at: '2026-07-01T00:00:00.000Z',
    _collapsed: false,
    parent_id: '',
    checklist_id: 'l1'
  };
}

function mkState(editId) {
  return {
    filter: 'match',
    editId,
    selId: editId || 'a',
    msel: new Set(),
    showNotes: false,
    data: {
      settings: {
        showCompleted: true,
        moveCompletedDown: false,
        hideFuture: false,
        showSearchMatchChildren: false,
        showTaskJsonChip: false,
        showTaskHistoryChip: false
      },
      lists: {
        l1: { id: 'l1', style: 'none', root_tasks: ['a', 'new1'] }
      },
      tasks: {
        a: mkTask('a', 'match this task'),
        new1: mkTask('new1', '')
      }
    }
  };
}

function mkApp(state) {
  return {
    sibIdx: () => 1,
    select: (name, payload) => {
      const q = String(payload.q || '').toLowerCase();
      const matches = (id) => {
        const t = state.data.tasks[id];
        return !!t && String(t.content || '').toLowerCase().includes(q);
      };

      if (name === 'tasks.filterIds') {
        return (payload.ids || []).filter(matches);
      }

      if (name === 'tasks.filterMatchOnly') {
        return matches(payload.id);
      }

      throw new Error(`Unexpected query ${name}`);
    }
  };
}

test('buildTaskTreeUi keeps edit task visible when filter is active', () => {
  const { buildTaskTreeUi } = loadRenderController();
  const state = mkState('new1');
  const app = mkApp(state);

  const html = buildTaskTreeUi(app, state, ['a', 'new1'], 0, state.data.lists.l1);

  assert.equal(html.includes('data-id="new1"'), true);
  assert.equal(html.includes('id="ea-new1"'), true);
});

test('buildTaskTreeUi keeps previous pending row visible during Enter-chained entry', () => {
  const { buildTaskTreeUi } = loadRenderController();
  const state = mkState('new2');
  state.data.lists.l1.root_tasks = ['a', 'new1', 'new2'];
  state.data.tasks.new1 = mkTask('new1', 'non-matching entered text');
  state.data.tasks.new2 = mkTask('new2', '');
  state.pendingNewEditId = 'new2';
  state.pendingNewEditPrevId = 'new1';
  const app = mkApp(state);

  const html = buildTaskTreeUi(app, state, ['a', 'new1', 'new2'], 0, state.data.lists.l1);

  assert.equal(html.includes('data-id="new1"'), true);
  assert.equal(html.includes('data-id="new2"'), true);
  assert.equal(html.includes('id="ea-new2"'), true);
});

test('buildTaskTreeUi still filters non-matching tasks when not editing them', () => {
  const { buildTaskTreeUi } = loadRenderController();
  const state = mkState(null);
  const app = mkApp(state);

  const html = buildTaskTreeUi(app, state, ['a', 'new1'], 0, state.data.lists.l1);

  assert.equal(html.includes('data-id="a"'), true);
  assert.equal(html.includes('data-id="new1"'), false);
});

test('search match children setting off keeps non-matching descendants hidden', () => {
  const { buildTaskTreeUi } = loadRenderController();
  const state = mkState(null);
  state.data.lists.l1.root_tasks = ['a'];
  state.data.tasks.a.tasks = ['new1'];
  state.data.tasks.new1.parent_id = 'a';
  state.data.tasks.new1.content = 'child without token';
  state.data.settings.showSearchMatchChildren = false;
  const app = mkApp(state);

  const html = buildTaskTreeUi(app, state, ['a'], 0, state.data.lists.l1);

  assert.equal(html.includes('data-id="a"'), true);
  assert.equal(html.includes('data-id="new1"'), false);
});

test('search match children setting on shows full subtree under matching parent', () => {
  const { buildTaskTreeUi } = loadRenderController();
  const state = mkState(null);
  state.data.lists.l1.root_tasks = ['a'];
  state.data.tasks.a.tasks = ['new1'];
  state.data.tasks.new1.parent_id = 'a';
  state.data.tasks.new1.content = 'child without token';
  state.data.settings.showSearchMatchChildren = true;
  const app = mkApp(state);

  const html = buildTaskTreeUi(app, state, ['a'], 0, state.data.lists.l1);

  assert.equal(html.includes('data-id="a"'), true);
  assert.equal(html.includes('data-id="new1"'), true);
});
