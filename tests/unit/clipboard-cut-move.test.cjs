const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function loadScripts(files, exportNames, globals = {}) {
  const sandbox = { console, JSON, Math, Date, setTimeout, clearTimeout, ...globals };
  vm.createContext(sandbox);
  for (const rel of files) vm.runInContext(read(rel), sandbox, { filename: rel });
  vm.runInContext(`globalThis.__exports = { ${exportNames.join(', ')} };`, sandbox);
  return sandbox.__exports;
}

function loadDomain() {
  const written = [];
  let n = 0;
  const ctx = loadScripts(
    [
      'js/core/utils.js',
      'js/domain/tree-ops.js',
      'js/domain/clipboard-ops.js',
      'js/domain/import-export.js',
      'js/domain/bookmark-ops.js',
      'js/domain/time-tracking-ops.js'
    ],
    [
      'mkTask', 'sibListDomain', 'copyDomain', 'cutDomain', 'pasteDomain', 'clearCutDomain',
      'importTextDomain', 'bookmarkTargetDomain', 'sessionsForTaskDomain'
    ],
    {
      navigator: { clipboard: { writeText: text => { written.push(String(text)); return Promise.resolve(); } } },
      uid: () => `new${++n}`,
      now: () => '2026-10-19T09:00:00.000Z'
    }
  );
  return { ctx, written };
}

function makeState(ctx) {
  const task = o => ctx.mkTask({ checklist_id: 'l1', ...o });
  return {
    listId: 'l1',
    selId: null,
    hoistId: null,
    filter: '',
    msel: new Set(),
    clipboard: null,
    clipboardIndex: null,
    cutIds: null,
    data: {
      settings: {},
      lists: {
        l1: { id: 'l1', name: 'Work', root_tasks: ['a', 'b', 'c'] },
        l2: { id: 'l2', name: 'Home', root_tasks: ['x'] }
      },
      tasks: {
        a: task({ id: 'a', content: 'A', tasks: ['a1'] }),
        a1: task({ id: 'a1', content: 'A1', parent_id: 'a', tasks: ['a2'] }),
        a2: task({ id: 'a2', content: 'A2', parent_id: 'a1' }),
        b: task({ id: 'b', content: 'B' }),
        c: task({ id: 'c', content: 'C' }),
        x: task({ id: 'x', content: 'X', checklist_id: 'l2' })
      },
      bookmarks: [{ id: 'bm1', name: '', listId: 'l1', taskId: 'a', filter: '', shortcut: 'b1' }],
      timeSessions: [{ id: 's1', taskId: 'a1', start: '2026-10-18T09:00:00.000Z', end: '2026-10-18T10:00:00.000Z' }]
    }
  };
}

function makeApp(ctx, state) {
  const calls = { undo: [], toasts: [], render: 0, save: 0 };
  const app = {
    calls,
    pushUndo: snap => calls.undo.push(snap),
    snap: () => JSON.parse(JSON.stringify({ tasks: state.data.tasks, lists: state.data.lists })),
    save: () => { calls.save++; },
    render: () => { calls.render++; },
    toast: msg => calls.toasts.push(msg),
    sibList: id => ctx.sibListDomain(state, id)
  };
  return app;
}

function structureMoves(task) {
  return (task.history || []).filter(h => h.type === 'structure' && h.changes.action === 'cut-paste');
}

test('cut marks the tasks and leaves them in place', () => {
  const { ctx, written } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  ctx.cutDomain(app, state);

  assert.deepEqual([...state.cutIds], ['a']);
  assert.deepEqual([...state.data.lists.l1.root_tasks], ['a', 'b', 'c']);
  assert.equal(state.data.tasks.a.deleted, false);
  assert.equal(state.data.tasks.a1.parent_id, 'a');
  assert.equal(app.calls.undo.length, 0, 'marking a cut is not an undo step');
  assert.equal(app.calls.render > 0, true, 'the cut rows are redrawn dimmed');
  assert.equal(written.at(-1), '- [ ] A\n  - [ ] A1\n    - [ ] A2');
});

