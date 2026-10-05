'use strict';

// Time tracking. Logged time lives in data.timeSessions as records of their own,
// linked to tasks by taskId: undo snapshots (tasks/lists only), task copies and
// repo optimize never touch it, and each session keeps a copy of the task title
// and list name so reports can still name a task that was optimized away.
//
// The running timer is per-device state on state.timer, persisted through
// app.saveTimer(). Every rule below works from timestamps (nowMs is passed in),
// so a closed tab or a sleeping laptop is caught up on the next evaluation.
//
// timer: { taskId, taskTitle, status: 'running'|'paused', startedAt,
//          lastConfirmedAt, promptAt, autoPaused: {from, to}|null }  (epoch ms)

const TIME_MIN_SESSION_MS = 60 * 1000;
const TIME_MAX_MANUAL_MS = 24 * 60 * 60 * 1000;
const TIME_MANUAL_START_HOUR = 9;
const TIME_DEFAULTS = { checkInMin: 15, graceMin: 5, retentionDays: 365 };

function timeNowMs(nowMs) {
  return Number.isFinite(nowMs) ? nowMs : Date.now();
}

function timeYmd(ms) {
  const d = new Date(ms);
  const pad2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function timeDayStartMs(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function timeNextDayMs(ms) {
  const d = new Date(timeDayStartMs(ms));
  d.setDate(d.getDate() + 1);
  return d.getTime();
}

// Monday 00:00 local of the week containing ms.
function timeWeekStartMs(ms) {
  const d = new Date(timeDayStartMs(ms));
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

function timeCleanTitle(s) {
  return String(s || '')
    .replace(/\[([^\]]*)\]\(#[^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function timeSettingsDomain(settings) {
  const s = settings || {};
  const minutes = (v, fallback) => {
    if (v === undefined || v === null || v === '') return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, n) : fallback;
  };
  return {
    checkInMs: minutes(s.timerCheckInMin, TIME_DEFAULTS.checkInMin) * 60000,
    graceMs: minutes(s.timerGraceMin, TIME_DEFAULTS.graceMin) * 60000,
    retentionDays: minutes(s.timeRetentionDays, TIME_DEFAULTS.retentionDays)
  };
}

// "25m", "1h30", "1h 30m", "1.5h", "1:30" (h:mm), "90" (minutes) -> ms; 0 when invalid.
function parseDurationDomain(raw) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return 0;

  let m = s.match(/^(\d+):(\d{1,2})$/);
  if (m) return Number(m[2]) < 60 ? (Number(m[1]) * 60 + Number(m[2])) * 60000 : 0;

  m = s.match(/^\d+(?:\.\d+)?$/);
  if (m) return Math.round(parseFloat(s) * 60000);

  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*(m(?:in(?:ute)?s?)?)?)?$/);
  if (!m || (m[1] === undefined && m[2] === undefined)) return 0;
  // A bare trailing number only means minutes after an hour part ("1h30").
  if (m[1] === undefined && !m[3]) return 0;
  const hours = m[1] === undefined ? 0 : parseFloat(m[1]);
  const mins = m[2] === undefined ? 0 : parseFloat(m[2]);
  return Math.round((hours * 60 + mins) * 60000);
}

