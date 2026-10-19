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

// A tiny DOM: every element exists, overlays start hidden.
function fakeDocument() {
  const nodes = {};
  const node = id => {
    if (!nodes[id]) {
      const classes = new Set(id.startsWith('ov-') ? ['hidden'] : []);
      nodes[id] = {
        id, value: '', checked: false, innerHTML: '', textContent: '', placeholder: '', style: {},
        classList: {
          add: c => classes.add(c),
          remove: c => classes.delete(c),
          toggle: (c, on) => (on === undefined ? (classes.has(c) ? classes.delete(c) : classes.add(c)) : on ? classes.add(c) : classes.delete(c)),
          contains: c => classes.has(c)
        },
        focus() {}
      };
    }
    return nodes[id];
  };
  return { node, document: { activeElement: null, getElementById: node, querySelectorAll: () => [] } };
}

const DOMAIN = ['js/core/utils.js', 'js/domain/bookmark-ops.js'];
const DOMAIN_EXPORTS = [
  'mkTask', 'bookmarkListDomain', 'saveBookmarkDomain', 'removeBookmarksDomain', 'bookmarkTargetDomain',
  'bookmarkNameDomain', 'bookmarkByShortcutDomain', 'bookmarksForTaskDomain'
];

function makeState(ctx) {
  const task = o => ctx.mkTask({ checklist_id: 'l1', ...o });
  return {
    page: 'list',
    listId: 'l1',
    selId: null,
    hoistId: null,
    filter: '',
    msel: new Set(),
    data: {
      settings: {},
      lists: {
        l1: { id: 'l1', name: 'Work', root_tasks: ['p', 'leaf'] },
        l2: { id: 'l2', name: 'Home', root_tasks: ['h'] }
      },
      tasks: {
        p: task({ id: 'p', content: 'Launch [plan](https://example.com/plan)\nsecond line', tasks: ['c'] }),
        c: task({ id: 'c', content: 'Child', parent_id: 'p' }),
        leaf: task({ id: 'leaf', content: 'Leaf task' }),
        h: task({ id: 'h', checklist_id: 'l2', content: 'Groceries' })
      }
    }
  };
}

function makeApp(state, extra = {}) {
  const calls = [];
  const toasts = [];
  const app = {
    calls,
    toasts,
    save: () => calls.push(['save']),
    render: () => {},
    renderList: () => {},
    syncSB: () => {},
    toast: msg => toasts.push(msg),
    openModal: id => calls.push(['openModal', id]),
    closeModal: id => calls.push(['closeModal', id]),
    openCP: mode => calls.push(['openCP', mode]),
    closeCP: () => calls.push(['closeCP']),
    openList: id => { calls.push(['openList', id]); state.listId = id; state.selId = null; state.hoistId = null; state.filter = ''; },
    jumpTo: id => { calls.push(['jumpTo', id]); state.selId = id; },
    moveToTask: id => calls.push(['moveToTask', id]),
    moveToList: id => calls.push(['moveToList', id]),
    selectedIds: () => (state.msel.size ? [...state.msel] : state.selId ? [state.selId] : []),
    ...extra
  };
  app.dispatch = (name, payload) => {
    calls.push(['dispatch', name]);
    if (name === 'bookmark.save') return app.ctx.saveBookmarkDomain(app, state, payload);
    if (name === 'bookmark.remove') return app.ctx.removeBookmarksDomain(app, state, payload.ids);
    throw new Error(`unexpected command ${name}`);
  };
  return app;
}