test('paste after a cut moves the original branch below the selected task, keeping ids', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);
  const idsBefore = Object.keys(state.data.tasks).sort();

  state.selId = 'a';
  ctx.cutDomain(app, state);
  state.selId = 'c';
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l1.root_tasks], ['b', 'c', 'a']);
  assert.deepEqual(Object.keys(state.data.tasks).sort(), idsBefore, 'no task is created or dropped');
  assert.deepEqual([...state.data.tasks.a.tasks], ['a1']);
  assert.equal(state.data.tasks.a1.parent_id, 'a');
  assert.equal(state.data.tasks.a2.parent_id, 'a1');
  assert.equal(state.data.tasks.a.deleted, false);
  assert.equal(state.cutIds, null, 'the cut is used up');
  assert.equal(state.selId, 'a', 'the moved task is selected');

  const moves = structureMoves(state.data.tasks.a);
  assert.equal(moves.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(moves[0].changes.from)), { parent_id: '', checklist_id: 'l1' });
  assert.deepEqual(JSON.parse(JSON.stringify(moves[0].changes.to)), { parent_id: '', checklist_id: 'l1' });
  assert.equal(moves[0].changes.afterTaskId, 'c');
  assert.equal(state.data.tasks.a.history.some(h => h.type === 'creation'), false);
});

test('paste after a cut is a single undo step', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  state.msel = new Set(['a', 'c']);
  ctx.cutDomain(app, state);
  state.msel = new Set();
  state.selId = 'b';
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l1.root_tasks], ['b', 'a', 'c'], 'moved tasks keep their order');
  assert.equal(app.calls.undo.length, 1);
  assert.deepEqual(app.calls.undo[0].lists.l1.root_tasks, ['a', 'b', 'c']);
  assert.deepEqual([...state.msel].sort(), ['a', 'c'], 'every moved task stays selected');
});

test('a cut pasted below a nested task becomes its sibling', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'b';
  ctx.cutDomain(app, state);
  state.selId = 'a1';
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l1.root_tasks], ['a', 'c']);
  assert.deepEqual([...state.data.tasks.a.tasks], ['a1', 'b']);
  assert.equal(state.data.tasks.b.parent_id, 'a');
  const [move] = structureMoves(state.data.tasks.b);
  assert.deepEqual(JSON.parse(JSON.stringify(move.changes.to)), { parent_id: 'a', checklist_id: 'l1' });
});

test('a cut moves to another list with its subtree, bookmarks and logged time', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  ctx.cutDomain(app, state);
  state.listId = 'l2';
  state.selId = 'x';
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l1.root_tasks], ['b', 'c']);
  assert.deepEqual([...state.data.lists.l2.root_tasks], ['x', 'a']);
  for (const id of ['a', 'a1', 'a2']) assert.equal(state.data.tasks[id].checklist_id, 'l2', `${id} follows to l2`);

  const target = ctx.bookmarkTargetDomain(state, state.data.bookmarks[0]);
  assert.equal(target.task, state.data.tasks.a, 'the bookmark still finds the task');
  assert.equal(target.listId, 'l2');

  const sessions = ctx.sessionsForTaskDomain(state.data, 'a1');
  assert.equal(sessions.length, 1, 'logged time still belongs to the moved subtask');
  assert.equal(state.data.tasks[sessions[0].taskId].checklist_id, 'l2');

  const [move] = structureMoves(state.data.tasks.a);
  assert.deepEqual(JSON.parse(JSON.stringify(move.changes.from)), { parent_id: '', checklist_id: 'l1' });
  assert.deepEqual(JSON.parse(JSON.stringify(move.changes.to)), { parent_id: '', checklist_id: 'l2' });
});

test('a cut pasted with nothing selected goes to the end of the current list', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'b';
  ctx.cutDomain(app, state);
  state.listId = 'l2';
  state.selId = null;
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l2.root_tasks], ['x', 'b']);
  assert.equal(state.data.tasks.b.checklist_id, 'l2');
});

