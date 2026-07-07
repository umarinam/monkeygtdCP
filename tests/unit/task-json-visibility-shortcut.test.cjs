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
  vm.runInContext(`${source}\n;globalThis.__renderExports = { buildTaskItemUi };`, sandbox, { filename: 'render-controller.js' });
  return sandbox.__renderExports;
}

function loadKeyboardController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/keyboard-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: () => ({ classList: { contains: () => true } })
    },
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__keyboardExports = { handleTwoKeySequence, handleGlobalKey };`, sandbox, { filename: 'keyboard-controller.js' });
  return sandbox.__keyboardExports;
}

function makeRenderState(showTaskJsonChip, showTaskHistoryChip) {
  return {
    data: {
      settings: {
        showTaskJsonChip,
        showTaskHistoryChip
      },
      tasks: {
        t1: {
          id: 't1',
          content: 'Task one',
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
          updated_at: '2026-06-01T00:00:00.000Z'
        }
      },
      lists: {
        l1: { id: 'l1', style: 'none', root_tasks: ['t1'] }
      }
    },
    selId: 't1',
    msel: new Set(),
    editId: null,
    filter: '',
    showNotes: false
  };
}

test('buildTaskItemUi shows JSON chip by default and hides when setting is false', () => {
  const { buildTaskItemUi } = loadRenderController();
  const app = { sibIdx: () => 1 };

  const visibleState = makeRenderState(undefined, undefined);
  const hiddenState = makeRenderState(false, false);

  const visibleHtml = buildTaskItemUi(app, visibleState, 't1', 0, visibleState.data.lists.l1);
  const hiddenHtml = buildTaskItemUi(app, hiddenState, 't1', 0, hiddenState.data.lists.l1);

  assert.equal(visibleHtml.includes('data-a="json"'), true);
  assert.equal(visibleHtml.includes('data-a="hist"'), true);
  assert.equal(hiddenHtml.includes('data-a="json"'), false);
  assert.equal(hiddenHtml.includes('data-a="hist"'), false);
});

test('buildTaskItemUi resolves cross-list wiki links to internal task permalinks', () => {
  const { buildTaskItemUi } = loadRenderController();
  const app = { sibIdx: () => 1 };

  const state = {
    data: {
      settings: { showTaskJsonChip: true, showTaskHistoryChip: true },
      tasks: {
        t1: {
          id: 't1',
          content: 'See [[Remote Task]] and [[Work::Cross Item]]',
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
          updated_at: '2026-06-01T00:00:00.000Z'
        },
        t2: {
          id: 't2',
          content: 'Remote Task',
          status: 0,
          color: 0,
          tasks: [],
          tags_as_text: '',
          assignees: [],
          comments_count: 0,
          due: '',
          due_asap: false,
          repeating_due: null,
          checklist_id: 'l2',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z'
        },
        t3: {
          id: 't3',
          content: 'Cross Item',
          status: 0,
          color: 0,
          tasks: [],
          tags_as_text: '',
          assignees: [],
          comments_count: 0,
          due: '',
          due_asap: false,
          repeating_due: null,
          checklist_id: 'l2',
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z'
        }
      },
      lists: {
        l1: { id: 'l1', name: 'Inbox', style: 'none', root_tasks: ['t1'] },
        l2: { id: 'l2', name: 'Work', style: 'none', root_tasks: ['t2', 't3'] }
      }
    },
    selId: 't1',
    msel: new Set(),
    editId: null,
    filter: '',
    showNotes: false
  };

  state.data.tasks.t1.checklist_id = 'l1';

  const html = buildTaskItemUi(app, state, 't1', 0, state.data.lists.l1);

  assert.equal(html.includes('[Remote Task](#task-t2)'), true);
  assert.equal(html.includes('[Work::Cross Item](#task-t3)'), true);
});

test('bindTaskListEvents navigates to internal task links in rendered content', () => {
  const sourcePath = path.join(process.cwd(), 'js/ui/render-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const taskListEl = {
    onclick: null,
    addEventListener: () => {}
  };

  const sandbox = {
    console,
    md: (s) => s,
    esc: (s) => String(s),
    getDueCls: () => '',
    fmtDue: () => '',
    document: {
      getElementById: () => taskListEl,
      querySelectorAll: () => []
    },
    requestAnimationFrame: (fn) => fn()
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__renderExports = { bindTaskListEvents };`, sandbox, { filename: 'render-controller.js' });
  const { bindTaskListEvents } = sandbox.__renderExports;

  const calls = { jumpTo: '' };
  const app = {
    jumpTo: (id) => { calls.jumpTo = id; },
    toggleCollapse: () => {},
    toggleStatus: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    filterTag: () => {},
    openNotesModal: () => {},
    openTaskJson: () => {},
    openTaskHistory: () => {},
    startEdit: () => {},
    renderList: () => {},
    syncSB: () => {},
    pushUndo: () => {},
    snap: () => ({}),
    moveBefore: () => {}
  };

  const state = {
    lastClickId: '',
    lastClickAt: 0,
    selId: null,
    msel: new Set()
  };

  bindTaskListEvents(app, state);

  let prevented = false;
  taskListEl.onclick({
    target: {
      closest: (sel) => {
        if (sel === 'a[href^="#task-"]') {
          return { getAttribute: () => '#task-target123' };
        }
        if (sel === '.ti') return { dataset: { id: 't1' } };
        return null;
      }
    },
    preventDefault: () => { prevented = true; },
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false
  });

  assert.equal(prevented, true);
  assert.equal(calls.jumpTo, 'target123');
});

