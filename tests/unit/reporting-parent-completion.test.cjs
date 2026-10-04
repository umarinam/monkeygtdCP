const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadFile(sandbox, file) {
  vm.runInContext(fs.readFileSync(path.join(process.cwd(), file), 'utf8'), sandbox, { filename: file });
}

const sandbox = { console, JSON, Math, Date };
vm.createContext(sandbox);
loadFile(sandbox, 'js/domain/queries.js');
loadFile(sandbox, 'js/domain/weekly-report.js');
vm.runInContext('globalThis.__exports = { registerAppQueries, buildWeeklyReportDomain };', sandbox);
const { registerAppQueries, buildWeeklyReportDomain } = sandbox.__exports;

// Local-noon timestamps; report.rows uses UTC day edges, so keep well inside them.
const iso = (month, day, hour = 12) => new Date(2026, month - 1, day, hour, 0, 0).toISOString();

const task = o => ({
  id: '',
  content: '',
  checklist_id: 'l1',
  parent_id: '',
  tasks: [],
  status: 0,
  deleted: false,
  tags: {},
  assignees: [],
  notes: [],
  history: [],
  repeating_due: null,
  created_at: iso(1, 1),
  updated_at: iso(1, 1),
  completed_at: '',
  ...o
});

function world(taskList) {
  const tasks = {};
  for (const t of taskList) tasks[t.id] = task({ content: t.id, ...t });
  for (const t of Object.values(tasks)) {
    if (t.parent_id && tasks[t.parent_id] && !t.deleted) tasks[t.parent_id].tasks.push(t.id);
  }
  const roots = Object.values(tasks).filter(t => !t.parent_id && !t.deleted).map(t => t.id);
  return { tasks, lists: { l1: { id: 'l1', name: 'Work', created_at: iso(1, 1), root_tasks: roots } }, settings: {}, deletedItems: [] };
}

function rowsFor(data) {
  const handlers = new Map();
  const state = { listId: 'l1', data };
  registerAppQueries({ queryService: { register: (name, fn) => handlers.set(name, fn) } }, {
    state,
    walkTasks: () => {},
    skipChildren: Symbol('skip'),
    todayS: () => '2026-06-14',
    tomorrowS: () => '2026-06-15',
    cmpDate: () => 0,
    esc: s => String(s || '')
  });
  const rows = handlers.get('report.rows')({ start: '2026-06-10', end: '2026-06-14' });
  return Object.fromEntries(rows.map(r => [r.id, r.statusKey]));
}

const doneParent = (id, extra) => ({
  id,
  status: 1,
  completed_at: iso(6, 12),
  history: [{ at: iso(6, 12), type: 'status', changes: { from: 0, to: 1 } }],
  ...extra
});

test('open children and grandchildren of a parent completed in the range are classified completed', () => {
  const byId = rowsFor(world([
    doneParent('Project'),
    { id: 'Milestone', parent_id: 'Project' },
    { id: 'Task A', parent_id: 'Milestone' },
    { id: 'Task B', parent_id: 'Project' }
  ]));

  assert.equal(byId.Project, 'completed');
  assert.equal(byId.Milestone, 'completed');
  assert.equal(byId['Task A'], 'completed');
  assert.equal(byId['Task B'], 'completed');
});

test('a child created in the range under a completed parent is completed, not merely added', () => {
  const byId = rowsFor(world([
    doneParent('Project'),
    { id: 'Fresh', parent_id: 'Project', created_at: iso(6, 11), updated_at: iso(6, 11) }
  ]));

  assert.equal(byId.Fresh, 'completed');
});

test('a parent completed before the range leaves its open children untouched', () => {
  const byId = rowsFor(world([
    { id: 'Old project', status: 1, completed_at: iso(5, 1) },
    { id: 'Open child', parent_id: 'Old project' }
  ]));

  assert.equal(byId['Open child'], 'untouched');
});

test('a child added after the parent was completed is added, not completed', () => {
  const byId = rowsFor(world([
    doneParent('Project'),
    { id: 'Added later', parent_id: 'Project', created_at: iso(6, 13), updated_at: iso(6, 13) }
  ]));

  assert.equal(byId['Added later'], 'added');
});

