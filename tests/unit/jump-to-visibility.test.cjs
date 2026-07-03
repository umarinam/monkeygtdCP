const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadJumpToUi() {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    setTimeout: (fn) => {
      fn();
      return 0;
    }
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/ui/utilities-controller.js'), 'utf8');
  vm.runInContext(`${source}; globalThis.__exports = { jumpToUi };`, sandbox, {
    filename: 'utilities-controller.js'
  });
  return sandbox.__exports.jumpToUi;
}

test('jumpToUi expands collapsed ancestors and navigates to target task', () => {
  const jumpToUi = loadJumpToUi();

  const state = {
    listId: 'l0',
    selId: '',
    hoistId: '',
    data: {
      tasks: {
        root: { id: 'root', checklist_id: 'l1', parent_id: '', _collapsed: true },
        p1: { id: 'p1', checklist_id: 'l1', parent_id: 'root', _collapsed: true },
        c1: { id: 'c1', checklist_id: 'l1', parent_id: 'p1', _collapsed: false }
      }
    }
  };

  const calls = { showPage: 0, scrollSel: 0 };
  const app = {
    showPage: (p) => {
      calls.showPage += 1;
      assert.equal(p, 'list');
    },
    scrollSel: () => {
      calls.scrollSel += 1;
    }
  };

  jumpToUi(app, state, 'c1');

  assert.equal(state.listId, 'l1');
  assert.equal(state.selId, 'c1');
  assert.equal(state.data.tasks.root._collapsed, false);
  assert.equal(state.data.tasks.p1._collapsed, false);
  assert.equal(calls.showPage, 1);
  assert.equal(calls.scrollSel, 1);
});

test('jumpToUi clears hoist when target is outside hoisted branch', () => {
  const jumpToUi = loadJumpToUi();

  const state = {
    listId: 'l1',
    selId: '',
    hoistId: 'h1',
    data: {
      tasks: {
        h1: { id: 'h1', checklist_id: 'l1', parent_id: '', _collapsed: false },
        x1: { id: 'x1', checklist_id: 'l1', parent_id: '', _collapsed: false }
      }
    }
  };

  const app = {
    showPage: () => {},
    scrollSel: () => {}
  };

  jumpToUi(app, state, 'x1');
  assert.equal(state.hoistId, null);
});
