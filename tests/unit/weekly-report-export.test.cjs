const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadDomain() {
  const sandbox = { console, JSON, Math, Date };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/weekly-report.js'), 'utf8');
  vm.runInContext(
    `${source}; globalThis.__exports = { buildWeeklyReportDomain, WEEKLY_REPORT_PROMPT };`,
    sandbox,
    { filename: 'weekly-report.js' }
  );
  return sandbox.__exports;
}

const { buildWeeklyReportDomain, WEEKLY_REPORT_PROMPT } = loadDomain();

// Local-time timestamps so the tests do not depend on the machine's timezone.
const iso = (month, day, hour = 12, minute = 0) => new Date(2026, month - 1, day, hour, minute, 0).toISOString();

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
  due: '',
  due_asap: false,
  repeating_due: null,
  created_at: iso(1, 1),
  updated_at: iso(1, 1),
  completed_at: '',
  ...o
});

function world(taskList, lists) {
  const tasks = {};
  for (const t of taskList) tasks[t.id] = task({ content: t.id, ...t });
  for (const t of Object.values(tasks)) {
    if (t.parent_id && tasks[t.parent_id] && !t.deleted) tasks[t.parent_id].tasks.push(t.id);
  }
  const defaultLists = {
    l1: {
      id: 'l1',
      name: 'Work',
      created_at: iso(1, 1),
      root_tasks: Object.values(tasks).filter(t => t.checklist_id === 'l1' && !t.parent_id && !t.deleted).map(t => t.id)
    }
  };
  return { tasks, lists: lists || defaultLists, settings: {} };
}

const run = (data, extra) => buildWeeklyReportDomain(data, {
  start: '2026-06-10',
  end: '2026-06-14',
  generatedOn: '2026-06-14',
  ...extra
});

const lines = result => result.text.split('\n');

