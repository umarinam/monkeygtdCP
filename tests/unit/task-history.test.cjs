const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext(files, exportsList, overrides = {}) {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    setTimeout,
    clearTimeout,
    ...overrides
  };

  vm.createContext(sandbox);
  for (const rel of files) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    vm.runInContext(source, sandbox, { filename: rel });
  }

  vm.runInContext(
    `globalThis.__exports = { ${exportsList.join(', ')} };`,
    sandbox,
    { filename: 'exports.js' }
  );

  return sandbox.__exports;
}

function baseState(task) {
  return {
    selId: task.id,
    listId: task.checklist_id,
    data: {
      settings: { autoCloseParent: false },
      tasks: { [task.id]: task },
      lists: { [task.checklist_id]: { id: task.checklist_id, root_tasks: [task.id], style: 'none' } }
    },
    msel: new Set()
  };
}

test('mkTask initializes embedded history array', () => {
  const ctx = loadContext(['js/core/utils.js'], ['mkTask']);
  const task = ctx.mkTask({ content: 'a' });
  assert.equal(Array.isArray(task.history), true);
  assert.equal(task.history.length, 0);
});

test('saveEditDomain records title/tags/assignment/scheduling/priority history', () => {
  const ctx = loadContext(['js/core/utils.js', 'js/domain/task-crud-ops.js'], ['mkTask', 'saveEditDomain']);
  const task = ctx.mkTask({ content: 'Old', checklist_id: 'l1', tags: {}, tags_as_text: '', assignees: [] });
  const state = baseState(task);

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    checkAutoClose: () => {}
  };

  ctx.saveEditDomain(app, state, task.id, 'New title #alpha @sam ^today !3');

  const historyTypes = task.history.map(h => h.type);
  assert.equal(historyTypes.includes('title'), true);
  assert.equal(historyTypes.includes('tags'), true);
  assert.equal(historyTypes.includes('assignment'), true);
  assert.equal(historyTypes.includes('scheduling'), true);
  assert.equal(historyTypes.includes('priority'), true);
  assert.equal(task.history.every(h => typeof h.at === 'string' && h.at.includes('T')), true);
});

test('assignTaskDomain records assignment history', () => {
  const ctx = loadContext(['js/core/utils.js', 'js/domain/task-ops.js'], ['mkTask', 'assignTaskDomain']);
  const task = ctx.mkTask({ content: 'Task', checklist_id: 'l1', assignees: [] });
  const state = baseState(task);

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {}
  };

  ctx.assignTaskDomain(app, state, true, { taskId: task.id, name: 'alice' });

  assert.equal(task.assignees.includes('alice'), true);
  assert.equal(task.history.some(h => h.type === 'assignment'), true);
});

test('assignTaskDomain applies one prompted assignee to multi-select in one batch', () => {
  const ctx = loadContext(
    ['js/core/utils.js', 'js/domain/task-ops.js'],
    ['mkTask', 'assignTaskDomain'],
    { prompt: () => 'alice' }
  );
  const t1 = ctx.mkTask({ id: 't1', content: 'A', checklist_id: 'l1', assignees: [] });
  const t2 = ctx.mkTask({ id: 't2', content: 'B', checklist_id: 'l1', assignees: [] });
  const state = {
    selId: 't1',
    msel: new Set(['t1', 't2']),
    data: {
      tasks: { t1, t2 },
      lists: { l1: { id: 'l1', root_tasks: ['t1', 't2'], style: 'none' } }
    }
  };

  const calls = { save: 0, render: 0, toast: '' };
  const app = {
    selectedIds: () => ['t1', 't2'],
    withUndoBatch: fn => fn(),
    pushUndo: () => {},
    snap: () => ({}),
    save: () => { calls.save += 1; },
    render: () => { calls.render += 1; },
    toast: (m) => { calls.toast = m; },
    dispatch: () => {}
  };

  ctx.assignTaskDomain(app, state, false, null);

  assert.equal(t1.assignees.includes('alice'), true);
  assert.equal(t2.assignees.includes('alice'), true);
  assert.equal(t1.history.some(h => h.type === 'assignment'), true);
  assert.equal(t2.history.some(h => h.type === 'assignment'), true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.toast.includes('2 task(s)'), true);
});