function loadUi() {
  const { node, document } = fakeDocument();
  const ctx = loadScripts(
    [...DOMAIN, 'js/ui/search-controller.js', 'js/ui/bookmark-controller.js'],
    [...DOMAIN_EXPORTS, 'openBookmarkUi', 'openBookmarkByShortcutUi', 'moveToBookmarkUi', 'removeBookmarksHereUi',
      'openBookmarkDialogUi', 'saveBookmarkDialogUi', 'removeBookmarkDialogUi', 'refreshBookmarkDialogUi',
      'openBookmarkPickerUi', 'buildBookmarkPaletteItems', 'bookmarkPaletteDigitUi'],
    { document }
  );
  const state = makeState(ctx);
  const app = makeApp(state, {
    openModal: id => { app.calls.push(['openModal', id]); node(id).classList.remove('hidden'); },
    closeModal: id => { app.calls.push(['closeModal', id]); node(id).classList.add('hidden'); }
  });
  app.ctx = ctx;
  return { ctx, state, app, node };
}

// ---------------------------------------------------------------- domain

test('a task bookmark is named after its task until given a name of its own', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);

  const { bookmark, error } = ctx.saveBookmarkDomain(app, state, { taskId: 'p', name: '  ', shortcut: 'b1' });
  assert.equal(error, '');
  assert.equal(bookmark.listId, 'l1');
  assert.equal(bookmark.taskId, 'p');
  assert.equal(bookmark.name, '');
  assert.equal(ctx.bookmarkNameDomain(state, bookmark), 'Launch plan');

  state.data.tasks.p.content = 'Renamed launch';
  assert.equal(ctx.bookmarkNameDomain(state, bookmark), 'Renamed launch');

  ctx.saveBookmarkDomain(app, state, { taskId: 'p', name: 'Launch' });
  assert.equal(ctx.bookmarkNameDomain(state, bookmark), 'Launch');
  assert.equal(ctx.bookmarkListDomain(state).length, 1, 'saving again for the same task edits its bookmark');
  assert.deepEqual(app.calls.filter(c => c[0] === 'save').length, 2);
});

test('a list bookmark is named after its list and is kept apart from the same list with a filter', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);

  const plain = ctx.saveBookmarkDomain(app, state, { listId: 'l1' }).bookmark;
  const filtered = ctx.saveBookmarkDomain(app, state, { listId: 'l1', filter: '#urgent' }).bookmark;
  ctx.saveBookmarkDomain(app, state, { listId: 'l1', filter: '#urgent', name: 'Urgent work' });

  assert.notEqual(plain.id, filtered.id);
  assert.equal(ctx.bookmarkListDomain(state).length, 2);
  assert.equal(ctx.bookmarkNameDomain(state, plain), 'Work');
  assert.equal(ctx.bookmarkNameDomain(state, filtered), 'Urgent work');
  assert.equal(filtered.taskId, '');
});

test('a shortcut moves to the bookmark that claims it last', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);

  const first = ctx.saveBookmarkDomain(app, state, { taskId: 'p', shortcut: 'b1' }).bookmark;
  const second = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf', shortcut: 'b1' }).bookmark;

  assert.equal(first.shortcut, '');
  assert.equal(second.shortcut, 'b1');
  assert.equal(ctx.bookmarkByShortcutDomain(state, 'b1').id, second.id);
  assert.equal(ctx.bookmarkByShortcutDomain(state, 'b2'), null);
});

test('saving rejects a deleted task or a missing list, and drops an unknown shortcut', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);
  state.data.tasks.leaf.deleted = true;

  assert.match(ctx.saveBookmarkDomain(app, state, { taskId: 'leaf' }).error, /no longer exists/);
  assert.match(ctx.saveBookmarkDomain(app, state, { taskId: 'nope' }).error, /no longer exists/);
  assert.match(ctx.saveBookmarkDomain(app, state, { listId: 'gone' }).error, /no longer exists/);
  assert.equal(ctx.bookmarkListDomain(state).length, 0);
  assert.equal(app.calls.some(c => c[0] === 'save'), false);

  assert.equal(ctx.saveBookmarkDomain(app, state, { taskId: 'p', shortcut: 'b12' }).bookmark.shortcut, '');
});

