const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function loadDomain() {
  const sandbox = { console, JSON, Math, Date };
  vm.createContext(sandbox);
  for (const rel of ['js/core/utils.js', 'js/domain/time-tracking-ops.js']) {
    vm.runInContext(read(rel), sandbox, { filename: rel });
  }
  vm.runInContext(`globalThis.__exports = {
    parseDurationDomain, formatDurationDomain, timeSettingsDomain, addTimeSessionDomain, deleteTimeSessionDomain,
    sessionsForTaskDomain, addManualTimeDomain, timeTotalsDomain, taskTimeSummaryDomain, pruneTimeSessionsDomain,
    normalizeTimerDomain, startTimerDomain, stopTimerDomain, resumeTimerDomain, evaluateCheckInDomain,
    answerCheckInDomain, recoverAutoPauseDomain, dismissAutoPauseDomain, autoStopTimerDomain
  };`, sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

const D = loadDomain();
const MIN = 60 * 1000;

// Local-time timestamps (Mon 5 Oct 2026) so tests do not depend on the machine's timezone.
const at = (h, m = 0, day = 5, s = 0) => new Date(2026, 9, day, h, m, s).getTime();
const iso = ms => new Date(ms).toISOString();

function mkTask(id, o = {}) {
  return { id, content: `Task ${id}`, checklist_id: 'l1', parent_id: '', tasks: [], status: 0, deleted: false, completed_at: '', ...o };
}

function setup(taskList = [mkTask('a'), mkTask('b')], settings = {}) {
  const tasks = {};
  for (const t of taskList) tasks[t.id] = t;
  const state = {
    timer: null,
    data: { tasks, lists: { l1: { id: 'l1', name: 'Home', root_tasks: Object.keys(tasks) } }, settings, timeSessions: [] }
  };
  const app = {
    saves: 0,
    timerSaves: 0,
    save() { this.saves += 1; },
    saveTimer() { this.timerSaves += 1; }
  };
  return { state, app };
}

const sessionMinutes = s => (Date.parse(s.end) - Date.parse(s.start)) / MIN;
const plain = v => JSON.parse(JSON.stringify(v));

// ── Durations ────────────────────────────────────────────────────────

test('parseDurationDomain accepts minutes, hours, h:mm and mixed forms', () => {
  const cases = { '25m': 25, '25 min': 25, '1h30': 90, '1h 30m': 90, '1.5h': 90, '1:30': 90, '90': 90, '2 hours': 120, '1hr 5min': 65, '0:45': 45 };
  for (const [raw, minutes] of Object.entries(cases)) {
    assert.equal(D.parseDurationDomain(raw), minutes * MIN, raw);
  }
});

test('parseDurationDomain returns 0 for empty or malformed input', () => {
  for (const raw of ['', '   ', 'abc', 'h', 'm', '1:75', '-5', '30s', '1h30x', null, undefined]) {
    assert.equal(D.parseDurationDomain(raw), 0, String(raw));
  }
});

test('formatDurationDomain renders compact durations and a clock', () => {
  assert.equal(D.formatDurationDomain(0), '0m');
  assert.equal(D.formatDurationDomain(30 * 1000), '<1m');
  assert.equal(D.formatDurationDomain(25 * MIN), '25m');
  assert.equal(D.formatDurationDomain(90 * MIN + 59 * 1000), '1h 30m');
  assert.equal(D.formatDurationDomain(120 * MIN), '2h');
  assert.equal(D.formatDurationDomain(-5), '0m');
  assert.equal(D.formatDurationDomain(754 * 1000, { clock: true }), '0:12:34');
  assert.equal(D.formatDurationDomain(3723 * 1000, { clock: true }), '1:02:03');
});

test('timeSettingsDomain applies defaults and honours 0 as off', () => {
  assert.deepEqual(plain(D.timeSettingsDomain({})), { checkInMs: 15 * MIN, graceMs: 5 * MIN, retentionDays: 365 });
  assert.deepEqual(plain(D.timeSettingsDomain({ timerCheckInMin: 0, timerGraceMin: '0', timeRetentionDays: 0 })), { checkInMs: 0, graceMs: 0, retentionDays: 0 });
  assert.deepEqual(plain(D.timeSettingsDomain({ timerCheckInMin: 'x', timerGraceMin: -3 })), { checkInMs: 15 * MIN, graceMs: 0, retentionDays: 365 });
});

// ── Start / stop / switch ────────────────────────────────────────────

test('starting a timer while another runs logs the first task and switches', () => {
  const { state, app } = setup();
  assert.equal(D.startTimerDomain(app, state, 'a', at(9)).ok, true);
  const res = D.startTimerDomain(app, state, 'b', at(9, 30));

  assert.equal(res.switchedFrom, 'a');
  assert.equal(state.timer.taskId, 'b');
  assert.equal(state.timer.startedAt, at(9, 30));
  assert.equal(state.data.timeSessions.length, 1);
  const s = state.data.timeSessions[0];
  assert.equal(s.taskId, 'a');
  assert.equal(s.start, iso(at(9)));
  assert.equal(s.end, iso(at(9, 30)));
  assert.equal(s.source, 'timer');
  assert.equal(s.taskTitle, 'Task a');
  assert.equal(s.listId, 'l1');
  assert.equal(s.listName, 'Home');
});

test('starting the task that is already running is a no-op', () => {
  const { state, app } = setup();
  D.startTimerDomain(app, state, 'a', at(9));
  const res = D.startTimerDomain(app, state, 'a', at(9, 20));
  assert.equal(res.already, true);
  assert.equal(state.timer.startedAt, at(9));
  assert.equal(state.data.timeSessions.length, 0);
});

test('timers cannot start on missing, deleted, completed or invalidated tasks', () => {
  const { state, app } = setup([mkTask('done', { status: 1 }), mkTask('inv', { status: 2 }), mkTask('del', { deleted: true })]);
  for (const id of ['nope', 'done', 'inv', 'del']) {
    const res = D.startTimerDomain(app, state, id, at(9));
    assert.equal(res.ok, false, id);
    assert.ok(res.error, id);
  }
  assert.equal(state.timer, null);
});

test('sessions under one minute are not logged', () => {
  const { state, app } = setup();
  D.startTimerDomain(app, state, 'a', at(9));
  const res = D.stopTimerDomain(app, state, at(9, 0, 5, 40));
  assert.equal(res.stopped, true);
  assert.equal(res.logged, null);
  assert.equal(state.timer, null);
  assert.equal(state.data.timeSessions.length, 0);
});

test('stop with pause remembers the task and resume starts a fresh session', () => {
  const { state, app } = setup();
  D.startTimerDomain(app, state, 'a', at(9));
  D.stopTimerDomain(app, state, at(9, 25), { pause: true });
  assert.equal(state.timer.status, 'paused');
  assert.equal(state.timer.taskId, 'a');

  D.resumeTimerDomain(app, state, at(10));
  assert.equal(state.timer.status, 'running');
  assert.equal(state.timer.startedAt, at(10));
  D.stopTimerDomain(app, state, at(10, 5));
  assert.deepEqual(state.data.timeSessions.map(sessionMinutes), [25, 5]);
});

// ── Totals ───────────────────────────────────────────────────────────

test('timeTotalsDomain rolls time up to every ancestor and includes the running timer', () => {
  const { state, app } = setup([
    mkTask('g', { tasks: ['p'] }),
    mkTask('p', { parent_id: 'g', tasks: ['c'] }),
    mkTask('c', { parent_id: 'p' }),
    mkTask('x')
  ]);
  D.addTimeSessionDomain(app, state, { taskId: 'c', start: at(8), end: at(8, 30) });
  D.addTimeSessionDomain(app, state, { taskId: 'p', start: at(8, 30), end: at(8, 40) });
  D.addTimeSessionDomain(app, state, { taskId: 'x', start: at(8), end: at(9) });
  D.startTimerDomain(app, state, 'c', at(9));

  const totals = D.timeTotalsDomain(state, at(9, 5));
  assert.equal(totals.own.c, 35 * MIN);
  assert.equal(totals.own.p, 10 * MIN);
  assert.equal(totals.own.g, undefined);
  assert.equal(totals.rolled.c, 35 * MIN);
  assert.equal(totals.rolled.p, 45 * MIN);
  assert.equal(totals.rolled.g, 45 * MIN);
  assert.equal(totals.rolled.x, 60 * MIN);
});

test('taskTimeSummaryDomain splits today and this week (Monday start)', () => {
  const { state, app } = setup();
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(9), end: at(9, 20) }); // Mon 5 Oct
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(23, 50, 4), end: at(0, 10) }); // Sun -> Mon
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(10, 0, 1), end: at(11, 0, 1) }); // Thu last week
  D.startTimerDomain(app, state, 'a', at(12));

  const sum = D.taskTimeSummaryDomain(state, 'a', at(12, 15));
  assert.equal(sum.todayMs, (20 + 10 + 15) * MIN);
  assert.equal(sum.weekMs, (20 + 10 + 15) * MIN);
  assert.equal(sum.ownMs, (20 + 20 + 60 + 15) * MIN);
  assert.equal(sum.rolledMs, sum.ownMs);
});