test('setDueQuickUi and addTagFromInputUi record scheduling and tag history', () => {
  const docNodes = {
    'tag-in': { value: '', classList: { remove: () => {} } },
    'tag-ac': { classList: { remove: () => {} } }
  };

  const ctx = loadContext(
    ['js/core/utils.js', 'js/ui/modal-controller.js'],
    ['mkTask', 'setDueQuickUi', 'addTagFromInputUi'],
    {
    document: {
      getElementById: (id) => docNodes[id] || { value: '', classList: { remove: () => {} } },
      querySelectorAll: () => []
    },
    renderCurrentTagsUi: () => {}
    }
  );

  const task = ctx.mkTask({ content: 'Task', checklist_id: 'l1', tags: {}, tags_as_text: '', due: '', due_asap: false });
  const state = baseState(task);

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    closeModal: () => {},
    render: () => {},
    toast: () => {},
    dispatch: () => {}
  };

  ctx.setDueQuickUi(app, state, 'today', true, task.id);
  ctx.addTagFromInputUi(app, state, true, { taskId: task.id, tag: 'urgent' });

  assert.equal(task.history.some(h => h.type === 'scheduling'), true);
  assert.equal(task.history.some(h => h.type === 'tags'), true);
});

test('toggleStatusDomain and invalidateDomain record status history', () => {
  const ctx = loadContext(['js/core/utils.js', 'js/domain/task-crud-ops.js'], ['mkTask', 'toggleStatusDomain', 'invalidateDomain']);
  const task = ctx.mkTask({ content: 'Task', checklist_id: 'l1', status: 0 });
  const state = baseState(task);

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    checkAutoClose: () => {}
  };

  ctx.toggleStatusDomain(app, state, task.id);
  ctx.invalidateDomain(app, state, task.id);

  const statusEntries = task.history.filter(h => h.type === 'status');
  assert.equal(statusEntries.length >= 2, true);
  assert.equal(statusEntries.some(h => h.changes.from === 0 && h.changes.to === 1), true);
  assert.equal(statusEntries.some(h => h.changes.to === 2 || h.changes.to === 0), true);
});

test('tree operations record structure history', () => {
  const ctx = loadContext(['js/core/utils.js', 'js/domain/tree-ops.js'], ['mkTask', 'moveDownDomain', 'indentDomain', 'moveToListDomain']);
  const t1 = ctx.mkTask({ id: 't1', content: 'A', checklist_id: 'l1', parent_id: '' });
  const t2 = ctx.mkTask({ id: 't2', content: 'B', checklist_id: 'l1', parent_id: '' });
  const t3 = ctx.mkTask({ id: 't3', content: 'C', checklist_id: 'l1', parent_id: '' });
  const state = {
    selId: 't2',
    listId: 'l1',
    msel: new Set(),
    data: {
      tasks: { t1, t2, t3 },
      lists: {
        l1: { id: 'l1', root_tasks: ['t1', 't2', 't3'] },
        l2: { id: 'l2', root_tasks: [], name: 'Target' }
      }
    }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    renderList: () => {},
    render: () => {},
    closeModal: () => {},
    toast: () => {}
  };

  ctx.moveDownDomain(app, state, 't2');
  ctx.indentDomain(app, state, 't3');
  state.selId = 't3';
  ctx.moveToListDomain(app, state, 'l2');

  const structureEntries = t3.history.filter(h => h.type === 'structure');
  assert.equal(structureEntries.length >= 2, true);
  assert.equal(structureEntries.some(h => h.changes.action === 'indent'), true);
  assert.equal(structureEntries.some(h => h.changes.action === 'move-to-list'), true);
});

