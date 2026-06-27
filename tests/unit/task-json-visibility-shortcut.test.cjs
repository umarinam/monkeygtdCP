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
