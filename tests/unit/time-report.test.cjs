const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function loadDomain(files) {
  const sandbox = { console, JSON, Math, Date };
  vm.createContext(sandbox);
  for (const rel of files) vm.runInContext(read(rel), sandbox, { filename: rel });
  vm.runInContext('globalThis.__exports = { timeReportDomain: typeof timeReportDomain === "function" ? timeReportDomain : null, buildWeeklyReportDomain: typeof buildWeeklyReportDomain === "function" ? buildWeeklyReportDomain : null, WEEKLY_REPORT_PROMPT: typeof WEEKLY_REPORT_PROMPT === "string" ? WEEKLY_REPORT_PROMPT : "" };', sandbox);
  return sandbox.__exports;
}

const { timeReportDomain, buildWeeklyReportDomain, WEEKLY_REPORT_PROMPT } = loadDomain([
  'js/core/utils.js',
  'js/domain/time-tracking-ops.js',
  'js/domain/weekly-report.js'
]);

const MIN = 60 * 1000;
// Local-time ISO stamps (October 2026) so results do not depend on the timezone.
const iso = (day, h, m = 0) => new Date(2026, 9, day, h, m, 0).toISOString();
const plain = v => JSON.parse(JSON.stringify(v));

function task(id, o = {}) {
  return {
    id, content: `Task ${id}`, checklist_id: 'l1', parent_id: '', tasks: [], status: 0, deleted: false,
    tags: {}, assignees: [], notes: [], history: [], due: '', created_at: iso(1, 9), updated_at: iso(1, 9), ...o
  };
}

function sess(taskId, start, end, o = {}) {
  return { id: `s-${taskId}-${start}`, taskId, start, end, source: 'timer', taskTitle: '', listId: 'l1', listName: 'Home', ...o };
}

function data(sessions) {
  return {
    lists: {
      l1: { id: 'l1', name: 'Home', root_tasks: ['p', 'x'], created_at: iso(1, 9) },
      l2: { id: 'l2', name: 'Work', root_tasks: ['w'], created_at: iso(1, 9) }
    },
    tasks: {
      p: task('p', { content: 'Project', tasks: ['c'] }),
      c: task('c', { content: 'Write [spec](#task-x)', parent_id: 'p' }),
      x: task('x', { content: 'Errand' }),
      w: task('w', { content: 'Deploy', checklist_id: 'l2' })
    },
    timeSessions: sessions,
    settings: {}
  };
}

test('timeReportDomain clips sessions to the range and splits them at local midnight', () => {
  const d = data([sess('c', iso(4, 23, 30), iso(5, 0, 30)), sess('x', iso(3, 10), iso(3, 11))]);

  const oneDay = timeReportDomain(d, { start: '2026-10-05', end: '2026-10-05' });
  assert.equal(oneDay.totalMs, 30 * MIN);
  assert.deepEqual(plain(oneDay.days), [{ date: '2026-10-05', ms: 30 * MIN }]);

  const twoDays = timeReportDomain(d, { start: '2026-10-04', end: '2026-10-05' });
  assert.equal(twoDays.totalMs, 60 * MIN);
  assert.deepEqual(plain(twoDays.days), [{ date: '2026-10-04', ms: 30 * MIN }, { date: '2026-10-05', ms: 30 * MIN }]);
  assert.deepEqual(plain(twoDays.tasks.map(t => t.taskId)), ['c']);
});

test('timeReportDomain groups by task with a list › parent › task path, most time first', () => {
  const d = data([
    sess('c', iso(5, 9), iso(5, 9, 20)),
    sess('c', iso(5, 13), iso(5, 13, 25)),
    sess('x', iso(5, 10), iso(5, 11)),
    sess('w', iso(5, 14), iso(5, 14, 10), { listId: 'l2', listName: 'Work' })
  ]);
  const r = timeReportDomain(d, { start: '2026-10-05', end: '2026-10-05' });

  assert.deepEqual(plain(r.tasks.map(t => [t.crumb, t.ms / MIN, t.removed])), [
    ['Home › Errand', 60, false],
    ['Home › Project › Write spec', 45, false],
    ['Work › Deploy', 10, false]
  ]);
  assert.equal(r.totalMs, 115 * MIN);
});