test('moveToTaskDomain blocks moving selected ancestor into descendant target', () => {
  const ctx = loadContext(['js/core/utils.js', 'js/domain/tree-ops.js'], ['mkTask', 'moveToTaskDomain']);
  const t1 = ctx.mkTask({ id: 't1', content: 'Parent', checklist_id: 'l1', parent_id: '', tasks: ['t2'] });
  const t2 = ctx.mkTask({ id: 't2', content: 'Child', checklist_id: 'l1', parent_id: 't1', tasks: [] });
  const state = {
    selId: 't1',
    msel: new Set(['t1']),
    data: {
      tasks: { t1, t2 },
      lists: { l1: { id: 'l1', root_tasks: ['t1'] } }
    }
  };

  const calls = { toast: '' };
  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    closeModal: () => {},
    toast: (m) => { calls.toast = m; },
    selectedRootIds: () => ['t1'],
    selectedIds: () => ['t1']
  };

  ctx.moveToTaskDomain(app, state, 't2');

  assert.equal(t1.parent_id, '');
  assert.equal((t2.tasks || []).includes('t1'), false);
  assert.equal(calls.toast.includes('No movable tasks'), true);
});

test('import and clipboard operations record creation source history', () => {
  const ctx = loadContext(
    ['js/core/utils.js', 'js/domain/import-export.js', 'js/domain/clipboard-ops.js'],
    ['mkTask', 'doImportDomain', 'pasteDomain', 'dupDomain'],
    {
      uid: (() => {
        let n = 0;
        return () => `u${++n}`;
      })(),
      now: () => '2026-06-27T00:00:00.000Z',
      navigator: { clipboard: { writeText: () => Promise.resolve() } },
      DOMParser: class {
        parseFromString() {
          return { querySelector: () => null };
        }
      }
    }
  );

  const list = { id: 'l1', root_tasks: [] };
  const base = ctx.mkTask({ id: 'seed', content: 'Seed', checklist_id: 'l1' });
  const state = {
    selId: null,
    listId: 'l1',
    msel: new Set(),
    clipboard: [JSON.parse(JSON.stringify(base))],
    data: {
      tasks: { seed: base },
      lists: { l1: list }
    }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    renderList: () => {},
    closeModal: () => {},
    toast: () => {},
    sibList: () => list.root_tasks
  };

  ctx.doImportDomain(app, state, { fmt: 'json', pos: 'bottom', raw: JSON.stringify([{ content: 'Imported' }]) });
  ctx.pasteDomain(app, state);
  ctx.dupDomain(app, state, 'seed');

  const allTasks = Object.values(state.data.tasks);
  const creationSources = allTasks
    .flatMap(t => (t.history || []).filter(h => h.type === 'creation').map(h => h.changes.source));

  assert.equal(creationSources.includes('import-json'), true);
  assert.equal(creationSources.includes('paste'), true);
  assert.equal(creationSources.includes('duplicate'), true);
});

test('notes operations record notes history', () => {
  const docNodes = {
    'note-in': { value: '' },
    'notes-list': { innerHTML: '' }
  };

  const ctx = loadContext(
    ['js/core/utils.js', 'js/ui/modal-controller.js'],
    ['mkTask', 'addNoteUi', 'deleteNoteUi', 'clearNotesUi'],
    {
      document: {
        getElementById: (id) => docNodes[id] || { value: '', classList: { remove: () => {} } },
        querySelectorAll: () => []
      },
      renderCurrentTagsUi: () => {}
    }
  );

  const task = ctx.mkTask({ id: 't1', content: 'Task', checklist_id: 'l1', notes: [], comments_count: 0 });
  const state = baseState(task);

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {},
    dispatch: () => {}
  };

  ctx.addNoteUi(app, state, true, { taskId: 't1', content: 'first note' });
  const firstNoteId = task.notes[0].id;
  ctx.deleteNoteUi(app, state, 't1', firstNoteId, true);
  ctx.addNoteUi(app, state, true, { taskId: 't1', content: 'second note' });
  ctx.clearNotesUi(app, state, 't1', true);

  const noteEntries = task.history.filter(h => h.type === 'notes');
  assert.equal(noteEntries.some(h => h.changes.action === 'add-note'), true);
  assert.equal(noteEntries.some(h => h.changes.action === 'delete-note'), true);
  assert.equal(noteEntries.some(h => h.changes.action === 'clear-notes'), true);
});