test('pasting a cut into itself or one of its descendants is refused', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);
  const before = JSON.stringify({ tasks: state.data.tasks, lists: state.data.lists });

  state.selId = 'a';
  ctx.cutDomain(app, state);
  for (const target of ['a', 'a2']) {
    state.selId = target;
    ctx.pasteDomain(app, state);
    assert.match(app.calls.toasts.at(-1), /outside the cut/);
  }

  assert.equal(JSON.stringify({ tasks: state.data.tasks, lists: state.data.lists }), before);
  assert.equal(app.calls.undo.length, 0);
  assert.deepEqual([...state.cutIds], ['a'], 'the cut stays marked so another place can be picked');
});

test('a cut whose tasks were deleted meanwhile pastes nothing', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'b';
  ctx.cutDomain(app, state);
  state.data.tasks.b.deleted = true;
  state.selId = 'c';
  ctx.pasteDomain(app, state);

  assert.deepEqual([...state.data.lists.l1.root_tasks], ['a', 'b', 'c']);
  assert.equal(app.calls.undo.length, 0);
  assert.equal(state.cutIds, null);
});

test('copy then paste still creates new copies, in order', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  state.msel = new Set(['a', 'b']);
  ctx.copyDomain(app, state);
  state.msel = new Set();
  state.selId = 'c';
  ctx.pasteDomain(app, state);

  const roots = state.data.lists.l1.root_tasks;
  assert.deepEqual(roots.slice(0, 3), ['a', 'b', 'c']);
  assert.deepEqual(roots.slice(3).map(id => state.data.tasks[id].content), ['A', 'B']);
  assert.equal(roots.slice(3).some(id => ['a', 'b'].includes(id)), false);
  const copyOfA = state.data.tasks[roots[3]];
  assert.notEqual(copyOfA.tasks[0], 'a1');
  assert.equal(state.data.tasks[copyOfA.tasks[0]].content, 'A1');
  assert.deepEqual([...state.data.tasks.a.tasks], ['a1'], 'the original branch is untouched');
});

test('copy after a cut drops the cut, so paste makes a copy', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  ctx.cutDomain(app, state);
  state.selId = 'b';
  ctx.copyDomain(app, state);
  assert.equal(state.cutIds, null);

  state.selId = 'c';
  ctx.pasteDomain(app, state);
  assert.deepEqual([...state.data.lists.l1.root_tasks].slice(0, 3), ['a', 'b', 'c']);
  assert.equal(state.data.lists.l1.root_tasks.length, 4);
});

test('clearCutDomain clears a pending cut and reports whether there was one', () => {
  const { ctx } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);

  state.selId = 'a';
  ctx.cutDomain(app, state);
  assert.equal(ctx.clearCutDomain(app, state), true);
  assert.equal(state.cutIds, null);
  assert.equal(state.clipboard, null);
  assert.equal(ctx.clearCutDomain(app, state), false);

  state.selId = 'c';
  ctx.pasteDomain(app, state);
  assert.deepEqual([...state.data.lists.l1.root_tasks], ['a', 'b', 'c'], 'nothing left to paste');
});

test('copy writes the branch as Markdown with checkboxes, strikethrough and notes', () => {
  const { ctx, written } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);
  const t = state.data.tasks;
  t.a.notes = [{ id: 'n1', author: 'me', content: 'First note' }, { id: 'n2', author: 'me', content: 'line one\nline two' }];
  t.a.tasks = ['a1', 'a3'];
  t.a1.status = 1;
  t.a3 = ctx.mkTask({ id: 'a3', content: 'Dropped', status: 2, parent_id: 'a', checklist_id: 'l1' });

  state.selId = 'a';
  ctx.copyDomain(app, state);

  assert.equal(written.at(-1), [
    '- [ ] A',
    '  > First note',
    '  > line one',
    '  > line two',
    '  - [x] A1',
    '    - [ ] A2',
    '  - [ ] ~~Dropped~~'
  ].join('\n'));
});