// ── Check-ins ────────────────────────────────────────────────────────

test('a check-in is due after the interval and auto-pauses after the grace period', () => {
  const { state, app } = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 5 });
  D.startTimerDomain(app, state, 'a', at(9));

  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 14)), 'none');
  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 15)), 'prompt');
  assert.equal(state.timer.promptAt, at(9, 15));

  assert.equal(D.answerCheckInDomain(app, state, 'working', at(9, 16)).ok, true);
  assert.equal(state.timer.lastConfirmedAt, at(9, 16));
  assert.equal(state.timer.promptAt, null);

  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 30)), 'none');
  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 33)), 'prompt');
  assert.equal(state.timer.promptAt, at(9, 31));
  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 36)), 'autopause');

  assert.equal(state.timer.status, 'paused');
  assert.deepEqual(plain(state.timer.autoPaused), { from: at(9, 16), to: at(9, 31) });
  assert.equal(state.data.timeSessions.length, 1);
  assert.equal(state.data.timeSessions[0].end, iso(at(9, 16)));
  assert.equal(D.evaluateCheckInDomain(app, state, at(9, 40)), 'none');
});

test('coming back long after the tab was closed auto-pauses at once', () => {
  const { state, app } = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 5 });
  D.startTimerDomain(app, state, 'a', at(9));
  D.answerCheckInDomain(app, state, 'working', at(9, 10));

  assert.equal(D.evaluateCheckInDomain(app, state, at(13)), 'autopause');
  assert.deepEqual(plain(state.timer.autoPaused), { from: at(9, 10), to: at(9, 25) });
  assert.deepEqual(state.data.timeSessions.map(sessionMinutes), [10]);
});