// "1h 25m" / "45m" / "2h" (or "0:12:34" with { clock: true }).
function formatDurationDomain(ms, options) {
  const total = Math.max(0, Math.floor(Number(ms) || 0));
  if (options && options.clock) {
    const secs = Math.floor(total / 1000);
    const pad2 = n => String(n).padStart(2, '0');
    return `${Math.floor(secs / 3600)}:${pad2(Math.floor(secs / 60) % 60)}:${pad2(secs % 60)}`;
  }
  const mins = Math.floor(total / 60000);
  if (!mins) return total > 0 ? '<1m' : '0m';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function ensureTimeSessions(state) {
  if (!Array.isArray(state.data.timeSessions)) state.data.timeSessions = [];
  return state.data.timeSessions;
}

function timeSessionMs(session) {
  const start = Date.parse(String(session && session.start || ''));
  const end = Date.parse(String(session && session.end || ''));
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function addTimeSessionDomain(app, state, entry) {
  const startMs = Number(entry && entry.start);
  const endMs = Number(entry && entry.end);
  if (!entry || !entry.taskId || !Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  if (endMs - startMs < TIME_MIN_SESSION_MS) return null;

  const task = state.data.tasks[entry.taskId];
  const listId = task ? task.checklist_id : (entry.listId || '');
  const list = state.data.lists[listId];
  const session = {
    id: uid(),
    taskId: entry.taskId,
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    source: entry.source === 'manual' ? 'manual' : 'timer',
    taskTitle: timeCleanTitle(task ? task.content : entry.taskTitle),
    listId: listId || '',
    listName: list ? String(list.name || '') : ''
  };
  ensureTimeSessions(state).push(session);
  app.save();
  return session;
}

function deleteTimeSessionDomain(app, state, sessionId) {
  const sessions = ensureTimeSessions(state);
  const idx = sessions.findIndex(s => s && s.id === sessionId);
  if (idx < 0) return false;
  sessions.splice(idx, 1);
  app.save();
  return true;
}

function sessionsForTaskDomain(data, taskId) {
  return (Array.isArray(data.timeSessions) ? data.timeSessions : [])
    .filter(s => s && s.taskId === taskId && timeSessionMs(s))
    .sort((a, b) => String(b.start).localeCompare(String(a.start)));
}

function addManualTimeDomain(app, state, taskId, durationMs, date, nowMs) {
  const at = timeNowMs(nowMs);
  const task = state.data.tasks[taskId];
  if (!task || task.deleted) return { session: null, error: 'Select a task first' };
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < TIME_MIN_SESSION_MS) return { session: null, error: 'Enter at least 1 minute, e.g. 25m or 1h30' };
  if (ms > TIME_MAX_MANUAL_MS) return { session: null, error: 'Enter at most 24 hours' };

  const day = String(date || '').trim() || timeYmd(at);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { session: null, error: 'Pick a valid date' };
  const today = timeYmd(at);
  if (day > today) return { session: null, error: 'Time cannot be added to a future date' };

  let start;
  let end;
  if (day === today) {
    end = at;
    start = end - ms;
  } else {
    start = new Date(`${day}T${String(TIME_MANUAL_START_HOUR).padStart(2, '0')}:00:00`).getTime();
    end = start + ms;
  }
  return { session: addTimeSessionDomain(app, state, { taskId, start, end, source: 'manual' }), error: '' };
}

function timerElapsedDomain(timer, nowMs) {
  if (!timer || timer.status !== 'running') return 0;
  return Math.max(0, timeNowMs(nowMs) - timer.startedAt);
}

// own: task id -> ms logged on that task (plus the running session).
// rolled: the same including every descendant.
function timeTotalsDomain(state, nowMs) {
  const own = {};
  const add = (id, ms) => { own[id] = (own[id] || 0) + ms; };
  for (const s of Array.isArray(state.data.timeSessions) ? state.data.timeSessions : []) {
    const span = timeSessionMs(s);
    if (span) add(s.taskId, span.end - span.start);
  }
  const timer = state.timer;
  if (timer && timer.status === 'running') add(timer.taskId, timerElapsedDomain(timer, nowMs));

  const tasks = state.data.tasks || {};
  const rolled = {};
  for (const [id, ms] of Object.entries(own)) {
    const seen = new Set();
    for (let cur = id; cur && !seen.has(cur); cur = tasks[cur] ? tasks[cur].parent_id : '') {
      seen.add(cur);
      rolled[cur] = (rolled[cur] || 0) + ms;
    }
  }
  return { own, rolled };
}

// Totals for the time-log dialog: own, with sub-tasks, today and this week (own).
function taskTimeSummaryDomain(state, taskId, nowMs) {
  const at = timeNowMs(nowMs);
  const totals = timeTotalsDomain(state, at);
  const dayStart = timeDayStartMs(at);
  const weekStart = timeWeekStartMs(at);
  let todayMs = 0;
  let weekMs = 0;
  const spans = sessionsForTaskDomain(state.data, taskId).map(timeSessionMs);
  const timer = state.timer;
  if (timer && timer.status === 'running' && timer.taskId === taskId) spans.push({ start: timer.startedAt, end: at });
  for (const span of spans) {
    todayMs += Math.max(0, Math.min(span.end, at) - Math.max(span.start, dayStart));
    weekMs += Math.max(0, Math.min(span.end, at) - Math.max(span.start, weekStart));
  }
  return { ownMs: totals.own[taskId] || 0, rolledMs: totals.rolled[taskId] || 0, todayMs, weekMs };
}

// Time logged between two local dates (inclusive), clipped to the range and split
// at local midnight. scope 'current' keeps the current list only. A session whose
// task is gone (optimized away) is reported under its snapshot title as removed.
function timeReportDomain(data, options) {
  const opts = options || {};
  const result = { totalMs: 0, days: [], tasks: [], error: '' };
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(opts.start || '').trim();
  const end = String(opts.end || '').trim();
  if (!data || !dateRe.test(start) || !dateRe.test(end)) return { ...result, error: 'Pick a valid date range' };
  const rangeStart = new Date(`${start}T00:00:00`).getTime();
  const rangeEnd = timeNextDayMs(new Date(`${end}T00:00:00`).getTime());
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || rangeEnd <= rangeStart) {
    return { ...result, error: 'Pick a valid date range' };
  }

  const tasks = data.tasks || {};
  const lists = data.lists || {};
  const listOf = s => (tasks[s.taskId] ? tasks[s.taskId].checklist_id : s.listId);
  const byDay = new Map();
  const byTask = new Map();

  for (const s of Array.isArray(data.timeSessions) ? data.timeSessions : []) {
    const span = timeSessionMs(s);
    if (!span) continue;
    if (opts.scope === 'current' && listOf(s) !== opts.currentListId) continue;
    const from = Math.max(span.start, rangeStart);
    const to = Math.min(span.end, rangeEnd);
    if (to <= from) continue;

    for (let cur = from; cur < to;) {
      const next = Math.min(to, timeNextDayMs(cur));
      const day = timeYmd(cur);
      byDay.set(day, (byDay.get(day) || 0) + (next - cur));
      cur = next;
    }
    if (!byTask.has(s.taskId)) byTask.set(s.taskId, { ms: 0, session: s });
    byTask.get(s.taskId).ms += to - from;
    result.totalMs += to - from;
  }

  result.days = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, ms]) => ({ date, ms }));

  result.tasks = [...byTask.entries()].map(([taskId, { ms, session }]) => {
    const task = tasks[taskId];
    if (!task) {
      const listName = timeCleanTitle(session.listName || (lists[session.listId] || {}).name);
      const title = session.taskTitle || '(untitled)';
      return { taskId, title, crumb: [listName, title].filter(Boolean).join(' › '), listName, ms, removed: true };
    }
    const names = [];
    for (let cur = task, guard = 0; cur && guard < 100; guard++) {
      names.unshift(timeCleanTitle(cur.content) || '(untitled)');
      cur = tasks[cur.parent_id];
    }
    const listName = timeCleanTitle((lists[task.checklist_id] || {}).name || session.listName);
    return {
      taskId,
      title: names[names.length - 1],
      crumb: [listName, ...names].filter(Boolean).join(' › '),
      listName,
      ms,
      removed: !!task.deleted
    };
  }).sort((a, b) => b.ms - a.ms || a.crumb.localeCompare(b.crumb));

  return result;
}