test('new tasks are included under their unchanged ancestors, which stay untagged context', () => {
  const data = world([
    { id: 'Project' },
    { id: 'Milestone', parent_id: 'Project' },
    {
      id: 'Research idempotency',
      parent_id: 'Milestone',
      created_at: iso(6, 11),
      history: [{ at: iso(6, 11), type: 'creation', changes: { source: 'manual' } }]
    },
    { id: 'Old untouched sibling', parent_id: 'Milestone' }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('## Work'), true);
  assert.equal(out.includes('- Project'), true);
  assert.equal(out.includes('  - Milestone'), true);
  assert.equal(out.includes('    - [NEW 06-11] Research idempotency'), true);
  assert.equal(result.text.includes('Old untouched sibling'), false);
  assert.equal(result.counts.new, 1);
});

test('a new top-level project is reported as NEW with its new children', () => {
  const data = world([
    { id: 'Platform redesign', created_at: iso(6, 12) },
    { id: 'Draft solution architecture', parent_id: 'Platform redesign', created_at: iso(6, 12) }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('- [NEW 06-12] Platform redesign'), true);
  assert.equal(out.includes('  - [NEW 06-12] Draft solution architecture'), true);
  assert.equal(result.counts.new, 2);
});

test('a task created and completed in the same week is both NEW and DONE (not collapsed to one)', () => {
  const data = world([
    {
      id: 'Quick fix',
      status: 1,
      created_at: iso(6, 11),
      completed_at: iso(6, 12),
      history: [{ at: iso(6, 12), type: 'status', changes: { from: 0, to: 1 } }]
    }
  ]);

  const result = run(data);

  assert.equal(lines(result).includes('- [NEW 06-11] [DONE 06-12] Quick fix'), true);
  assert.equal(result.counts.new, 1);
  assert.equal(result.counts.done, 1);
});

test('a list created in the period is reported even when it has no tasks yet', () => {
  const data = world([], {
    l1: { id: 'l1', name: 'Work', created_at: iso(1, 1), root_tasks: [] },
    l2: { id: 'l2', name: 'Research', created_at: iso(6, 13), root_tasks: [] }
  });

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('## Research [NEW 06-13]'), true);
  assert.equal(out.includes('- (new list, no tasks yet)'), true);
  assert.equal(out.includes('## Work'), false);
  assert.equal(result.counts.newLists, 1);
});

test('tasks created outside the period and blank new tasks are not reported', () => {
  const data = world([
    { id: 'Too early', created_at: iso(6, 9) },
    { id: 'Too late', created_at: iso(6, 15) },
    { id: 'Blank', content: '   ', created_at: iso(6, 11) },
    { id: 'In range', created_at: iso(6, 11) }
  ]);

  const result = run(data);

  assert.equal(result.text.includes('Too early'), false);
  assert.equal(result.text.includes('Too late'), false);
  assert.equal(result.counts.new, 1);
  assert.equal(lines(result).includes('- [NEW 06-11] In range'), true);
});

test('local day boundaries decide whether late-evening work lands in the period', () => {
  const data = world([
    { id: 'Last minute', created_at: iso(6, 14, 23, 30) },
    { id: 'Next day', created_at: iso(6, 15, 0, 0) },
    { id: 'First minute', created_at: iso(6, 10, 0, 0) }
  ]);

  const result = run(data);

  assert.equal(result.text.includes('Last minute'), true);
  assert.equal(result.text.includes('First minute'), true);
  assert.equal(result.text.includes('Next day'), false);
});

test('a task restored from the trash is not reported as NEW', () => {
  const data = world([
    {
      id: 'Restored',
      created_at: iso(3, 1),
      history: [{ at: iso(6, 11), type: 'creation', changes: { source: 'restore' } }]
    }
  ]);

  const result = run(data);

  assert.equal(result.counts.new, 0);
  assert.equal(result.text.includes('Restored'), false);
});

test('imported tasks with an old created_at but a creation entry in the period count as NEW', () => {
  const data = world([
    {
      id: 'Imported',
      created_at: iso(2, 1),
      history: [{ at: iso(6, 11), type: 'creation', changes: { source: 'import' } }]
    }
  ]);

  assert.equal(lines(run(data)).includes('- [NEW 06-11] Imported'), true);
});

test('completed tasks are DONE with their date; invalidated ones are DROPPED', () => {
  const data = world([
    { id: 'Shipped', status: 1, completed_at: iso(6, 12) },
    { id: 'Ruled out', status: 2, completed_at: iso(6, 13) },
    { id: 'Done long ago', status: 1, completed_at: iso(5, 1) }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('- [DONE 06-12] Shipped'), true);
  assert.equal(out.includes('- [DROPPED 06-13] Ruled out'), true);
  assert.equal(result.text.includes('Done long ago'), false);
  assert.equal(result.counts.done, 1);
  assert.equal(result.counts.dropped, 1);
});

test('completing a recurring task counts as DONE even though it reopens immediately', () => {
  const data = world([
    { id: 'Weekly sync notes', status: 0, repeating_due: { freq: 'weekly' }, completed_at: iso(6, 12) }
  ]);

  assert.equal(lines(run(data)).includes('- [DONE 06-12] Weekly sync notes'), true);
});

test('wiped completed tasks (soft-deleted, not in the trash list) still count as DONE', () => {
  const data = world([
    {
      id: 'Wiped this week',
      status: 1,
      deleted: true,
      completed_at: iso(6, 12),
      history: [
        { at: iso(6, 12), type: 'status', changes: { from: 0, to: 1 } },
        { at: iso(6, 13), type: 'deletion', changes: { action: 'wipe-completed' } }
      ]
    },
    {
      id: 'Wiped but finished earlier',
      status: 1,
      deleted: true,
      completed_at: iso(5, 1),
      history: [{ at: iso(6, 13), type: 'deletion', changes: { action: 'wipe-completed' } }]
    }
  ]);

  const result = run(data);

  assert.equal(lines(result).includes('- [DONE 06-12] Wiped this week'), true);
  assert.equal(result.text.includes('Wiped but finished earlier'), false);
});

test('deleted tasks are DROPPED; a deleted branch reports only its root', () => {
  const data = world([
    {
      id: 'Old project',
      deleted: true,
      history: [{ at: iso(6, 12), type: 'deletion', changes: { action: 'soft-delete' } }]
    },
    {
      id: 'Old subtask',
      parent_id: 'Old project',
      deleted: true,
      history: [{ at: iso(6, 12), type: 'deletion', changes: { action: 'soft-delete' } }]
    }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('- [DROPPED 06-12] Old project'), true);
  assert.equal(out.some(l => l.includes('Old subtask') && l.includes('[DROPPED')), false);
  assert.equal(result.counts.dropped, 1);
});

test('a task created and deleted in the same week is treated as a false start and omitted', () => {
  const data = world([
    {
      id: 'Oops',
      deleted: true,
      created_at: iso(6, 11),
      history: [
        { at: iso(6, 11), type: 'creation', changes: { source: 'manual' } },
        { at: iso(6, 12), type: 'deletion', changes: { action: 'soft-delete' } }
      ]
    }
  ]);

  const result = run(data);

  assert.equal(result.text.includes('Oops'), false);
  assert.equal(result.counts.new, 0);
  assert.equal(result.counts.dropped, 0);
});

test('REOPENED is reported for finished tasks opened again, but not for bulk reset-completed', () => {
  const data = world([
    {
      id: 'Reopened',
      history: [{ at: iso(6, 12), type: 'status', changes: { from: 1, to: 0 } }]
    },
    {
      id: 'Bulk reset',
      history: [{ at: iso(6, 12), type: 'status', changes: { from: 1, to: 0, source: 'reset-completed' } }]
    }
  ]);

  const result = run(data);

  assert.equal(lines(result).includes('- [REOPENED 06-12] Reopened'), true);
  assert.equal(result.text.includes('Bulk reset'), false);
  assert.equal(result.counts.reopened, 1);
});

test('title edits and notes tag an older task EDIT; typing a new title for the first time does not', () => {
  const data = world([
    {
      id: 'Renamed task',
      history: [{ at: iso(6, 11), type: 'title', changes: { from: 'Old name', to: 'Renamed task' } }]
    },
    {
      id: 'Task with notes',
      notes: [{ id: 'n1', content: 'Found 3 failures\nall in retry logic', created_at: iso(6, 13), updated_at: iso(6, 13) }]
    },
    {
      id: 'Just typed in',
      history: [{ at: iso(6, 11), type: 'title', changes: { from: '', to: 'Just typed in' } }]
    },
    {
      id: 'Old note only',
      notes: [{ id: 'n2', content: 'ancient', created_at: iso(1, 2), updated_at: iso(1, 2) }]
    },
    {
      id: 'Link added',
      history: [{ at: iso(6, 11), type: 'title', changes: { from: 'a', to: 'b', source: 'web-link' } }]
    }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('- [EDIT 06-11] Renamed task'), true);
  assert.equal(out.includes('- [EDIT 06-13] Task with notes'), true);
  assert.equal(out.includes('  - note (06-13): Found 3 failures all in retry logic'), true);
  assert.equal(result.text.includes('Just typed in'), false);
  assert.equal(result.text.includes('Old note only'), false);
  assert.equal(result.text.includes('Link added'), false);
  assert.equal(result.counts.edited, 2);
});

test('notes added to a DONE task appear beneath it without an extra EDIT tag', () => {
  const data = world([
    {
      id: 'Dry run',
      status: 1,
      completed_at: iso(6, 12),
      notes: [{ id: 'n1', content: 'Passed on staging', created_at: iso(6, 12), updated_at: iso(6, 12) }]
    }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('- [DONE 06-12] Dry run'), true);
  assert.equal(out.includes('  - note (06-12): Passed on staging'), true);
  assert.equal(out.some(l => l.startsWith('- [EDIT')), false);
});

test('task lines carry tags, assignees and due date; internal task links collapse to their label', () => {
  const data = world([
    {
      id: 'Linked',
      content: 'Review [the spec](#task-abc123) now',
      status: 1,
      completed_at: iso(6, 12),
      tags: { design: { isPrivate: false } },
      assignees: ['sam'],
      due: '2026-06-20'
    }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('- [DONE 06-12] Review the spec now #design @sam (due 2026-06-20)'), true);
});

test('tags and assignees already typed into the content are not printed a second time', () => {
  const data = world([
    {
      id: 'typed',
      content: 'Research keys #design, with @sam',
      status: 1,
      completed_at: iso(6, 12),
      tags: { design: { isPrivate: false }, Extra: { isPrivate: false } },
      assignees: ['sam', 'lee']
    }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('- [DONE 06-12] Research keys #design, with @sam #Extra @lee'), true);
});

test('the new-lists count is singular for exactly one list', () => {
  const data = world([], { l2: { id: 'l2', name: 'Research', created_at: iso(6, 13), root_tasks: [] } });

  assert.equal(lines(run(data))[2].endsWith('1 new list'), true);
});

test('scope "current" limits the export to the active list; "all" covers every list', () => {
  const data = world(
    [
      { id: 'Work item', created_at: iso(6, 11) },
      { id: 'Home item', checklist_id: 'l2', created_at: iso(6, 11) }
    ],
    {
      l1: { id: 'l1', name: 'Work', created_at: iso(1, 1), root_tasks: ['Work item'] },
      l2: { id: 'l2', name: 'Home', created_at: iso(1, 1), root_tasks: ['Home item'] }
    }
  );

  const all = run(data, { scope: 'all' });
  const current = run(data, { scope: 'current', currentListId: 'l2' });

  assert.equal(all.text.includes('## Work'), true);
  assert.equal(all.text.includes('## Home'), true);
  assert.equal(current.text.includes('Home item'), true);
  assert.equal(current.text.includes('Work item'), false);
  assert.equal(current.text.includes('Scope: list "Home"'), true);
});

test('upcoming section lists overdue, soon-due and ASAP open tasks with breadcrumbs', () => {
  const data = world([
    { id: 'Project' },
    { id: 'Milestone', parent_id: 'Project' },
    { id: 'Overdue fix', parent_id: 'Milestone', due: '2026-06-01' },
    { id: 'Soon', parent_id: 'Milestone', due: '2026-06-20' },
    { id: 'Far away', due: '2026-07-30' },
    { id: 'Already done', status: 1, due: '2026-06-20', completed_at: iso(5, 1) },
    { id: 'Urgent', due_asap: true }
  ]);

  const result = run(data, { includeUpcoming: true });
  const out = lines(result);

  assert.equal(out.includes('# Upcoming (open tasks overdue or due on or before 2026-06-28)'), true);
  assert.equal(out.includes('- [OVERDUE since 06-01] Work › Project › Milestone › Overdue fix'), true);
  assert.equal(out.includes('- [due 06-20] Work › Project › Milestone › Soon'), true);
  assert.equal(out.includes('- [ASAP] Work › Urgent'), true);
  assert.equal(result.text.includes('Far away'), false);
  assert.equal(result.text.includes('Already done'), false);
  assert.equal(out.indexOf('- [ASAP] Work › Urgent') < out.indexOf('- [OVERDUE since 06-01] Work › Project › Milestone › Overdue fix'), true);
});

test('upcoming section is omitted unless requested', () => {
  const data = world([{ id: 'Soon', due: '2026-06-20' }]);

  assert.equal(run(data).text.includes('# Upcoming'), false);
  assert.equal(run(data, { includeUpcoming: false }).text.includes('# Upcoming'), false);
});

test('includePrompt prepends the AI instructions ahead of the export', () => {
  const data = world([{ id: 'New thing', created_at: iso(6, 11) }]);

  const withPrompt = run(data, { includePrompt: true });
  const without = run(data, { includePrompt: false });

  assert.equal(withPrompt.text.startsWith(WEEKLY_REPORT_PROMPT), true);
  assert.equal(withPrompt.text.includes('--- EXPORT BELOW ---'), true);
  assert.equal(withPrompt.text.includes('# Weekly Activity Export'), true);
  assert.equal(without.text.startsWith('# Weekly Activity Export'), true);
  assert.equal(without.text.includes('HOW TO READ THE EXPORT'), false);
});

test('the AI instructions explain every tag the export can emit', () => {
  for (const tag of ['[DONE', '[NEW', '[EDIT', '[DROPPED', '[REOPENED', 'Upcoming', 'Questions for me', 'EMAIL', 'SPOKEN']) {
    assert.equal(WEEKLY_REPORT_PROMPT.includes(tag), true, `prompt should mention ${tag}`);
  }
});

test('header reports the period, scope, generated date and per-kind counts', () => {
  const data = world([
    { id: 'A', created_at: iso(6, 11) },
    { id: 'B', status: 1, completed_at: iso(6, 12) }
  ]);

  const out = lines(run(data));

  assert.equal(out[0], '# Weekly Activity Export');
  assert.equal(out[1], 'Period: 2026-06-10 to 2026-06-14 (local dates) · Scope: all lists (1) · Generated: 2026-06-14');
  assert.equal(out[2], 'Summary: 1 done · 1 new · 0 edited · 0 dropped · 0 reopened · 0 new lists');
});

test('an empty period says so instead of producing an empty body', () => {
  const result = run(world([{ id: 'Old' }]));

  assert.equal(result.text.includes('No changes recorded in this period.'), true);
  assert.equal(result.error, '');
});

test('invalid or reversed date ranges return an error and no text', () => {
  const data = world([{ id: 'A', created_at: iso(6, 11) }]);

  for (const range of [
    { start: '', end: '2026-06-14' },
    { start: '2026-06-14', end: '2026-06-10' },
    { start: 'yesterday', end: 'today' }
  ]) {
    const result = buildWeeklyReportDomain(data, range);
    assert.equal(result.text, '');
    assert.equal(result.error, 'Pick a valid date range');
  }
});

test('children keep their on-screen sibling order, with unlisted children after them', () => {
  const data = world([
    { id: 'Parent' },
    { id: 'Second', parent_id: 'Parent', created_at: iso(6, 11) },
    { id: 'First', parent_id: 'Parent', created_at: iso(6, 12) }
  ]);
  data.tasks.Parent.tasks = ['First', 'Second'];

  const out = lines(run(data));

  assert.equal(out.indexOf('  - [NEW 06-12] First') < out.indexOf('  - [NEW 06-11] Second'), true);
});

test('very long notes are truncated', () => {
  const data = world([
    { id: 'Chatty', notes: [{ id: 'n', content: 'x'.repeat(900), created_at: iso(6, 11), updated_at: iso(6, 11) }] }
  ]);

  const noteLine = lines(run(data)).find(l => l.includes('note (06-11):'));

  assert.equal(noteLine.length < 450, true);
  assert.equal(noteLine.endsWith('…'), true);
});

// ── Open sub-tasks of a completed parent are reported as completed ──────────────

const doneParent = (id, extra) => ({
  id,
  status: 1,
  completed_at: iso(6, 12),
  history: [{ at: iso(6, 12), type: 'status', changes: { from: 0, to: 1 } }],
  ...extra
});

test('open children and grandchildren of a parent completed in the period are reported DONE with the parent date', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Milestone', parent_id: 'Project' },
    { id: 'Task A', parent_id: 'Milestone' },
    { id: 'Task B', parent_id: 'Project' }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('- [DONE 06-12] Project'), true);
  assert.equal(out.includes('  - [DONE 06-12] Milestone'), true);
  assert.equal(out.includes('    - [DONE 06-12] Task A'), true);
  assert.equal(out.includes('  - [DONE 06-12] Task B'), true);
  assert.equal(result.counts.done, 4);
});

test('a child that was already completed keeps its own completion date', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Finished earlier', parent_id: 'Project', status: 1, completed_at: iso(6, 11) },
    { id: 'Still open', parent_id: 'Project' }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('  - [DONE 06-11] Finished earlier'), true);
  assert.equal(out.includes('  - [DONE 06-12] Still open'), true);
});

test('the nearest completed ancestor supplies the date', () => {
  const data = world([
    doneParent('Project', { completed_at: iso(6, 13), history: [{ at: iso(6, 13), type: 'status', changes: { from: 0, to: 1 } }] }),
    doneParent('Milestone', { parent_id: 'Project' }),
    { id: 'Leaf', parent_id: 'Milestone' }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('    - [DONE 06-12] Leaf'), true);
});

test('a task under a parent completed before the period is not reported', () => {
  const data = world([
    { id: 'Old project', status: 1, completed_at: iso(5, 1) },
    { id: 'Open child', parent_id: 'Old project' }
  ]);

  const result = run(data);

  assert.equal(result.text.includes('Open child'), false);
  assert.equal(result.counts.done, 0);
});

test('an inherited DONE combines with NEW when the child was created this week', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Fresh child', parent_id: 'Project', created_at: iso(6, 11) }
  ]);

  const result = run(data);

  assert.equal(lines(result).includes('  - [NEW 06-11] [DONE 06-12] Fresh child'), true);
  assert.equal(result.counts.new, 1);
});

test('a child added after the parent was completed is not swept in as done', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Added later', parent_id: 'Project', created_at: iso(6, 13) }
  ]);

  const out = lines(run(data));

  assert.equal(out.includes('  - [NEW 06-13] Added later'), true);
  assert.equal(out.some(l => l.includes('Added later') && l.includes('[DONE')), false);
});