test('the target follows a moved task, and reports a deleted task or list', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);
  const b = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf' }).bookmark;

  state.data.tasks.leaf.checklist_id = 'l2';
  let target = ctx.bookmarkTargetDomain(state, b);
  assert.equal(target.listId, 'l2');
  assert.equal(target.task.id, 'leaf');

  state.data.tasks.leaf.deleted = true;
  target = ctx.bookmarkTargetDomain(state, b);
  assert.equal(target.task, null);
  assert.equal(target.taskMissing, true);
  assert.equal(target.listId, 'l1', 'falls back to the list it was saved in');
  assert.equal(ctx.bookmarkNameDomain(state, b), 'Leaf task', 'keeps a readable name');

  delete state.data.lists.l1;
  assert.equal(ctx.bookmarkTargetDomain(state, b).listMissing, true);
});

test('removeBookmarksDomain removes by id and saves only when something changed', () => {
  const ctx = loadScripts(DOMAIN, DOMAIN_EXPORTS);
  const state = makeState(ctx);
  const app = makeApp(state);
  const a = ctx.saveBookmarkDomain(app, state, { taskId: 'p' }).bookmark;
  const b = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf' }).bookmark;
  const saves = () => app.calls.filter(c => c[0] === 'save').length;

  assert.deepEqual(Array.from(ctx.bookmarksForTaskDomain(state, 'p'), x => x.id), [a.id]);
  assert.equal(ctx.removeBookmarksDomain(app, state, [a.id, 'missing']), 1);
  assert.equal(saves(), 3);
  assert.equal(ctx.removeBookmarksDomain(app, state, ['missing']), 0);
  assert.equal(saves(), 3);
  assert.deepEqual(Array.from(ctx.bookmarkListDomain(state), x => x.id), [b.id]);
});

// ---------------------------------------------------------------- opening and moving

test('opening a bookmark hoists a task with sub-tasks and applies its filter', () => {
  const { ctx, state, app, node } = loadUi();
  const b = ctx.saveBookmarkDomain(app, state, { taskId: 'p', filter: '#urgent' }).bookmark;
  state.listId = 'l2';

  ctx.openBookmarkUi(app, state, b.id);

  assert.deepEqual(app.calls.filter(c => c[0] === 'openList' || c[0] === 'jumpTo'), [['openList', 'l1'], ['jumpTo', 'p']]);
  assert.equal(state.hoistId, 'p');
  assert.equal(state.selId, 'p');
  assert.equal(state.filter, '#urgent');
  assert.equal(node('search').value, '#urgent');
});

test('opening a bookmark on a leaf selects it without hoisting', () => {
  const { ctx, state, app } = loadUi();
  const b = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf' }).bookmark;

  ctx.openBookmarkUi(app, state, b.id);

  assert.equal(state.hoistId, null);
  assert.equal(state.selId, 'leaf');
  assert.equal(state.filter, '');
});

test('opening a bookmark whose task or list was deleted says so', () => {
  const { ctx, state, app } = loadUi();
  const onTask = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf' }).bookmark;
  const onList = ctx.saveBookmarkDomain(app, state, { listId: 'l2' }).bookmark;
  state.data.tasks.leaf.deleted = true;
  delete state.data.lists.l2;

  ctx.openBookmarkUi(app, state, onTask.id);
  assert.deepEqual(app.calls.filter(c => c[0] === 'openList' || c[0] === 'jumpTo'), [['openList', 'l1']]);
  assert.match(app.toasts.at(-1), /task was deleted/);

  ctx.openBookmarkUi(app, state, onList.id);
  assert.equal(app.calls.filter(c => c[0] === 'openList').length, 1);
  assert.match(app.toasts.at(-1), /its list was deleted/);
});

test('b and a digit open that bookmark, or offer to set it from a list', () => {
  const { ctx, state, app, node } = loadUi();
  const b = ctx.saveBookmarkDomain(app, state, { taskId: 'leaf', shortcut: 'b3' }).bookmark;

  ctx.openBookmarkByShortcutUi(app, state, '3');
  assert.equal(state.selId, b.taskId);

  state.selId = null;
  ctx.openBookmarkByShortcutUi(app, state, '5');
  assert.equal(node('ov-bookmark').classList.contains('hidden'), false, 'opens the bookmark dialog');
  assert.equal(node('bm-shortcut').value, 'b5');

  state.page = 'home';
  ctx.openBookmarkByShortcutUi(app, state, '6');
  assert.match(app.toasts.at(-1), /No bookmark on b6/);
});