test('answering keep or drop pauses and logs until now or until the last check-in', () => {
  for (const [answer, endsAt] of [['keep', at(9, 33)], ['drop', at(9, 16)]]) {
    const { state, app } = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 5 });
    D.startTimerDomain(app, state, 'a', at(9));
    D.answerCheckInDomain(app, state, 'working', at(9, 16));
    D.evaluateCheckInDomain(app, state, at(9, 31));

    const res = D.answerCheckInDomain(app, state, answer, at(9, 33));
    assert.equal(res.ok, true, answer);
    assert.equal(state.timer.status, 'paused', answer);
    assert.equal(state.timer.autoPaused, null, answer);
    assert.equal(state.data.timeSessions.length, 1, answer);
    assert.equal(state.data.timeSessions[0].end, iso(endsAt), answer);
  }
});

test('check-ins off never prompt; grace off never auto-pauses', () => {
  const off = setup([mkTask('a')], { timerCheckInMin: 0 });
  D.startTimerDomain(off.app, off.state, 'a', at(9));
  assert.equal(D.evaluateCheckInDomain(off.app, off.state, at(17)), 'none');
  assert.equal(off.state.timer.status, 'running');

  const noGrace = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 0 });
  D.startTimerDomain(noGrace.app, noGrace.state, 'a', at(9));
  assert.equal(D.evaluateCheckInDomain(noGrace.app, noGrace.state, at(17)), 'prompt');
  assert.equal(noGrace.state.timer.promptAt, at(9, 15));
  assert.equal(noGrace.state.timer.status, 'running');
});