test('handleTwoKeySequence opens task JSON editor with tj shortcut', () => {
  const { handleTwoKeySequence } = loadKeyboardController();
  const calls = { openTaskJson: 0 };

  const app = {
    openTaskJson: () => { calls.openTaskJson += 1; },
    showKH: () => {},
    clearKH: () => {},
    startEdit: () => {},
    openDueModal: () => {},
    dispatch: () => {},
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    showPage: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    undo: () => {},
    renderList: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {}
  };

  const state = {
    selId: 't1',
    kbuf: '',
    kbtimer: null,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '' }
      }
    },
    showNotes: false,
    msel: new Set(),
    lastCdAt: 0
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {},
    key: 't'
  };

  handleTwoKeySequence(app, state, e);
  e.key = 'j';
  handleTwoKeySequence(app, state, e);

  assert.equal(calls.openTaskJson, 1);
});

test('handleTwoKeySequence triggers addWebLink with nw shortcut', () => {
  const { handleTwoKeySequence } = loadKeyboardController();
  const calls = { addWebLink: 0 };

  const app = {
    addWebLink: () => { calls.addWebLink += 1; },
    openTaskJson: () => {},
    showKH: () => {},
    clearKH: () => {},
    startEdit: () => {},
    openDueModal: () => {},
    dispatch: () => {},
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    showPage: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    undo: () => {},
    renderList: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {}
  };

  const state = {
    selId: 't1',
    kbuf: '',
    kbtimer: null,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '' }
      }
    },
    showNotes: false,
    msel: new Set(),
    lastCdAt: 0
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {},
    key: 'n'
  };

  handleTwoKeySequence(app, state, e);
  e.key = 'w';
  handleTwoKeySequence(app, state, e);

  assert.equal(calls.addWebLink, 1);
});

test('handleGlobalKey prioritizes pending tj sequence over j navigation', () => {
  const { handleTwoKeySequence, handleGlobalKey } = loadKeyboardController();
  const calls = { openTaskJson: 0, navDown: 0 };

  const app = {
    openTaskJson: () => { calls.openTaskJson += 1; },
    navDown: () => { calls.navDown += 1; },
    showKH: () => {},
    clearKH: () => {},
    startEdit: () => {},
    openDueModal: () => {},
    dispatch: () => {},
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    showPage: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    undo: () => {},
    renderList: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {}
  };

  const state = {
    selId: 't1',
    kbuf: 't',
    kbtimer: null,
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    },
    showNotes: false,
    msel: new Set(),
    lastCdAt: 0,
    cpItems: [],
    cpIdx: 0
  };

  app.twoKey = (e) => handleTwoKeySequence(app, state, e);

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'j',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);

  assert.equal(calls.openTaskJson, 1);
  assert.equal(calls.navDown, 0);
});

test('handleGlobalKey triggers labeled web link flow on Ctrl+K', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { addLabeledWebLink: 0 };

  const app = {
    addLabeledWebLink: () => { calls.addLabeledWebLink += 1; },
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    unindent: () => {},
    indent: () => {},
    invalidate: () => {},
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  let prevented = false;
  const e = {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'k',
    preventDefault: () => { prevented = true; }
  };

  handleGlobalKey(app, state, e);

  assert.equal(prevented, true);
  assert.equal(calls.addLabeledWebLink, 1);
});

