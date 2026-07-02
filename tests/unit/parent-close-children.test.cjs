const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadTaskCrud(overrides = {}) {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    ...overrides
  };

  vm.createContext(sandbox);
  for (const rel of ['js/core/utils.js', 'js/domain/task-crud-ops.js']) {
    const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    vm.runInContext(source, sandbox, { filename: rel });
  }

  vm.runInContext('globalThis.__exports = { mkTask, toggleStatusDomain };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

function makeApp() {
  return {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    checkAutoClose: () => {}
  };
}

test('toggleStatusDomain completes descendants when closeChildrenOnParentDone is enabled', () => {
  const ctx = loadTaskCrud({ now: () => '2026-07-02T00:00:00.000Z' });

  const parent = ctx.mkTask({ id: 'p1', content: 'Parent', checklist_id: 'l1', status: 0, tasks: ['c1', 'c2'] });
  const childOpen = ctx.mkTask({ id: 'c1', content: 'Open child', checklist_id: 'l1', parent_id: 'p1', status: 0, tasks: [] });
  const childInvalid = ctx.mkTask({ id: 'c2', content: 'Invalid child', checklist_id: 'l1', parent_id: 'p1', status: 2, tasks: ['g1'] });
  const grandChild = ctx.mkTask({ id: 'g1', content: 'Grandchild', checklist_id: 'l1', parent_id: 'c2', status: 0, tasks: [] });

  const state = {
    selId: 'p1',
    listId: 'l1',
    msel: new Set(),
    data: {
      settings: { autoCloseParent: false, closeChildrenOnParentDone: true },
      tasks: { p1: parent, c1: childOpen, c2: childInvalid, g1: grandChild },
      lists: { l1: { id: 'l1', root_tasks: ['p1'], style: 'none' } }
    }
  };

  ctx.toggleStatusDomain(makeApp(), state, 'p1');

  assert.equal(parent.status, 1);
  assert.equal(childOpen.status, 1);
  assert.equal(childInvalid.status, 1);
  assert.equal(grandChild.status, 1);
  assert.equal(childOpen.history.some(h => h.type === 'status' && h.changes.source === 'parent-close'), true);
  assert.equal(childInvalid.history.some(h => h.type === 'status' && h.changes.source === 'parent-close'), true);
  assert.equal(grandChild.history.some(h => h.type === 'status' && h.changes.source === 'parent-close'), true);
});

test('toggleStatusDomain does not change descendants when closeChildrenOnParentDone is disabled', () => {
  const ctx = loadTaskCrud({ now: () => '2026-07-02T00:00:00.000Z' });

  const parent = ctx.mkTask({ id: 'p1', content: 'Parent', checklist_id: 'l1', status: 0, tasks: ['c1'] });
  const childOpen = ctx.mkTask({ id: 'c1', content: 'Open child', checklist_id: 'l1', parent_id: 'p1', status: 0, tasks: [] });

  const state = {
    selId: 'p1',
    listId: 'l1',
    msel: new Set(),
    data: {
      settings: { autoCloseParent: false, closeChildrenOnParentDone: false },
      tasks: { p1: parent, c1: childOpen },
      lists: { l1: { id: 'l1', root_tasks: ['p1'], style: 'none' } }
    }
  };

  ctx.toggleStatusDomain(makeApp(), state, 'p1');

  assert.equal(parent.status, 1);
  assert.equal(childOpen.status, 0);
  assert.equal(childOpen.history.some(h => h.type === 'status' && h.changes.source === 'parent-close'), false);
});