// Drops sessions that ended more than retentionDays ago (0 keeps everything).
function pruneTimeSessionsDomain(state, retentionDays, nowMs) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days <= 0 || !Array.isArray(state.data.timeSessions)) return 0;
  const cutoff = timeNowMs(nowMs) - days * 24 * 60 * 60 * 1000;
  const before = state.data.timeSessions.length;
  state.data.timeSessions = state.data.timeSessions.filter(s => {
    const end = Date.parse(String(s && s.end || ''));
    return !Number.isFinite(end) || end >= cutoff;
  });
  return before - state.data.timeSessions.length;
}

// ── Timer state machine ─────────────────────────────────────────────

function normalizeTimerDomain(raw) {
  if (!raw || typeof raw !== 'object' || !raw.taskId) return null;
  const status = raw.status === 'paused' ? 'paused' : 'running';
  const num = v => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
  const timer = {
    taskId: String(raw.taskId),
    taskTitle: String(raw.taskTitle || ''),
    status,
    startedAt: num(raw.startedAt),
    lastConfirmedAt: num(raw.lastConfirmedAt),
    promptAt: num(raw.promptAt),
    autoPaused: null
  };
  if (raw.autoPaused && num(raw.autoPaused.from) !== null && num(raw.autoPaused.to) !== null) {
    timer.autoPaused = { from: num(raw.autoPaused.from), to: num(raw.autoPaused.to) };
  }
  if (status === 'running') {
    if (timer.startedAt === null) return null;
    if (timer.lastConfirmedAt === null) timer.lastConfirmedAt = timer.startedAt;
  }
  return timer;
}