test('handleGlobalKey triggers redo on Ctrl+Y', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { redo: 0 };

  const app = {
    redo: () => { calls.redo += 1; },
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    unindent: () => {},
    indent: () => {},
    invalidate: () => {},
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  let prevented = false;
  const e = {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'y',
    preventDefault: () => { prevented = true; }
  };

  handleGlobalKey(app, state, e);

  assert.equal(prevented, true);
  assert.equal(calls.redo, 1);
});

test('handleGlobalKey triggers redo on Ctrl+Shift+Z', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { redo: 0 };

  const app = {
    redo: () => { calls.redo += 1; },
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    unindent: () => {},
    indent: () => {},
    invalidate: () => {},
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  let prevented = false;
  const e = {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: true,
    key: 'z',
    preventDefault: () => { prevented = true; }
  };

  handleGlobalKey(app, state, e);

  assert.equal(prevented, true);
  assert.equal(calls.redo, 1);
});

test('handleGlobalKey routes Delete to deleteSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { deleteSelection: 0 };

  const app = {
    deleteSelection: () => { calls.deleteSelection += 1; },
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    unindent: () => {},
    indent: () => {},
    invalidateSelection: () => {},
    toggleStatusSelection: () => {},
    invalidate: () => {},
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'Delete',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);

  assert.equal(calls.deleteSelection, 1);
});

test('handleGlobalKey routes Space to toggleStatusSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { toggleStatusSelection: 0 };

  const app = {
    toggleStatusSelection: () => { calls.toggleStatusSelection += 1; },
    deleteSelection: () => {},
    invalidateSelection: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    unindent: () => {},
    indent: () => {},
    invalidate: () => {},
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: ' ',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);

  assert.equal(calls.toggleStatusSelection, 1);
});

test('handleTwoKeySequence routes td to setDueQuickSelection for multi-select', () => {
  const { handleTwoKeySequence } = loadKeyboardController();
  const calls = { setDueQuickSelection: [] };

  const app = {
    setDueQuickSelection: (preset) => { calls.setDueQuickSelection.push(preset); },
    showKH: () => {},
    clearKH: () => {}
  };

  const state = {
    selId: 't1',
    kbuf: '',
    kbtimer: null,
    msel: new Set(['t1', 't2']),
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '' }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {},
    key: 't'
  };

  handleTwoKeySequence(app, state, e);
  e.key = 'd';
  handleTwoKeySequence(app, state, e);

  assert.deepEqual(calls.setDueQuickSelection, ['today']);
});

test('handleTwoKeySequence routes ca to clearAssigneesSelection for multi-select', () => {
  const { handleTwoKeySequence } = loadKeyboardController();
  const calls = { clearAssigneesSelection: 0 };

  const app = {
    clearAssigneesSelection: () => { calls.clearAssigneesSelection += 1; },
    showKH: () => {},
    clearKH: () => {}
  };

  const state = {
    selId: 't1',
    kbuf: '',
    kbtimer: null,
    msel: new Set(['t1', 't2']),
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '' }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {},
    key: 'c'
  };

  handleTwoKeySequence(app, state, e);
  e.key = 'a';
  handleTwoKeySequence(app, state, e);

  assert.equal(calls.clearAssigneesSelection, 1);
});

test('handleTwoKeySequence st selects first visible task when selId is null', () => {
  const { handleTwoKeySequence } = loadKeyboardController();

  const app = {
    visible: () => ['t1', 't2'],
    renderList: () => {},
    showKH: () => {},
    clearKH: () => {}
  };

  const state = {
    selId: null,
    kbuf: '',
    kbtimer: null,
    msel: new Set(),
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '' },
        t2: { due: '', due_asap: false, repeating_due: null, content: '' }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: () => {},
    key: 's'
  };

  handleTwoKeySequence(app, state, e);
  e.key = 't';
  handleTwoKeySequence(app, state, e);

  assert.equal(state.selId, 't1');
  assert.equal(state.msel.has('t1'), true);
});