test('recovering an auto-pause counts the gap in the next session', () => {
  const { state, app } = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 5 });
  D.startTimerDomain(app, state, 'a', at(9));
  D.answerCheckInDomain(app, state, 'working', at(9, 16));
  D.evaluateCheckInDomain(app, state, at(9, 36));

  assert.equal(D.recoverAutoPauseDomain(app, state, at(9, 40)).ok, true);
  assert.equal(state.timer.status, 'running');
  assert.equal(state.timer.startedAt, at(9, 16));
  assert.equal(state.timer.lastConfirmedAt, at(9, 40));
  assert.equal(state.timer.autoPaused, null);

  D.stopTimerDomain(app, state, at(10));
  assert.deepEqual(state.data.timeSessions.map(sessionMinutes), [16, 44]);
});

test('dismissing an auto-pause keeps the timer paused', () => {
  const { state, app } = setup([mkTask('a')], { timerCheckInMin: 15, timerGraceMin: 5 });
  D.startTimerDomain(app, state, 'a', at(9));
  D.evaluateCheckInDomain(app, state, at(10));
  assert.equal(D.dismissAutoPauseDomain(app, state), true);
  assert.equal(state.timer.status, 'paused');
  assert.equal(state.timer.autoPaused, null);
  assert.equal(D.recoverAutoPauseDomain(app, state, at(10, 5)).ok, false);
});

// ── Auto-stop on task changes ────────────────────────────────────────

test('completing the timed task stops the timer at completion time', () => {
  const { state, app } = setup();
  D.startTimerDomain(app, state, 'a', at(9));
  state.data.tasks.a.status = 1;
  state.data.tasks.a.completed_at = iso(at(9, 20));

  const res = D.autoStopTimerDomain(app, state, at(9, 21));
  assert.equal(res.reason, 'completed');
  assert.equal(state.timer, null);
  assert.equal(state.data.timeSessions[0].end, iso(at(9, 20)));
});

test('completing a recurring timed task (re-opened at once) also stops the timer', () => {
  const { state, app } = setup([mkTask('r', { repeating_due: { kind: 'daily' }, completed_at: iso(at(8)) })]);
  D.startTimerDomain(app, state, 'r', at(9));
  assert.equal(D.autoStopTimerDomain(app, state, at(9, 5)), null, 'an older completion does not stop it');

  state.data.tasks.r.completed_at = iso(at(9, 30));
  const res = D.autoStopTimerDomain(app, state, at(9, 31));
  assert.equal(res.reason, 'completed');
  assert.deepEqual(state.data.timeSessions.map(sessionMinutes), [30]);
});

test('deleting, invalidating or removing the timed task stops the timer', () => {
  for (const [reason, mutate] of [
    ['deleted', s => { s.data.tasks.a.deleted = true; }],
    ['invalidated', s => { s.data.tasks.a.status = 2; s.data.tasks.a.completed_at = iso(at(9, 50)); }],
    ['removed', s => { delete s.data.tasks.a; }]
  ]) {
    const { state, app } = setup();
    D.startTimerDomain(app, state, 'a', at(9));
    mutate(state);
    const res = D.autoStopTimerDomain(app, state, at(10));
    assert.equal(res.reason, reason);
    assert.equal(state.timer, null);
    assert.equal(state.data.timeSessions.length, 1, reason);
    assert.equal(state.data.timeSessions[0].taskTitle, 'Task a', reason);
  }
});

test('a paused timer whose task is completed is cleared without logging', () => {
  const { state, app } = setup();
  D.startTimerDomain(app, state, 'a', at(9));
  D.stopTimerDomain(app, state, at(9, 30), { pause: true });
  state.data.tasks.a.status = 1;
  state.data.tasks.a.completed_at = iso(at(10));

  assert.equal(D.autoStopTimerDomain(app, state, at(10, 1)).reason, 'completed');
  assert.equal(state.timer, null);
  assert.equal(state.data.timeSessions.length, 1);
});

// ── Manual time, sessions, pruning ───────────────────────────────────

test('manual time ends now for today and starts at 09:00 on a past date', () => {
  const { state, app } = setup();
  const today = D.addManualTimeDomain(app, state, 'a', 25 * MIN, '2026-10-05', at(15));
  assert.equal(today.error, '');
  assert.equal(today.session.start, iso(at(14, 35)));
  assert.equal(today.session.end, iso(at(15)));
  assert.equal(today.session.source, 'manual');

  const past = D.addManualTimeDomain(app, state, 'a', 90 * MIN, '2026-10-02', at(15));
  assert.equal(past.session.start, iso(at(9, 0, 2)));
  assert.equal(past.session.end, iso(at(10, 30, 2)));

  const blankDate = D.addManualTimeDomain(app, state, 'a', 10 * MIN, '', at(15));
  assert.equal(blankDate.session.end, iso(at(15)));
});