function logRunningSessionDomain(app, state, endMs) {
  const timer = state.timer;
  if (!timer || timer.status !== 'running') return null;
  const end = Math.max(timer.startedAt, endMs);
  return addTimeSessionDomain(app, state, {
    taskId: timer.taskId, start: timer.startedAt, end, source: 'timer', taskTitle: timer.taskTitle
  });
}

// Starts timing a task; a timer running on another task is stopped (its time logged).
function startTimerDomain(app, state, taskId, nowMs) {
  const at = timeNowMs(nowMs);
  const task = state.data.tasks[taskId];
  if (!task || task.deleted) return { ok: false, error: 'Select a task to time' };
  if (Number(task.status || 0) !== 0) return { ok: false, error: 'Reopen the task to track time on it' };

  const prev = state.timer;
  if (prev && prev.status === 'running' && prev.taskId === taskId) return { ok: true, already: true, logged: null };
  const logged = prev && prev.status === 'running' ? logRunningSessionDomain(app, state, at) : null;
  const switchedFrom = prev && prev.taskId !== taskId ? prev.taskId : '';

  state.timer = {
    taskId,
    taskTitle: timeCleanTitle(task.content),
    status: 'running',
    startedAt: at,
    lastConfirmedAt: at,
    promptAt: null,
    autoPaused: null
  };
  app.saveTimer();
  return { ok: true, already: false, logged, switchedFrom };
}

// Logs the running session up to opts.endMs (default now). With opts.pause the
// task is remembered as paused so it can be resumed; otherwise the timer clears.
function stopTimerDomain(app, state, nowMs, options) {
  const opts = options || {};
  const timer = state.timer;
  if (!timer) return { stopped: false, logged: null, taskId: '' };
  const at = timeNowMs(nowMs);
  const endMs = Number.isFinite(opts.endMs) ? Math.min(opts.endMs, at) : at;
  const logged = logRunningSessionDomain(app, state, endMs);

  state.timer = opts.pause
    ? {
      taskId: timer.taskId,
      taskTitle: timer.taskTitle,
      status: 'paused',
      startedAt: null,
      lastConfirmedAt: null,
      promptAt: null,
      autoPaused: opts.autoPaused || null
    }
    : null;
  app.saveTimer();
  return { stopped: true, logged, taskId: timer.taskId };
}

function resumeTimerDomain(app, state, nowMs) {
  const timer = state.timer;
  if (!timer || timer.status !== 'paused') return { ok: false, error: 'No paused timer' };
  return startTimerDomain(app, state, timer.taskId, nowMs);
}