test('handleGlobalKey routes Ctrl+ArrowUp to moveUpSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { moveUpSelection: 0 };

  const app = {
    moveUpSelection: () => { calls.moveUpSelection += 1; },
    moveDownSelection: () => {},
    indentSelection: () => {},
    unindentSelection: () => {},
    toggleStatusSelection: () => {},
    deleteSelection: () => {},
    invalidateSelection: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'ArrowUp',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);
  assert.equal(calls.moveUpSelection, 1);
});

test('handleGlobalKey routes Ctrl+ArrowDown to moveDownSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { moveDownSelection: 0 };

  const app = {
    moveDownSelection: () => { calls.moveDownSelection += 1; },
    moveUpSelection: () => {},
    indentSelection: () => {},
    unindentSelection: () => {},
    toggleStatusSelection: () => {},
    deleteSelection: () => {},
    invalidateSelection: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: true,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'ArrowDown',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);
  assert.equal(calls.moveDownSelection, 1);
});

test('handleGlobalKey routes Tab to indentSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { indentSelection: 0 };

  const app = {
    indentSelection: () => { calls.indentSelection += 1; },
    unindentSelection: () => {},
    moveUpSelection: () => {},
    moveDownSelection: () => {},
    toggleStatusSelection: () => {},
    deleteSelection: () => {},
    invalidateSelection: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    key: 'Tab',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);
  assert.equal(calls.indentSelection, 1);
});

test('handleGlobalKey routes Shift+Tab to unindentSelection for multi-select', () => {
  const { handleGlobalKey } = loadKeyboardController();
  const calls = { unindentSelection: 0 };

  const app = {
    unindentSelection: () => { calls.unindentSelection += 1; },
    indentSelection: () => {},
    moveUpSelection: () => {},
    moveDownSelection: () => {},
    toggleStatusSelection: () => {},
    deleteSelection: () => {},
    invalidateSelection: () => {},
    closeAll: () => {},
    showShortcuts: () => {},
    undo: () => {},
    redo: () => {},
    render: () => {},
    clearSearch: () => {},
    twoKey: () => {},
    navDown: () => {},
    navUp: () => {},
    extDown: () => {},
    extUp: () => {},
    renderList: () => {},
    unHoist: () => {},
    hoistTask: () => {},
    visible: () => ['t1'],
    startEdit: () => {},
    dispatch: () => {},
    addAbove: () => 't2',
    moveUp: () => {},
    moveDown: () => {},
    expandAll: () => {},
    collapseAll: () => {},
    copy: () => {},
    cut: () => {},
    paste: () => {},
    dup: () => {},
    copyWithUrl: () => {},
    openDueModal: () => {},
    openRepeatModal: () => {},
    openTagsModal: () => {},
    openTaskHistory: () => {},
    openTaskJson: () => {},
    showPage: () => {},
    openNotesModal: () => {},
    addOneNoteLink: () => {},
    addEmailLink: () => {},
    addFileLink: () => {},
    addWebLink: () => {},
    addLabeledWebLink: () => {},
    assignTask: () => {},
    toggleDetails: () => {},
    showProgress: () => {},
    setZen: () => {},
    openSettings: () => {},
    openSortDlg: () => {},
    runSmokeChecks: () => {},
    openCP: () => {},
    openMoveDlg: () => {},
    showRestoreDeleted: () => {},
    showWC: () => {},
    extractBranch: () => {},
    wipeCompleted: () => {},
    resetCompleted: () => {},
    toggleEC: () => {},
    openExport: () => {},
    openImport: () => {},
    copyPermalink: () => {},
    showKH: () => {},
    clearKH: () => {},
    save: () => {},
    toast: () => {},
    pushUndo: () => {},
    snap: () => ({})
  };

  const state = {
    selId: 't1',
    page: 'list',
    editId: null,
    filter: '',
    hoistId: null,
    kbuf: '',
    kbtimer: null,
    showNotes: false,
    msel: new Set(['t1', 't2']),
    cpItems: [],
    cpIdx: 0,
    data: {
      settings: {},
      tasks: {
        t1: { due: '', due_asap: false, repeating_due: null, content: '', tasks: [], parent_id: '', color: 0 }
      }
    }
  };

  const e = {
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: true,
    key: 'Tab',
    preventDefault: () => {}
  };

  handleGlobalKey(app, state, e);
  assert.equal(calls.unindentSelection, 1);
});