test('manual time rejects bad durations, future dates and missing tasks', () => {
  const { state, app } = setup([mkTask('a'), mkTask('d', { deleted: true })]);
  assert.ok(D.addManualTimeDomain(app, state, 'a', 30 * 1000, '', at(15)).error);
  assert.ok(D.addManualTimeDomain(app, state, 'a', 25 * 60 * MIN, '', at(15)).error);
  assert.ok(D.addManualTimeDomain(app, state, 'a', 10 * MIN, '2026-10-06', at(15)).error);
  assert.ok(D.addManualTimeDomain(app, state, 'a', 10 * MIN, 'yesterday', at(15)).error);
  assert.ok(D.addManualTimeDomain(app, state, 'd', 10 * MIN, '', at(15)).error);
  assert.ok(D.addManualTimeDomain(app, state, 'zz', 10 * MIN, '', at(15)).error);
  assert.equal(state.data.timeSessions.length, 0);
});

test('sessionsForTaskDomain lists newest first and deleteTimeSessionDomain removes one', () => {
  const { state, app } = setup();
  const first = D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(8), end: at(8, 30) });
  const second = D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(10), end: at(10, 30) });
  D.addTimeSessionDomain(app, state, { taskId: 'b', start: at(9), end: at(9, 30) });

  assert.deepEqual(D.sessionsForTaskDomain(state.data, 'a').map(s => s.id), [second.id, first.id]);
  assert.equal(D.deleteTimeSessionDomain(app, state, first.id), true);
  assert.equal(D.deleteTimeSessionDomain(app, state, 'missing'), false);
  assert.deepEqual(D.sessionsForTaskDomain(state.data, 'a').map(s => s.id), [second.id]);
});

test('time sessions are created on demand when the data has none yet', () => {
  const { state, app } = setup();
  delete state.data.timeSessions;
  assert.deepEqual(plain(D.timeTotalsDomain(state, at(9))), { own: {}, rolled: {} });
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(8), end: at(9) });
  assert.equal(state.data.timeSessions.length, 1);
});

test('pruneTimeSessionsDomain drops sessions that ended before the retention window', () => {
  const { state, app } = setup();
  const day = 24 * 60 * MIN;
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(9) - 400 * day, end: at(10) - 400 * day });
  D.addTimeSessionDomain(app, state, { taskId: 'gone', taskTitle: 'Old task', start: at(9) - 10 * day, end: at(10) - 10 * day });
  D.addTimeSessionDomain(app, state, { taskId: 'a', start: at(9), end: at(10) });

  assert.equal(D.pruneTimeSessionsDomain(state, 0, at(12)), 0);
  assert.equal(D.pruneTimeSessionsDomain(state, 365, at(12)), 1);
  assert.equal(state.data.timeSessions.length, 2);
  assert.equal(D.pruneTimeSessionsDomain(state, 5, at(12)), 1);
  assert.deepEqual(state.data.timeSessions.map(s => s.taskId), ['a']);
});

test('normalizeTimerDomain rejects broken stored timers', () => {
  assert.equal(D.normalizeTimerDomain(null), null);
  assert.equal(D.normalizeTimerDomain('x'), null);
  assert.equal(D.normalizeTimerDomain({ status: 'running', startedAt: 1 }), null);
  assert.equal(D.normalizeTimerDomain({ taskId: 'a', status: 'running' }), null);

  const running = D.normalizeTimerDomain({ taskId: 'a', status: 'running', startedAt: 100, promptAt: '' });
  assert.equal(running.lastConfirmedAt, 100);
  assert.equal(running.promptAt, null);

  const paused = D.normalizeTimerDomain({ taskId: 'a', status: 'paused', autoPaused: { from: 1, to: 2 } });
  assert.equal(paused.status, 'paused');
  assert.deepEqual(plain(paused.autoPaused), { from: 1, to: 2 });
});