test('moving to a bookmark moves the selection under its task, or to its list', () => {
  const { ctx, state, app } = loadUi();
  const onTask = ctx.saveBookmarkDomain(app, state, { taskId: 'p' }).bookmark;
  const onList = ctx.saveBookmarkDomain(app, state, { listId: 'l2' }).bookmark;
  const gone = ctx.saveBookmarkDomain(app, state, { taskId: 'h' }).bookmark;
  state.data.tasks.h.deleted = true;
  state.selId = 'leaf';

  ctx.moveToBookmarkUi(app, state, onTask.id);
  ctx.moveToBookmarkUi(app, state, onList.id);
  ctx.moveToBookmarkUi(app, state, gone.id);

  assert.deepEqual(app.calls.filter(c => c[0].startsWith('moveTo')), [['moveToTask', 'p'], ['moveToList', 'l2']]);
  assert.match(app.toasts.at(-1), /deleted task/);

  state.selId = null;
  ctx.moveToBookmarkUi(app, state, onList.id);
  assert.equal(app.calls.filter(c => c[0].startsWith('moveTo')).length, 2);
  assert.match(app.toasts.at(-1), /Select/);
});

test('cb removes the selected tasks\' bookmarks, or the list\'s when nothing is selected', () => {
  const { ctx, state, app } = loadUi();
  ctx.saveBookmarkDomain(app, state, { taskId: 'p' });
  ctx.saveBookmarkDomain(app, state, { listId: 'l1' });

  state.selId = 'leaf';
  ctx.removeBookmarksHereUi(app, state);
  assert.equal(ctx.bookmarkListDomain(state).length, 2);
  assert.match(app.toasts.at(-1), /No bookmark on the selected task/);

  state.selId = 'p';
  ctx.removeBookmarksHereUi(app, state);
  assert.deepEqual(Array.from(ctx.bookmarkListDomain(state), b => b.taskId), ['']);

  state.selId = null;
  ctx.removeBookmarksHereUi(app, state);
  assert.equal(ctx.bookmarkListDomain(state).length, 0);
  assert.match(app.toasts.at(-1), /Removed 1 bookmark/);
});

// ---------------------------------------------------------------- dialog and picker