test('a child reopened after the parent was completed stays open; one reopened before is done with it', () => {
  const data = world([
    doneParent('Project'),
    {
      id: 'Reopened after',
      parent_id: 'Project',
      history: [{ at: iso(6, 13), type: 'status', changes: { from: 1, to: 0 } }]
    },
    {
      id: 'Reopened before',
      parent_id: 'Project',
      history: [{ at: iso(6, 11), type: 'status', changes: { from: 1, to: 0 } }]
    }
  ]);

  const result = run(data);
  const out = lines(result);

  assert.equal(out.includes('  - [REOPENED 06-13] Reopened after'), true);
  assert.equal(out.includes('  - [DONE 06-12] Reopened before'), true);
  assert.equal(result.counts.reopened, 1);
});

test('invalidated and deleted children are not turned into completed work', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Ruled out', parent_id: 'Project', status: 2, completed_at: iso(5, 1) },
    { id: 'Removed', parent_id: 'Project', deleted: true, history: [{ at: iso(5, 1), type: 'deletion', changes: { action: 'soft-delete' } }] }
  ]);

  const result = run(data);

  assert.equal(result.text.includes('Ruled out'), false);
  assert.equal(result.text.includes('Removed'), false);
  assert.equal(result.counts.done, 1);
});

test('a recurring parent that was "completed" (and reopened itself) does not finish its children', () => {
  const data = world([
    { id: 'Weekly routine', status: 0, repeating_due: { freq: 'weekly' }, completed_at: iso(6, 12) },
    { id: 'Routine step', parent_id: 'Weekly routine' }
  ]);

  const result = run(data);

  assert.equal(lines(result).includes('- [DONE 06-12] Weekly routine'), true);
  assert.equal(result.text.includes('Routine step'), false);
});

