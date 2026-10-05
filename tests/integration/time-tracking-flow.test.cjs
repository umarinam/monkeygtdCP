const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Boots the real App/S from js/app.js on top of the real core, domain,
// application, storage and time-tracking UI scripts, with a small fake DOM,
// localStorage and Notification, so timer flows run through the CQRS wiring.
const SCRIPTS = [
  'js/core/cqrs.js',
  'js/core/traversal.js',
  'js/core/utils.js',
  'js/domain/time-tracking-ops.js',
  'js/domain/template-ops.js',
  'js/domain/queries.js',
  'js/domain/settings-ops.js',
  'js/application/command-registry.js',
  'js/application/query-registry.js',
  'js/infra/storage.js',
  'js/ui/command-palette-commands.js',
  'js/ui/time-tracking-controller.js'
];

const MIN = 60 * 1000;

function makeNode(id, hidden) {
  const classes = new Set(hidden ? ['hidden'] : []);
  return {
    id, value: '', checked: false, innerHTML: '', textContent: '', className: '', title: '', style: {}, dataset: {},
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      contains: c => classes.has(c)
    },
    focus() {}
  };
}

function bootApp() {
  const nodes = {};
  const node = id => (nodes[id] = nodes[id] || makeNode(id, id.startsWith('ov-')));
  const toasts = [];
  const notifications = [];
  const store = new Map();
  const noOp = () => {};

  class FakeNotification {
    constructor(title, opts) {
      this.title = title;
      this.opts = opts;
      this.closed = false;
      notifications.push(this);
    }
    close() { this.closed = true; }
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = () => Promise.resolve('granted');

  const document = {
    title: 'MonkeyGTD',
    hidden: false,
    hasFocus: () => !document.hidden,
    getElementById: node,
    querySelectorAll: () => [],
    addEventListener: noOp
  };
  const sandbox = {
    console, JSON, Math, Date, Promise,
    setTimeout: fn => fn(),
    clearTimeout: noOp,
    setInterval: () => 1,
    clearInterval: noOp,
    confirm: () => true,
    prompt: () => '',
    document,
    window: { addEventListener: noOp, focus: noOp },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    Notification: FakeNotification,
    renderCurrentPageUi: noOp,
    renderListUi: noOp,
    syncSettingsUi: noOp,
    jumpToUi: noOp,
    openOverlay: id => node(id).classList.remove('hidden'),
    closeOverlay: (app, state, id) => node(id).classList.add('hidden'),
    showToastUi: (app, msg) => toasts.push(msg)
  };
  vm.createContext(sandbox);

  // Script order must match app.html: every file wired there must exist.
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  const wired = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const positions = SCRIPTS.map(rel => wired.indexOf(rel));
  assert.equal(positions.includes(-1), false, `scripts missing from app.html: ${SCRIPTS.filter((_, i) => positions[i] < 0)}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'scripts are loaded out of dependency order in app.html');
  assert.ok(wired.indexOf('js/domain/time-tracking-ops.js') < wired.indexOf('js/domain/weekly-report.js'), 'time-tracking-ops must load before weekly-report');

  for (const rel of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), sandbox, { filename: rel });
  }
  const appSource = fs.readFileSync(path.join(process.cwd(), 'js/app.js'), 'utf8')
    .replace(/App\.init\(\);\s*$/, 'globalThis.__app = { App, S };');
  vm.runInContext(appSource, sandbox, { filename: 'js/app.js' });

  const { App, S } = sandbox.__app;
  const mkTask = vm.runInContext('mkTask', sandbox);
  const task = o => mkTask({ checklist_id: 'l1', ...o });
  S.data = {
    settings: { timerCheckInMin: 15, timerGraceMin: 5 },
    tasks: {
      a: task({ id: 'a', content: 'Write report' }),
      b: task({ id: 'b', content: 'Review PR' })
    },
    lists: { l1: { id: 'l1', name: 'Work', root_tasks: ['a', 'b'] } }
  };
  S.listId = 'l1';
  App.initCqrs();
  const startTimeTracking = vm.runInContext('startTimeTrackingUi', sandbox);
  const renderReportTime = vm.runInContext('renderReportTimeUi', sandbox);
  return { App, S, node, toasts, notifications, store, document, startTimeTracking, renderReportTime };
}

const minutes = s => Math.round((Date.parse(s.end) - Date.parse(s.start)) / MIN);
const isOpen = (node, id) => !node(id).classList.contains('hidden');

test('ts starts, switches and stops the timer, persisting it on this device only', () => {
  const { App, S, node, toasts, store } = bootApp();

  S.selId = 'a';
  App.toggleTimerSelection();
  assert.equal(S.timer.taskId, 'a');
  assert.equal(S.timer.status, 'running');
  assert.equal(JSON.parse(store.get('mgtd3_timer')).taskId, 'a');
  assert.equal(toasts.at(-1), 'Timer started: "Write report"');
  assert.match(node('sb-timer').innerHTML, /Write report/);
  assert.equal(node('sb-timer').style.display, '');

  S.timer.startedAt = Date.now() - 30 * MIN;
  S.selId = 'b';
  App.toggleTimerSelection();
  assert.equal(S.timer.taskId, 'b');
  assert.match(toasts.at(-1), /^Timer switched to "Review PR" \(logged 30m on the previous task\)$/);

  S.timer.startedAt = Date.now() - 10 * MIN;
  App.toggleTimerSelection();
  assert.equal(S.timer, null);
  assert.equal(store.has('mgtd3_timer'), false);
  assert.equal(toasts.at(-1), 'Timer stopped: logged 10m on "Review PR"');
  assert.deepEqual(Array.from(S.data.timeSessions, s => [s.taskId, minutes(s)]), [['a', 30], ['b', 10]]);
  assert.equal(node('sb-timer').style.display, 'none');
  assert.equal(S.data.settings.timerCheckInMin, 15, 'settings untouched');
  assert.equal(JSON.stringify(S.data).includes('"status":"running"'), false, 'running timer is not part of synced data');
});

test('undoing an earlier task change does not undo time logged since', () => {
  const { App, S } = bootApp();
  const t0 = Date.now() - 60 * MIN;

  App.markTemplate('a', 'Report template');
  App.dispatch('time.start', { taskId: 'b', nowMs: t0 });
  App.dispatch('time.stop', { nowMs: t0 + 20 * MIN });
  App.undo();

  assert.equal('is_template' in S.data.tasks.a, false);
  assert.equal(S.data.timeSessions.length, 1);
  assert.equal(minutes(S.data.timeSessions[0]), 20);
});

test('a due check-in opens the dialog, notifies once in the background, and answers update the timer', () => {
  const { App, S, node, toasts, notifications, document } = bootApp();
  S.data.settings.timerNotify = true;
  document.hidden = true;
  const now = Date.now();

  App.dispatch('time.start', { taskId: 'a', nowMs: now - 16 * MIN });
  App.timeTick(now);
  assert.equal(isOpen(node, 'ov-checkin'), true);
  assert.match(node('checkin-body').innerHTML, /Still working on <strong>Write report<\/strong>\?/);
  assert.match(node('checkin-actions').innerHTML, /answerCheckIn\('drop'\)/);
  assert.match(node('sb-timer').innerHTML, /Check-in/);
  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].title, 'Still working?');

  App.timeTick(now + 1000);
  assert.equal(notifications.length, 1, 'notified once per check-in');

  App.answerCheckIn('working');
  assert.equal(isOpen(node, 'ov-checkin'), false);
  assert.equal(S.timer.promptAt, null);
  assert.ok(S.timer.lastConfirmedAt >= now);
  assert.equal(notifications[0].closed, true);

  S.timer.startedAt = Date.now() - 40 * MIN;
  S.timer.lastConfirmedAt = Date.now() - 17 * MIN;
  App.timeTick(Date.now());
  assert.equal(isOpen(node, 'ov-checkin'), true);
  App.answerCheckIn('drop');
  assert.equal(S.timer.status, 'paused');
  assert.equal(minutes(S.data.timeSessions[0]), 23);
  assert.match(toasts.at(-1), /logged 23m \(time since the last check-in dropped\)/);
  assert.match(node('sb-timer').innerHTML, /resume/);
});

test('an unanswered check-in auto-pauses; "I was working" puts the gap back', () => {
  const { App, S, node } = bootApp();
  const now = Date.now();

  App.dispatch('time.start', { taskId: 'a', nowMs: now - 60 * MIN });
  S.timer.lastConfirmedAt = now - 30 * MIN;
  App.timeTick(now);

  assert.equal(S.timer.status, 'paused');
  assert.equal(isOpen(node, 'ov-checkin'), true);
  assert.equal(node('checkin-title').textContent, 'Timer paused');
  assert.match(node('checkin-actions').innerHTML, /answerCheckIn\('recover'\)/);
  assert.deepEqual(Array.from(S.data.timeSessions, minutes), [30]);

  App.answerCheckIn('recover');
  assert.equal(S.timer.status, 'running');
  assert.equal(S.timer.startedAt, now - 30 * MIN);
  assert.equal(isOpen(node, 'ov-checkin'), false);
});

test('a running timer survives a reload, and completing its task stops it', () => {
  const { App, S, store, toasts, node, startTimeTracking } = bootApp();
  const now = Date.now();
  store.set('mgtd3_timer', JSON.stringify({ taskId: 'a', status: 'running', startedAt: now - 10 * MIN, lastConfirmedAt: now - MIN }));

  startTimeTracking(App, S);
  assert.equal(S.timer.taskId, 'a');
  assert.equal(S.timer.startedAt, now - 10 * MIN);
  assert.equal(node('sb-timer').style.display, '');

  S.data.tasks.a.status = 1;
  S.data.tasks.a.completed_at = new Date(now).toISOString();
  App.timeTick(now + 1000);
  assert.equal(S.timer, null);
  assert.equal(toasts.at(-1), 'Timer stopped - task completed (logged 10m)');
});

test('the time log adds and deletes time, and the report panel lists it', () => {
  const { App, S, node, toasts, renderReportTime } = bootApp();

  S.selId = 'a';
  App.openTimeLog();
  assert.equal(isOpen(node, 'ov-timelog'), true);
  assert.equal(node('timelog-task').textContent, 'Write report');
  assert.match(node('timelog-list').innerHTML, /No time logged yet/);

  node('timelog-dur').value = 'abc';
  App.addManualTime();
  assert.equal(toasts.at(-1), 'Enter a duration like 25m, 1h30 or 1:15');
  assert.equal((S.data.timeSessions || []).length, 0);

  node('timelog-dur').value = '1h30';
  App.addManualTime();
  assert.equal(toasts.at(-1), 'Added 1h 30m');
  assert.equal(S.data.timeSessions.length, 1);
  assert.equal(S.data.timeSessions[0].source, 'manual');
  assert.match(node('timelog-list').innerHTML, /1h 30m/);
  assert.match(node('timelog-summary').innerHTML, /1h 30m/);
  assert.equal(node('timelog-dur').value, '');

  const today = node('timelog-date').value;
  const byTask = renderReportTime(App, S, today, today);
  assert.equal(byTask.a, 90 * MIN);
  assert.match(node('report-time').innerHTML, /Time tracked <span class="rt-total">1h 30m/);
  assert.match(node('report-time').innerHTML, /Work › Write report/);

  App.deleteTimeSession(S.data.timeSessions[0].id);
  assert.equal(S.data.timeSessions.length, 0);
  assert.equal(toasts.at(-1), 'Time session deleted');
  assert.match(node('timelog-list').innerHTML, /No time logged yet/);
});
