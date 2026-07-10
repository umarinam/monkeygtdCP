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
    'globalThis.__exports = { mkTask, getDueCls, pickDateUi, todayS, renderCalUi };',
    sandbox,
    { filename: 'exports.js' }
  );
  return sandbox.__exports;
}

test('overdue task remains overdue until acknowledged or changed', () => {
  const { mkTask, getDueCls } = loadContext();

  const task = mkTask({
    id: 't1',
    checklist_id: 'l1',
    due: '2020-01-01',
    due_asap: false
  });

  assert.equal(getDueCls(task), 'ov');

  task.overdue_ack_due = '2020-01-01';
  assert.equal(getDueCls(task), '');

  task.due = '2020-01-02';
  assert.equal(getDueCls(task), 'ov');
});

test('pickDateUi acknowledges overdue when same overdue date is selected', () => {
  const { mkTask, pickDateUi, getDueCls } = loadContext();

  const task = mkTask({
    id: 't1',
    checklist_id: 'l1',
    due: '2020-01-01',
    due_asap: false
  });

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

  assert.equal(getDueCls(task), 'ov');

  pickDateUi(app, state, '2020-01-01');

  assert.equal(task.due, '2020-01-01');
  assert.equal(task.overdue_ack_due, '2020-01-01');
  assert.equal(getDueCls(task), '');
});

test('renderCalUi starts week on Monday with Monday-based alignment', () => {
  const calWidget = { innerHTML: '' };
  const { renderCalUi } = loadContext({
    document: {
      getElementById: () => calWidget
    }
  });

  const state = {
    selId: 't1',
    calDate: new Date('2025-06-01T00:00:00'),
    data: { tasks: { t1: { due: '' } } }
  };

  renderCalUi({}, state);

  assert.equal(
    calWidget.innerHTML.includes('<div class="cdh">Mo</div><div class="cdh">Tu</div><div class="cdh">We</div><div class="cdh">Th</div><div class="cdh">Fr</div><div class="cdh">Sa</div><div class="cdh">Su</div>'),
    true
  );

  const dayOneIndex = calWidget.innerHTML.indexOf(">1</div>");
  const beforeDayOne = calWidget.innerHTML.slice(0, dayOneIndex);
  const blanks = (beforeDayOne.match(/<div class="cd"><\/div>/g) || []).length;
  assert.equal(blanks, 6);
});