test('children also inherit completion when the export is limited to the current list', () => {
  const data = world(
    [
      doneParent('Project'),
      { id: 'Child', parent_id: 'Project' }
    ]
  );

  const current = run(data, { scope: 'current', currentListId: 'l1' });

  assert.equal(lines(current).includes('  - [DONE 06-12] Child'), true);
});

test('children finished with their parent are not also listed as upcoming or overdue', () => {
  const data = world([
    doneParent('Project'),
    { id: 'Overdue child', parent_id: 'Project', due: '2026-06-01' },
    { id: 'Unrelated overdue', due: '2026-06-02' }
  ]);

  const result = run(data, { includeUpcoming: true });
  const upcoming = result.text.slice(result.text.indexOf('# Upcoming'));

  assert.equal(upcoming.includes('Overdue child'), false);
  assert.equal(upcoming.includes('Unrelated overdue'), true);
});

test('a recurring child completed this week still appears as upcoming', () => {
  const data = world([
    { id: 'Standup notes', repeating_due: { freq: 'daily' }, completed_at: iso(6, 12), due: '2026-06-15' }
  ]);

  const result = run(data, { includeUpcoming: true });

  assert.equal(result.text.slice(result.text.indexOf('# Upcoming')).includes('Standup notes'), true);
});

test('the legend explains that open sub-tasks count as done with a completed parent', () => {
  const legend = lines(run(world([{ id: 'x' }]))).find(l => l.startsWith('Legend:'));

  assert.equal(legend.includes('sub-tasks'), true);
});