test('a child reopened after the parent was completed is not completed; one reopened before is', () => {
  const byId = rowsFor(world([
    doneParent('Project'),
    {
      id: 'Reopened after',
      parent_id: 'Project',
      updated_at: iso(6, 13),
      history: [{ at: iso(6, 13), type: 'status', changes: { from: 1, to: 0 } }]
    },
    {
      id: 'Reopened before',
      parent_id: 'Project',
      history: [{ at: iso(6, 11), type: 'status', changes: { from: 1, to: 0 } }]
    }
  ]));

  assert.notEqual(byId['Reopened after'], 'completed');
  assert.equal(byId['Reopened before'], 'completed');
});

test('invalidated children are not turned into completed work', () => {
  const byId = rowsFor(world([
    doneParent('Project'),
    { id: 'Ruled out', parent_id: 'Project', status: 2, completed_at: iso(5, 1) }
  ]));

  assert.equal(byId['Ruled out'], 'untouched');
});

test('a recurring parent that reopens itself does not finish its children', () => {
  const byId = rowsFor(world([
    { id: 'Routine', status: 0, repeating_due: { freq: 'weekly' }, completed_at: iso(6, 12) },
    { id: 'Step', parent_id: 'Routine' }
  ]));

  assert.equal(byId.Routine, 'completed');
  assert.equal(byId.Step, 'untouched');
});

test('the nearest completed ancestor decides, and an own deletion still wins', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Milestone', parent_id: 'Project' },
    { id: 'Leaf', parent_id: 'Milestone' }
  ]);
  data.deletedItems = [{
    taskId: 'Gone',
    deletedAt: iso(6, 13),
    snapshot: { id: 'Gone', content: 'Gone', checklist_id: 'l1', parent_id: 'Project', tasks: [], created_at: iso(1, 1), updated_at: iso(6, 13), completed_at: '', history: [] }
  }];

  const byId = rowsFor(data);

  assert.equal(byId.Leaf, 'completed');
  assert.equal(byId.Gone, 'deleted');
});

test('the Reporting page and the weekly export agree on which tasks are completed', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Milestone', parent_id: 'Project' },
    { id: 'Grandchild', parent_id: 'Milestone' },
    { id: 'Finished earlier', parent_id: 'Project', status: 1, completed_at: iso(6, 11), history: [{ at: iso(6, 11), type: 'status', changes: { from: 0, to: 1 } }] },
    { id: 'Added later', parent_id: 'Project', created_at: iso(6, 13) },
    { id: 'Reopened after', parent_id: 'Project', history: [{ at: iso(6, 13), type: 'status', changes: { from: 1, to: 0 } }] },
    { id: 'Reopened before', parent_id: 'Project', history: [{ at: iso(6, 11), type: 'status', changes: { from: 1, to: 0 } }] },
    { id: 'Ruled out', parent_id: 'Project', status: 2, completed_at: iso(5, 1) },
    { id: 'Old project', status: 1, completed_at: iso(5, 1) },
    { id: 'Old open child', parent_id: 'Old project' },
    { id: 'Routine', repeating_due: { freq: 'weekly' }, completed_at: iso(6, 12) },
    { id: 'Routine step', parent_id: 'Routine' },
    { id: 'Plain open task' }
  ]);

  const fromPage = Object.entries(rowsFor(data)).filter(([, key]) => key === 'completed').map(([id]) => id).sort();

  const report = buildWeeklyReportDomain(data, { start: '2026-06-10', end: '2026-06-14' });
  const fromExport = report.text.split('\n')
    .filter(l => /^\s*- .*\[DONE /.test(l))
    .map(l => l.replace(/^\s*- (\[[^\]]*\] )+/, '').trim())
    .sort();

  assert.deepEqual(fromPage, fromExport);
  assert.equal(fromPage.includes('Grandchild'), true);
  assert.equal(fromPage.includes('Added later'), false);
});
