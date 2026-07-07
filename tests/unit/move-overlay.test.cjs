const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadMoveUi(doc) {
  const sourcePath = path.join(process.cwd(), 'js/ui/modal-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    esc: (s) => String(s),
    document: {
      getElementById: (id) => doc[id],
      querySelectorAll: (sel) => {
        if (sel === '#move-r .mvt') return doc.__rows || [];
        return [];
      }
    },
    setTimeout: (fn) => fn()
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__moveUi = { updateMoveRUi, handleMoveInputKeyUi };`,
    sandbox,
    { filename: 'modal-controller.js' }
  );
  return sandbox.__moveUi;
}

test('updateMoveRUi renders invalid target reasons for selected and descendant tasks', () => {
  const doc = {
    'move-q': { value: 'a' },
    'move-r': { innerHTML: '' }
  };
  const { updateMoveRUi } = loadMoveUi(doc);

  const state = {
    selId: 'a',
    msel: new Set(['a']),
    movePickIdx: 0,
    moveTargets: [],
    data: {
      tasks: {
        a: { id: 'a', content: 'Parent', parent_id: '', checklist_id: 'l1' },
        b: { id: 'b', content: 'Child', parent_id: 'a', checklist_id: 'l1' },
        c: { id: 'c', content: 'Other', parent_id: '', checklist_id: 'l1' }
      },
      lists: {
        l1: { id: 'l1', name: 'Same list' },
        l2: { id: 'l2', name: 'Elsewhere' }
      }
    }
  };

  const app = {
    selectedIds: () => ['a'],
    selectedRootIds: () => ['a'],
    select: () => ({
      lists: [{ id: 'l1', name: 'Same list' }, { id: 'l2', name: 'Elsewhere' }],
      tasks: [
        { id: 'a', content: 'Parent', listName: 'Same list' },
        { id: 'b', content: 'Child', listName: 'Same list' },
        { id: 'c', content: 'Other', listName: 'Same list' }
      ]
    })
  };

  updateMoveRUi(app, state);

  assert.equal(doc['move-r'].innerHTML.includes('Invalid target: contains selected task'), true);
  assert.equal(doc['move-r'].innerHTML.includes('Invalid target: descendant of selection'), true);
  assert.equal(Array.isArray(state.moveTargets), true);
  assert.equal(state.moveTargets.some(t => t.valid), true);
});

test('handleMoveInputKeyUi navigates valid targets and Enter triggers move', () => {
  const doc = {
    'move-q': { value: 'a' },
    'move-r': { innerHTML: '' }
  };
  const { updateMoveRUi, handleMoveInputKeyUi } = loadMoveUi(doc);

  const state = {
    selId: 'a',
    msel: new Set(['a']),
    movePickIdx: 0,
    moveTargets: [],
    data: {
      tasks: {
        a: { id: 'a', content: 'Parent', parent_id: '', checklist_id: 'l1' },
        c: { id: 'c', content: 'Other', parent_id: '', checklist_id: 'l1' }
      },
      lists: {
        l1: { id: 'l1', name: 'Same list' },
        l2: { id: 'l2', name: 'Elsewhere' }
      }
    }
  };

  const calls = { list: '', task: '' };
  const app = {
    selectedIds: () => ['a'],
    selectedRootIds: () => ['a'],
    select: () => ({
      lists: [{ id: 'l1', name: 'Same list' }, { id: 'l2', name: 'Elsewhere' }],
      tasks: [{ id: 'c', content: 'Other', listName: 'Same list' }]
    }),
    moveToList: (id) => { calls.list = id; },
    moveToTask: (id) => { calls.task = id; }
  };

  updateMoveRUi(app, state);

  const down = {
    key: 'ArrowDown',
    preventDefault: () => {}
  };
  handleMoveInputKeyUi(app, state, down);

  const enter = {
    key: 'Enter',
    preventDefault: () => {}
  };
  handleMoveInputKeyUi(app, state, enter);

  assert.equal(calls.list === 'l2' || calls.task === 'c', true);
});

test('handleMoveInputKeyUi supports Home/End and scrolls highlighted item into view', () => {
  const rowCalls = [0, 0, 0];
  const doc = {
    'move-q': { value: 'a' },
    'move-r': { innerHTML: '' },
    __rows: [
      { scrollIntoView: () => { rowCalls[0] += 1; } },
      { scrollIntoView: () => { rowCalls[1] += 1; } },
      { scrollIntoView: () => { rowCalls[2] += 1; } },
      { scrollIntoView: () => { rowCalls[2] += 1; } },
      { scrollIntoView: () => { rowCalls[2] += 1; } },
      { scrollIntoView: () => { rowCalls[2] += 1; } }
    ]
  };
  const { updateMoveRUi, handleMoveInputKeyUi } = loadMoveUi(doc);

  const state = {
    selId: 'a',
    msel: new Set(['a']),
    movePickIdx: 0,
    moveTargets: [],
    data: {
      tasks: {
        a: { id: 'a', content: 'Parent', parent_id: '', checklist_id: 'l1' },
        c: { id: 'c', content: 'Other', parent_id: '', checklist_id: 'l1' },
        d: { id: 'd', content: 'Third', parent_id: '', checklist_id: 'l1' }
      },
      lists: {
        l1: { id: 'l1', name: 'Same list' },
        l2: { id: 'l2', name: 'Elsewhere' },
        l3: { id: 'l3', name: 'Another list' }
      }
    }
  };

  const app = {
    selectedIds: () => ['a'],
    selectedRootIds: () => ['a'],
    select: () => ({
      lists: [{ id: 'l1', name: 'Same list' }, { id: 'l2', name: 'Elsewhere' }, { id: 'l3', name: 'Another list' }],
      tasks: [{ id: 'c', content: 'Other', listName: 'Same list' }, { id: 'd', content: 'Third', listName: 'Same list' }]
    }),
    moveToList: () => {},
    moveToTask: () => {}
  };

  updateMoveRUi(app, state);

  const endEvt = { key: 'End', preventDefault: () => {} };
  handleMoveInputKeyUi(app, state, endEvt);
  assert.equal(state.movePickIdx, state.moveTargets.map((t, i) => t.valid ? i : -1).filter(i => i >= 0).slice(-1)[0]);
  assert.equal(rowCalls.some(n => n > 0), true);

  const homeEvt = { key: 'Home', preventDefault: () => {} };
  handleMoveInputKeyUi(app, state, homeEvt);
  assert.equal(state.movePickIdx, state.moveTargets.map((t, i) => t.valid ? i : -1).filter(i => i >= 0)[0]);
});