// 'none' | 'prompt' (a check-in is due/pending) | 'autopause' (it went
// unanswered past the grace period: time after the last confirmed check-in is
// not logged and the timer pauses with autoPaused = {from, to}).
function evaluateCheckInDomain(app, state, nowMs) {
  const timer = state.timer;
  if (!timer || timer.status !== 'running') return 'none';
  const at = timeNowMs(nowMs);
  const { checkInMs, graceMs } = timeSettingsDomain(state.data.settings);
  if (!checkInMs) {
    if (timer.promptAt !== null) {
      timer.promptAt = null;
      app.saveTimer();
    }
    return 'none';
  }

  const dueAt = timer.lastConfirmedAt + checkInMs;
  if (timer.promptAt === null) {
    if (at < dueAt) return 'none';
    timer.promptAt = dueAt;
    app.saveTimer();
  }

  if (graceMs && at >= timer.promptAt + graceMs) {
    const autoPaused = { from: timer.lastConfirmedAt, to: timer.promptAt };
    stopTimerDomain(app, state, at, { endMs: timer.lastConfirmedAt, pause: true, autoPaused });
    return 'autopause';
  }
  return 'prompt';
}

// answer: 'working' (confirm), 'keep' (pause, log until now) or 'drop' (pause,
// log only until the last confirmed check-in).
function answerCheckInDomain(app, state, answer, nowMs) {
  const timer = state.timer;
  if (!timer || timer.status !== 'running') return { ok: false, logged: null };
  const at = timeNowMs(nowMs);

  if (answer === 'working') {
    timer.lastConfirmedAt = at;
    timer.promptAt = null;
    app.saveTimer();
    return { ok: true, logged: null };
  }
  if (answer === 'keep' || answer === 'drop') {
    const endMs = answer === 'drop' ? timer.lastConfirmedAt : at;
    const res = stopTimerDomain(app, state, at, { endMs, pause: true });
    return { ok: true, logged: res.logged };
  }
  return { ok: false, logged: null };
}

// After an auto-pause the user says they were working all along: the timer runs
// again from where logging stopped, so the gap is counted in the next session.
function recoverAutoPauseDomain(app, state, nowMs) {
  const timer = state.timer;
  if (!timer || timer.status !== 'paused' || !timer.autoPaused) return { ok: false };
  const res = startTimerDomain(app, state, timer.taskId, nowMs);
  if (!res.ok) return res;
  state.timer.startedAt = Math.min(timer.autoPaused.from, state.timer.startedAt);
  app.saveTimer();
  return res;
}

function dismissAutoPauseDomain(app, state) {
  const timer = state.timer;
  if (!timer || !timer.autoPaused) return false;
  timer.autoPaused = null;
  app.saveTimer();
  return true;
}

// Why the timed task can no longer be timed ('' while it is still open).
function timerTaskClosedReasonDomain(state) {
  const timer = state.timer;
  if (!timer) return '';
  const task = state.data.tasks[timer.taskId];
  if (!task) return 'removed';
  if (task.deleted) return 'deleted';
  const status = Number(task.status || 0);
  if (status === 1) return 'completed';
  if (status === 2) return 'invalidated';
  // Completing a recurring task re-opens it at once; completed_at still moves.
  const doneMs = Date.parse(String(task.completed_at || ''));
  if (timer.status === 'running' && Number.isFinite(doneMs) && doneMs >= timer.startedAt) return 'completed';
  return '';
}

// Stops (and forgets) the timer once its task is completed, invalidated or
// deleted, however that happened. A completion ends the session at completed_at.
function autoStopTimerDomain(app, state, nowMs) {
  const reason = timerTaskClosedReasonDomain(state);
  if (!reason) return null;
  const at = timeNowMs(nowMs);
  const task = state.data.tasks[state.timer.taskId];
  const doneMs = task ? Date.parse(String(task.completed_at || '')) : NaN;
  const endMs = reason === 'completed' && Number.isFinite(doneMs) ? Math.min(doneMs, at) : at;
  const res = stopTimerDomain(app, state, at, { endMs });
  return { reason, logged: res.logged, taskId: res.taskId };
}