test('timeReportDomain scope current keeps only the current list, including removed tasks of it', () => {
  const d = data([
    sess('x', iso(5, 9), iso(5, 10)),
    sess('w', iso(5, 9), iso(5, 9, 30), { listId: 'l2' }),
    sess('gone', iso(5, 11), iso(5, 11, 15), { taskTitle: 'Shipped feature', listId: 'l1', listName: 'Home' })
  ]);
  const r = timeReportDomain(d, { start: '2026-10-05', end: '2026-10-05', scope: 'current', currentListId: 'l1' });
  assert.equal(r.totalMs, 75 * MIN);
  assert.deepEqual(plain(r.tasks.map(t => t.taskId)), ['x', 'gone']);
});

test('timeReportDomain names a task that was optimized away from its snapshot', () => {
  const d = data([sess('gone', iso(5, 9), iso(5, 10), { taskTitle: 'Shipped feature', listId: 'old', listName: 'Archive' })]);
  const [row] = timeReportDomain(d, { start: '2026-10-05', end: '2026-10-05' }).tasks;
  assert.equal(row.title, 'Shipped feature');
  assert.equal(row.crumb, 'Archive › Shipped feature');
  assert.equal(row.removed, true);
});

test('timeReportDomain rejects an invalid range and ignores broken sessions', () => {
  assert.ok(timeReportDomain(data([]), { start: '2026-10-05', end: 'bad' }).error);
  assert.ok(timeReportDomain(data([]), { start: '2026-10-06', end: '2026-10-05' }).error);
  const r = timeReportDomain(data([sess('x', 'nope', iso(5, 10)), sess('x', iso(5, 11), iso(5, 10))]), { start: '2026-10-05', end: '2026-10-05' });
  assert.equal(r.error, '');
  assert.equal(r.totalMs, 0);
});

// ── Weekly AI export ─────────────────────────────────────────────────

const exportOpts = o => ({ start: '2026-10-01', end: '2026-10-07', scope: 'all', generatedOn: '2026-10-07', ...o });

test('the weekly export adds a Time tracked section only when asked and time exists', () => {
  const d = data([
    sess('x', iso(5, 10), iso(5, 11, 30)),
    sess('c', iso(6, 9), iso(6, 9, 45)),
    sess('gone', iso(6, 14), iso(6, 14, 20), { taskTitle: 'Old thing', listName: 'Home' })
  ]);

  const without = buildWeeklyReportDomain(d, exportOpts({ includePrompt: true }));
  assert.equal(without.text.includes('Time tracked'), false);

  const withTime = buildWeeklyReportDomain(d, exportOpts({ includePrompt: true, includeTime: true }));
  const body = withTime.text.split('--- EXPORT BELOW ---')[1];
  assert.match(body, /# Time tracked \(total 2h 35m\)/);
  assert.match(body, /## By day\n- 10-05 Mon: 1h 30m\n- 10-06 Tue: 1h 5m/);
  assert.match(body, /## By task \(most time first\)\n- Home › Errand: 1h 30m\n- Home › Project › Write spec: 45m\n- Home › Old thing: 20m \(task since removed\)/);
  assert.match(withTime.text.split('--- EXPORT BELOW ---')[0], /"Time tracked" section/);
  assert.equal(without.text.startsWith(WEEKLY_REPORT_PROMPT), true);

  // Everything before the new section is unchanged.
  const markdownWithout = buildWeeklyReportDomain(d, exportOpts()).text;
  const markdownWith = buildWeeklyReportDomain(d, exportOpts({ includeTime: true })).text;
  assert.equal(markdownWith.startsWith(markdownWithout.trimEnd()), true);
});

test('the weekly export leaves the prompt and body alone when no time is in range', () => {
  const d = data([sess('x', iso(20, 10), iso(20, 11))]);
  const plainText = buildWeeklyReportDomain(d, exportOpts({ includePrompt: true })).text;
  const withTime = buildWeeklyReportDomain(d, exportOpts({ includePrompt: true, includeTime: true })).text;
  assert.equal(withTime, plainText);
});

test('the weekly export works when the time-tracking module is not loaded', () => {
  const { buildWeeklyReportDomain: build } = loadDomain(['js/domain/weekly-report.js']);
  const d = data([sess('x', iso(5, 10), iso(5, 11))]);
  const res = build(d, exportOpts({ includeTime: true }));
  assert.equal(res.error, '');
  assert.equal(res.text.includes('Time tracked'), false);
});