test('copied Markdown round-trips through the text importer', () => {
  const { ctx, written } = loadDomain();
  const state = makeState(ctx);
  const app = makeApp(ctx, state);
  const t = state.data.tasks;
  t.a.notes = [{ id: 'n1', author: 'me', content: 'Why this matters' }];
  t.a1.status = 1;
  t.a2.status = 2;
  t.a2.notes = [{ id: 'n2', author: 'me', content: 'Dropped on purpose' }];

  state.selId = 'a';
  state.msel = new Set(['a', 'b']);
  ctx.copyDomain(app, state);

  const target = { data: { tasks: {}, lists: {} } };
  const list = { id: 'l9', root_tasks: [] };
  let n = 0;
  const ids = ctx.importTextDomain(target, written.at(-1), list, () => `i${++n}`, ctx.mkTask);

  const shape = id => {
    const task = target.data.tasks[id];
    return {
      content: task.content,
      status: task.status,
      notes: (task.notes || []).map(note => note.content),
      tasks: (task.tasks || []).map(shape)
    };
  };
  assert.deepEqual(JSON.parse(JSON.stringify(ids.map(shape))), [
    {
      content: 'A', status: 0, notes: ['Why this matters'], tasks: [
        { content: 'A1', status: 1, notes: [], tasks: [
          { content: 'A2', status: 2, notes: ['Dropped on purpose'], tasks: [] }
        ] }
      ]
    },
    { content: 'B', status: 0, notes: [], tasks: [] }
  ]);
});

function loadRenderController() {
  return loadScripts(['js/ui/render-controller.js'], ['buildTaskItemUi'], {
    md: s => s,
    esc: s => String(s),
    getDueCls: () => '',
    fmtDue: () => '',
    document: {
      getElementById: () => ({ classList: { add: () => {}, remove: () => {} }, innerHTML: '', textContent: '' }),
      querySelectorAll: () => []
    },
    requestAnimationFrame: fn => fn()
  });
}

test('cut tasks and their subtasks render dimmed', () => {
  const { ctx } = loadDomain();
  const { buildTaskItemUi } = loadRenderController();
  const state = makeState(ctx);
  state.editId = null;
  state.showNotes = false;
  state.cutIds = ['a1'];
  const app = { select: () => false };
  const list = { id: 'l1', style: 'none', root_tasks: ['a', 'b', 'c'] };

  const html = buildTaskItemUi(app, state, 'a', 0, list);
  const rowClass = id => html.match(new RegExp(`<div class="([^"]*)" data-id="${id}"`))[1].split(' ');
  assert.equal(rowClass('a').includes('cut'), false);
  assert.equal(rowClass('a1').includes('cut'), true);
  assert.equal(rowClass('a2').includes('cut'), true);
});

test('status bar shows the pending cut and how to move it', () => {
  const nodes = {};
  const node = id => (nodes[id] ||= { textContent: '', style: { display: '' } });
  const { syncStatusBarUi } = loadScripts(['js/ui/chrome-controller.js'], ['syncStatusBarUi'], {
    document: { getElementById: node }
  });
  const state = {
    listId: 'l1', selId: null, editId: null, filter: '', cutIds: ['a', 'c'],
    data: { settings: {}, lists: { l1: { id: 'l1', name: 'Work', root_tasks: [] } }, tasks: {} }
  };

  syncStatusBarUi(state);
  assert.equal(nodes['sb-cut'].textContent, '2 cut - Ctrl+V to move');
  assert.equal(nodes['sb-cut'].style.display, '');

  state.cutIds = null;
  syncStatusBarUi(state);
  assert.equal(nodes['sb-cut'].style.display, 'none');
});

test('Escape clears the multi-selection first, then the pending cut, before deselecting', () => {
  const { handleGlobalKey } = loadScripts(['js/ui/keyboard-controller.js'], ['handleGlobalKey'], {
    document: { activeElement: null, getElementById: () => ({ classList: { contains: () => true } }) }
  });
  const state = {
    selId: 'b', editId: null, hoistId: null, filter: '', kbuf: '', kbtimer: null,
    msel: new Set(['a', 'b']), cutIds: ['a'], data: { settings: {}, tasks: {} }
  };
  let cleared = 0;
  const app = {
    render: () => {},
    clearCut: () => { cleared++; state.cutIds = null; }
  };
  const esc = () => handleGlobalKey(app, state, { key: 'Escape', ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, preventDefault() {} });

  esc();
  assert.equal(state.msel.size, 0);
  assert.equal(cleared, 0);

  esc();
  assert.equal(cleared, 1);
  assert.equal(state.selId, 'b', 'clearing the cut keeps the selection');

  esc();
  assert.equal(state.selId, null);
});