test('the bookmark dialog adds, edits and removes a task bookmark', () => {
  const { ctx, state, app, node } = loadUi();
  state.selId = 'leaf';
  state.filter = '#urgent';

  ctx.openBookmarkDialogUi(app, state);
  assert.equal(node('ov-bookmark').classList.contains('hidden'), false);
  assert.equal(node('bm-title').textContent, 'Add Bookmark');
  assert.equal(node('bm-target').value, 'task');
  assert.equal(node('bm-name').placeholder, 'Leaf task');
  assert.equal(node('bm-filter').checked, false);
  assert.match(node('bm-filter-label').textContent, /#urgent/);
  assert.equal(node('bm-remove').style.display, 'none');

  node('bm-name').value = 'My leaf';
  node('bm-shortcut').value = 'b2';
  node('bm-filter').checked = true;
  ctx.saveBookmarkDialogUi(app, state);
  const [b] = ctx.bookmarkListDomain(state);
  assert.deepEqual([b.taskId, b.name, b.shortcut, b.filter], ['leaf', 'My leaf', 'b2', '#urgent']);
  assert.equal(node('ov-bookmark').classList.contains('hidden'), true);
  assert.match(app.toasts.at(-1), /Bookmarked "My leaf".*b2/);

  state.filter = '';
  ctx.openBookmarkDialogUi(app, state);
  assert.equal(node('bm-title').textContent, 'Edit Bookmark');
  assert.equal(node('bm-name').value, 'My leaf');
  assert.equal(node('bm-shortcut').value, 'b2');
  assert.equal(node('bm-filter').checked, true);
  assert.equal(node('bm-remove').style.display, '');

  ctx.removeBookmarkDialogUi(app, state);
  assert.equal(ctx.bookmarkListDomain(state).length, 0);
});

test('switching the dialog to the whole list bookmarks the list instead', () => {
  const { ctx, state, app, node } = loadUi();
  state.selId = 'leaf';

  ctx.openBookmarkDialogUi(app, state);
  node('bm-target').value = 'list';
  ctx.refreshBookmarkDialogUi(app, state);
  assert.equal(node('bm-name').placeholder, 'Work');
  ctx.saveBookmarkDialogUi(app, state);

  const [b] = ctx.bookmarkListDomain(state);
  assert.deepEqual([b.taskId, b.listId], ['', 'l1']);
});

test('the shortcut menu shows which bookmark holds each digit', () => {
  const { ctx, state, app, node } = loadUi();
  ctx.saveBookmarkDomain(app, state, { listId: 'l2', shortcut: 'b4' });
  state.selId = 'leaf';

  ctx.openBookmarkDialogUi(app, state);
  assert.match(node('bm-shortcut').innerHTML, /<option value="b4">b4 - now &quot;Home&quot;<\/option>/);
  assert.match(node('bm-shortcut').innerHTML, /<option value="">None<\/option>/);
});

test('the bookmark picker lists bookmarks with their digit, and a digit picks one at once', () => {
  const { ctx, state, app, node } = loadUi();
  ctx.saveBookmarkDomain(app, state, { taskId: 'leaf', shortcut: 'b3' });
  ctx.saveBookmarkDomain(app, state, { listId: 'l2', filter: '#shop' });
  state.selId = 'c';

  const items = ctx.buildBookmarkPaletteItems(app, state, 'bookmarks-move');
  assert.deepEqual(Array.from(items, i => [i.l, i.s]), [
    ['★ Leaf task · Work', 'b3'],
    ['★ Home · filter #shop', '']
  ]);

  state.cpMode = 'bookmarks-move';
  node('cpi').value = 'le';
  assert.equal(ctx.bookmarkPaletteDigitUi(app, state, '3'), false, 'typing in the filter is left alone');
  node('cpi').value = '';
  assert.equal(ctx.bookmarkPaletteDigitUi(app, state, '7'), false);
  assert.equal(ctx.bookmarkPaletteDigitUi(app, state, '3'), true);
  assert.deepEqual(app.calls.slice(-2), [['closeCP'], ['moveToTask', 'leaf']]);

  state.cpMode = '';
  assert.equal(ctx.bookmarkPaletteDigitUi(app, state, '3'), false);
});

test('the picker explains when there is nothing to pick', () => {
  const { ctx, state, app } = loadUi();
  ctx.openBookmarkPickerUi(app, state, 'bookmarks');
  assert.match(app.toasts.at(-1), /No bookmarks yet/);

  ctx.saveBookmarkDomain(app, state, { listId: 'l2' });
  ctx.openBookmarkPickerUi(app, state, 'bookmarks-move');
  assert.match(app.toasts.at(-1), /Select/);
  ctx.openBookmarkPickerUi(app, state, 'bookmarks');
  assert.deepEqual(app.calls.at(-1), ['openCP', 'bookmarks']);
});

// ---------------------------------------------------------------- keyboard

function loadKeyboard() {
  const { node, document } = fakeDocument();
  const ctx = loadScripts(['js/core/utils.js', 'js/ui/keyboard-controller.js'], ['handleGlobalKey', 'handleTwoKeySequence', 'mkTask'], { document });
  const calls = [];
  const state = {
    kbuf: '', kbtimer: null, selId: 't1', editId: null, hoistId: null, filter: '', msel: new Set(), page: 'list',
    data: { settings: {}, tasks: { t1: ctx.mkTask({ id: 't1', checklist_id: 'l1' }) }, lists: {} }
  };
  const app = {
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    render: () => {},
    pushUndo: () => calls.push('undo'),
    snap: () => ({}),
    openBookmarkByShortcut: d => calls.push(`b${d}`),
    openBookmarkDlg: () => calls.push('ab'),
    openBookmarkPicker: () => calls.push('bb'),
    openMoveToBookmark: () => calls.push('mb'),
    removeBookmarksHere: () => calls.push('cb')
  };
  app.twoKey = e => ctx.handleTwoKeySequence(app, state, e);
  const press = key => ctx.handleGlobalKey(app, state, { key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, preventDefault: () => {} });
  return { ctx, state, app, calls, press, node };
}

test('b then a digit opens a bookmark instead of setting a colour', () => {
  const { state, calls, press } = loadKeyboard();

  press('b'); press('1');
  assert.deepEqual(calls, ['b1']);
  assert.equal(state.data.tasks.t1.color, 0);

  state.selId = null;
  press('b'); press('0');
  assert.deepEqual(calls, ['b1', 'b0']);

  state.selId = 't1';
  press('3');
  assert.equal(state.data.tasks.t1.color, 3, 'a digit on its own still sets the colour');
});

test('ab, bb, mb and cb reach the bookmark actions; ab, bb and cb work with nothing selected', () => {
  const { state, calls, press } = loadKeyboard();

  for (const seq of ['ab', 'bb', 'mb', 'cb']) for (const k of seq) press(k);
  assert.deepEqual(calls, ['ab', 'bb', 'mb', 'cb']);

  state.selId = null;
  for (const seq of ['ab', 'bb', 'mb', 'cb']) for (const k of seq) press(k);
  assert.deepEqual(calls.slice(4), ['ab', 'bb', 'cb']);
});

test('keys are ignored while the bookmark dialog is open', () => {
  const { calls, press, node, state } = loadKeyboard();
  node('ov-bookmark').classList.remove('hidden');

  press('b'); press('1');
  assert.deepEqual(calls, []);
  assert.equal(state.data.tasks.t1.color, 0);
});

// ---------------------------------------------------------------- wiring and discoverability

test('bookmark scripts are wired into app.html in layer order, with the dialog markup', () => {
  const html = read('app.html');
  const wired = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const at = rel => wired.indexOf(rel);

  assert.ok(at('js/domain/bookmark-ops.js') > at('js/core/utils.js'));
  assert.ok(at('js/domain/bookmark-ops.js') < at('js/application/command-registry.js'));
  assert.ok(at('js/ui/bookmark-controller.js') > at('js/ui/search-controller.js'));
  assert.ok(at('js/ui/bookmark-controller.js') < at('js/app.js'));
  for (const id of ['ov-bookmark', 'bm-title', 'bm-target', 'bm-name', 'bm-shortcut', 'bm-filter', 'bm-filter-label', 'bm-remove']) {
    assert.ok(html.includes(`id="${id}"`), `app.html is missing #${id}`);
  }
});

test('bookmark actions are discoverable in the command palette and shortcuts help', () => {
  const palette = read('js/ui/command-palette-commands.js');
  for (const snippet of [
    "{ l: 'Add/edit bookmark', s: 'ab'",
    "{ l: 'Open bookmark...', s: 'bb / b0-b9'",
    "{ l: 'Move to bookmark...', s: 'mb'",
    "{ l: 'Remove bookmark here', s: 'cb'",
    "{ l: 'Remove a bookmark...'"
  ]) assert.ok(palette.includes(snippet), `Missing command palette entry: ${snippet}`);

  const help = read('js/ui/utilities-controller.js');
  for (const snippet of [
    "['ab', 'Add/edit bookmark']",
    "['bb', 'Open bookmark']",
    "['b0-b9', 'Open the bookmark on that digit']",
    "['mb', 'Move to bookmark']",
    "['cb', 'Remove bookmark here']"
  ]) assert.ok(help.includes(snippet), `Missing shortcuts help entry: ${snippet}`);
});
