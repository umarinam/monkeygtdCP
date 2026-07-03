const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext(overrides = {}) {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    ...overrides
  };

  vm.createContext(sandbox);
  const utilsSource = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/modal-controller.js'), 'utf8');
  vm.runInContext(utilsSource, sandbox, { filename: 'utils.js' });
  vm.runInContext(modalSource, sandbox, { filename: 'modal-controller.js' });
  vm.runInContext(
    'globalThis.__exports = { mkTask, openRepeatModalUi, saveRepeatSettingsUi, todayS };',
    sandbox,
    { filename: 'exports.js' }
  );
  return sandbox.__exports;
}

function makeDom() {
  const nodes = {
    'rep-freq': { value: 'weekly' },
    'rep-int': { value: '1' },
    'rep-from': { value: 'due' },
    'rep-start': { value: '' },
    'rep-paused': { checked: false }
  };

  const weekdays = [];
  for (let day = 0; day <= 6; day++) {
    weekdays.push({ value: String(day), checked: false });
  }

  return {
    nodes,
    document: {
      getElementById(id) {
        return nodes[id] || null;
      },
      querySelectorAll(selector) {
        if (selector === '.rep-wd') return weekdays;
        if (selector === '.rep-wd:checked') return weekdays.filter(w => w.checked);
        return [];
      },
      querySelector(selector) {
        const match = selector.match(/^\.rep-wd\[value="(\d+)"\]$/);
        if (!match) return null;
        return weekdays.find(w => w.value === match[1]) || null;
      }
    },
    weekdays
  };
}

test('openRepeatModalUi defaults start date to today when task has no due date', () => {
  const dom = makeDom();
  const { mkTask, openRepeatModalUi, todayS } = loadContext({ document: dom.document });

  const task = mkTask({ id: 't1', checklist_id: 'l1', due: '', repeating_due: null });
  const state = {
    selId: 't1',
    data: { tasks: { t1: task } }
  };

  const app = { openModal: () => {} };
  openRepeatModalUi(app, state);

  assert.equal(dom.nodes['rep-start'].value, todayS());
});

test('saveRepeatSettingsUi stores input start date and sets due to that date', () => {
  const dom = makeDom();
  dom.nodes['rep-start'].value = '2026-07-03';

  const { mkTask, saveRepeatSettingsUi } = loadContext({ document: dom.document });
  const task = mkTask({ id: 't1', checklist_id: 'l1', due: '', due_asap: true, repeating_due: null, history: [] });

  const state = {
    selId: 't1',
    data: { tasks: { t1: task } }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    closeModal: () => {},
    render: () => {},
    toast: () => {}
  };

  saveRepeatSettingsUi(app, state);

  assert.equal(task.repeating_due.startDate, '2026-07-03');
  assert.equal(task.due, '2026-07-03');
  assert.equal(task.due_asap, false);
});
