'use strict';

// Time tracking UI: a 1s ticker drives the timer rules from
// domain/time-tracking-ops.js and keeps the status bar, tab title, task-row
// chips, check-in dialog and time log current without re-rendering the list.

const TIME_TICK_MS = 1000;

function startTimeTrackingUi(app, state) {
  state.timer = normalizeTimerDomain(DB.getTimer());
  state.baseTitle = state.baseTitle || document.title || 'MonkeyGTD';
  if (state.timeTickTimer) clearInterval(state.timeTickTimer);
  state.timeTickTimer = setInterval(() => timeTickUi(app, state), TIME_TICK_MS);
  if (!state.timeListenersBound && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => timeTickUi(app, state));
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('focus', () => timeTickUi(app, state));
    }
    state.timeListenersBound = true;
  }
  timeTickUi(app, state);
}

function timeTaskLabelUi(state, timer, max) {
  const task = timer ? state.data.tasks[timer.taskId] : null;
  const title = timeCleanTitle(task ? task.content : (timer && timer.taskTitle)) || '(untitled)';
  const limit = max || 40;
  return title.length > limit ? `${title.slice(0, limit - 1)}…` : title;
}

function timeClockUi(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function timeWeekdayUi(ymd) {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(`${ymd}T00:00:00`).getDay()] || '';
}

function isOverlayOpenUi(id) {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
}

function timerCheckInKeyUi(timer) {
  if (!timer) return '';
  if (timer.status === 'running' && timer.promptAt !== null) return `prompt:${timer.promptAt}`;
  if (timer.status === 'paused' && timer.autoPaused) return `auto:${timer.autoPaused.from}`;
  return '';
}

function timeTickUi(app, state, nowMs) {
  if (!state.data) return;
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();

  if (state.timer) {
    const wasRunning = state.timer.status === 'running';
    const closed = autoStopTimerDomain(app, state, at);
    if (closed) {
      if (wasRunning) app.toast(`Timer stopped - task ${closed.reason} (${loggedTextUi(closed.logged)})`);
      if (isOverlayOpenUi('ov-checkin')) app.closeModal('ov-checkin');
      refreshTimerUi(app, state, at, { render: false });
      return;
    }

    const verdict = evaluateCheckInDomain(app, state, at);
    const key = timerCheckInKeyUi(state.timer);
    if (key && state.checkInShownFor !== key) {
      state.checkInShownFor = key;
      const title = timeTaskLabelUi(state, state.timer, 60);
      openCheckInUi(app, state, at);
      if (verdict === 'autopause') {
        notifyTimerUi(app, state, 'Timer paused', `No answer to the check-in - "${title}" was paused.`);
        refreshTimerUi(app, state, at, { render: false });
        return;
      }
      notifyTimerUi(app, state, 'Still working?', `Are you still working on "${title}"?`);
    } else if (isOverlayOpenUi('ov-checkin')) {
      renderCheckInUi(app, state, at, { actions: false });
    }
  }

  updateTimerChromeUi(app, state, at);
  if (isOverlayOpenUi('ov-timelog') && state.timer && state.timer.status === 'running' && state.timer.taskId === state.timeLogTaskId) {
    renderTimeLogSummaryUi(app, state, at);
  }
}

// Status bar, tab title and (once a minute) the task-row chips.
function updateTimerChromeUi(app, state, nowMs, force) {
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const timer = state.timer;
  const sb = document.getElementById('sb-timer');
  const pending = !!timerCheckInKeyUi(timer);

  if (sb) {
    const key = timer ? `${timer.status}:${timer.taskId}:${pending}` : '';
    if (force || key !== state.sbTimerKey) {
      state.sbTimerKey = key;
      sb.style.display = timer ? '' : 'none';
      const title = esc(timeTaskLabelUi(state, timer, 30));
      const alert = pending ? '<span class="sbt-alert" onclick="App.openCheckIn()" title="Answer the check-in">⏰ Check-in</span>' : '';
      if (!timer) {
        sb.innerHTML = '';
      } else if (timer.status === 'running') {
        sb.className = 'sbi sb-timer running';
        sb.innerHTML = `<span class="sbt-main click" onclick="App.jumpToTimedTask()" title="Jump to the timed task">⏱ <span id="sb-timer-clock"></span> · ${title}</span>${alert}<span class="sbt-stop click" onclick="App.stopTimer()" title="Stop timer">■</span>`;
      } else {
        sb.className = 'sbi sb-timer paused';
        sb.innerHTML = `<span class="sbt-main click" onclick="App.resumeTimer()" title="Resume timer">⏸ ${title} · resume</span>${alert}<span class="sbt-stop click" onclick="App.stopTimer()" title="Clear paused timer">✕</span>`;
      }
    }
    const clock = document.getElementById('sb-timer-clock');
    if (clock && timer && timer.status === 'running') {
      clock.textContent = formatDurationDomain(timerElapsedDomain(timer, at), { clock: true });
    }
  }

  const base = state.baseTitle || 'MonkeyGTD';
  let title = base;
  if (pending && Math.floor(at / 1000) % 2 === 0) title = timer.status === 'running' ? '⏰ Still working?' : '⏰ Timer paused';
  else if (timer && timer.status === 'running') {
    const clock = formatDurationDomain(timerElapsedDomain(timer, at), { clock: true }).replace(/:\d\d$/, '');
    title = `⏱ ${clock} ${timeTaskLabelUi(state, timer, 30)}`;
  } else if (timer) title = `⏸ ${base}`;
  if (document.title !== title) document.title = title;

  const minute = timer && timer.status === 'running' ? Math.floor(timerElapsedDomain(timer, at) / 60000) : -1;
  if (force || minute !== state.timeChipMinute) {
    state.timeChipMinute = minute;
    updateTimeChipsUi(app, state, at);
  }
}

function updateTimeChipsUi(app, state, nowMs) {
  if (typeof document.querySelectorAll !== 'function') return;
  const chips = document.querySelectorAll('.ttime[data-id]');
  if (!chips.length) return;
  let totals;
  try { totals = app.select('time.totals', { nowMs }); } catch { return; }
  chips.forEach(chip => {
    const model = timeChipModelUi(state, totals, chip.dataset.id);
    if (!model.show) {
      chip.remove();
      return;
    }
    if (chip.textContent !== model.label) chip.textContent = model.label;
    chip.className = `ttime${model.cls}`;
    chip.title = model.title;
  });
}

// After a timer change: forget cached chrome state and repaint.
function refreshTimerUi(app, state, nowMs, options) {
  const opts = options || {};
  if (!timerCheckInKeyUi(state.timer)) closeTimerNotificationUi(state);
  state.sbTimerKey = null;
  if (opts.render !== false) app.render();
  updateTimerChromeUi(app, state, nowMs, true);
  if (isOverlayOpenUi('ov-timelog')) renderTimeLogUi(app, state, nowMs);
}

function loggedTextUi(session) {
  const span = session ? timeSessionMs(session) : null;
  return span ? `logged ${formatDurationDomain(span.end - span.start)}` : 'under 1 min, not logged';
}

// ── Start / stop ────────────────────────────────────────────────────

function startTimerUi(app, state, taskId) {
  const before = state.timer;
  const res = app.dispatch('time.start', { taskId });
  if (!res || !res.ok) {
    app.toast((res && res.error) || 'Select a task to time');
    return false;
  }
  if (!res.already) {
    const title = timeTaskLabelUi(state, state.timer);
    if (res.switchedFrom && before && before.status === 'running') {
      app.toast(`Timer switched to "${title}" (${loggedTextUi(res.logged)} on the previous task)`);
    } else {
      app.toast(`Timer started: "${title}"`);
    }
  }
  refreshTimerUi(app, state);
  return true;
}

function stopTimerUi(app, state) {
  const timer = state.timer;
  if (!timer) {
    app.toast('No timer running');
    return;
  }
  const title = timeTaskLabelUi(state, timer);
  const res = app.dispatch('time.stop', {});
  app.toast(timer.status === 'running'
    ? `Timer stopped: ${loggedTextUi(res && res.logged)} on "${title}"`
    : 'Paused timer cleared');
  if (isOverlayOpenUi('ov-checkin')) app.closeModal('ov-checkin');
  refreshTimerUi(app, state);
}

function resumeTimerUi(app, state) {
  const timer = state.timer;
  if (!timer || timer.status !== 'paused') {
    app.toast(timer ? 'Timer is already running' : 'No paused timer');
    return;
  }
  const res = app.dispatch('time.resume', {});
  if (!res || !res.ok) {
    app.toast((res && res.error) || 'Could not resume the timer');
    return;
  }
  if (isOverlayOpenUi('ov-checkin')) app.closeModal('ov-checkin');
  app.toast(`Timer resumed: "${timeTaskLabelUi(state, state.timer)}"`);
  refreshTimerUi(app, state);
}

// ts: start on the selected task, stop it if it is the one running, resume it if paused.
function toggleTimerSelectionUi(app, state) {
  const taskId = state.selId;
  const task = taskId ? state.data.tasks[taskId] : null;
  if (!task || task.deleted) {
    app.toast('Select a task to time');
    return;
  }
  const timer = state.timer;
  if (timer && timer.taskId === taskId) {
    if (timer.status === 'running') stopTimerUi(app, state);
    else resumeTimerUi(app, state);
    return;
  }
  startTimerUi(app, state, taskId);
}

function jumpToTimedTaskUi(app, state) {
  const timer = state.timer;
  const task = timer ? state.data.tasks[timer.taskId] : null;
  if (!task || task.deleted) {
    app.toast('No timed task');
    return;
  }
  app.jumpTo(task.id);
}

// ── Check-in dialog ─────────────────────────────────────────────────

function openCheckInUi(app, state, nowMs) {
  if (!timerCheckInKeyUi(state.timer)) {
    app.toast('No check-in pending');
    return;
  }
  renderCheckInUi(app, state, nowMs, { actions: true });
  app.openModal('ov-checkin');
  if (!state.editId) {
    setTimeout(() => {
      const btn = document.getElementById('checkin-primary');
      if (btn && typeof btn.focus === 'function') btn.focus();
    }, 50);
  }
}

function renderCheckInUi(app, state, nowMs, options) {
  const opts = options || {};
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const timer = state.timer;
  const titleEl = document.getElementById('checkin-title');
  const bodyEl = document.getElementById('checkin-body');
  const actionsEl = document.getElementById('checkin-actions');
  if (!timer || !bodyEl) return;
  const task = `<strong>${esc(timeTaskLabelUi(state, timer, 80))}</strong>`;
  const { graceMs } = timeSettingsDomain(state.data.settings);

  if (timer.status === 'running' && timer.promptAt !== null) {
    if (titleEl) titleEl.textContent = 'Still working?';
    const waited = at - timer.promptAt;
    const lines = [
      `<p class="checkin-q">Still working on ${task}?</p>`,
      `<p class="checkin-meta">Timer running for ${formatDurationDomain(timerElapsedDomain(timer, at))} · last check-in at ${timeClockUi(timer.lastConfirmedAt)} (${formatDurationDomain(at - timer.lastConfirmedAt)} ago)</p>`
    ];
    if (waited >= 60000) lines.push(`<p class="checkin-meta">This check-in has been waiting ${formatDurationDomain(waited)}.</p>`);
    if (graceMs) lines.push(`<p class="checkin-meta">No answer by ${timeClockUi(timer.promptAt + graceMs)} pauses the timer and drops the time after ${timeClockUi(timer.lastConfirmedAt)}.</p>`);
    bodyEl.innerHTML = lines.join('');
    if (opts.actions && actionsEl) {
      actionsEl.innerHTML = [
        `<button class="btn" onclick="App.answerCheckIn('drop')" title="Pause and log time only up to the last check-in">Pause - drop time since ${timeClockUi(timer.lastConfirmedAt)}</button>`,
        '<button class="btn" onclick="App.answerCheckIn(\'keep\')" title="Pause and log all time until now">Pause - keep all time</button>',
        '<button class="btn btn-p" id="checkin-primary" onclick="App.answerCheckIn(\'working\')">Yes, still on it</button>'
      ].join('');
    }
    return;
  }

  if (timer.status === 'paused' && timer.autoPaused) {
    if (titleEl) titleEl.textContent = 'Timer paused';
    const { from, to } = timer.autoPaused;
    bodyEl.innerHTML = [
      `<p class="checkin-q">${task} was paused at ${timeClockUi(from)}.</p>`,
      `<p class="checkin-meta">The ${timeClockUi(to)} check-in went unanswered, so time after ${timeClockUi(from)} (the last check-in) was not logged.</p>`
    ].join('');
    if (opts.actions && actionsEl) {
      actionsEl.innerHTML = [
        '<button class="btn" onclick="App.answerCheckIn(\'stay\')">Stay paused</button>',
        '<button class="btn" onclick="App.resumeTimer()" title="Start a new session from now">Resume</button>',
        `<button class="btn btn-p" id="checkin-primary" onclick="App.answerCheckIn('recover')" title="Count ${timeClockUi(from)} until now and keep the timer running">I was working - add ${timeClockUi(from)} → now</button>`
      ].join('');
    }
  }
}

// answer: 'working' | 'keep' | 'drop' (check-in) or 'recover' | 'stay' (after an auto-pause).
function answerCheckInUi(app, state, answer) {
  const timer = state.timer;
  if (!timer) {
    app.closeModal('ov-checkin');
    return;
  }
  const title = timeTaskLabelUi(state, timer);

  if (answer === 'recover') {
    const from = timer.autoPaused ? timer.autoPaused.from : null;
    const res = app.dispatch('time.recoverAutoPause', {});
    if (res && res.ok) app.toast(`Timer running again on "${title}" from ${timeClockUi(from)}`);
    else app.toast((res && res.error) || 'Could not resume the timer');
  } else if (answer === 'stay') {
    app.dispatch('time.dismissAutoPause', {});
  } else {
    const res = app.dispatch('time.answerCheckIn', { answer });
    if (res && res.ok && answer !== 'working') {
      app.toast(`Paused "${title}": ${loggedTextUi(res.logged)}${answer === 'drop' ? ' (time since the last check-in dropped)' : ''}`);
    }
  }

  state.checkInShownFor = timerCheckInKeyUi(state.timer) || null;
  app.closeModal('ov-checkin');
  refreshTimerUi(app, state, undefined, { render: false });
}

function notifyTimerUi(app, state, title, body) {
  const s = state.data.settings || {};
  const away = document.hidden || (typeof document.hasFocus === 'function' && !document.hasFocus());
  if (!s.timerNotify || !away) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    closeTimerNotificationUi(state);
    const n = new Notification(title, { body, tag: 'mgtd-checkin', requireInteraction: true });
    n.onclick = () => {
      try { window.focus(); } catch {}
      n.close();
      if (timerCheckInKeyUi(state.timer)) app.openCheckIn();
    };
    state.timerNotification = n;
  } catch {}
}

function closeTimerNotificationUi(state) {
  if (!state.timerNotification) return;
  try { state.timerNotification.close(); } catch {}
  state.timerNotification = null;
}

function setTimerNotifyUi(app, state, value) {
  const revert = msg => {
    setSettingDomain(app, state, 'timerNotify', false);
    app.syncSettings();
    if (msg) app.toast(msg);
  };
  if (!value) {
    revert('');
    return;
  }
  if (typeof Notification === 'undefined') {
    revert('Desktop notifications are not supported here (they need https or localhost)');
    return;
  }
  const enable = () => {
    setSettingDomain(app, state, 'timerNotify', true);
    app.syncSettings();
    app.toast('Check-ins will also show as desktop notifications');
  };
  if (Notification.permission === 'granted') {
    enable();
    return;
  }
  if (Notification.permission === 'denied') {
    revert('Notifications are blocked for this site - allow them in the browser settings');
    return;
  }
  Promise.resolve(Notification.requestPermission())
    .then(p => (p === 'granted' ? enable() : revert('Notification permission was not granted')))
    .catch(() => revert('Notification permission was not granted'));
}

// ── Time log dialog ─────────────────────────────────────────────────

function openTimeLogUi(app, state, taskId) {
  const id = taskId || state.selId;
  const task = id ? state.data.tasks[id] : null;
  if (!task || task.deleted) {
    app.toast('Select a task to see its time log');
    return;
  }
  state.timeLogTaskId = id;
  const durEl = document.getElementById('timelog-dur');
  const dateEl = document.getElementById('timelog-date');
  if (durEl) durEl.value = '';
  if (dateEl) {
    dateEl.value = todayS();
    dateEl.max = todayS();
  }
  renderTimeLogUi(app, state);
  app.openModal('ov-timelog');
  setTimeout(() => { if (durEl && typeof durEl.focus === 'function') durEl.focus(); }, 50);
}

function renderTimeLogUi(app, state, nowMs) {
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const taskId = state.timeLogTaskId;
  const task = taskId ? state.data.tasks[taskId] : null;
  const taskEl = document.getElementById('timelog-task');
  if (taskEl) taskEl.textContent = task ? (timeCleanTitle(task.content) || '(untitled)') : '';
  renderTimeLogSummaryUi(app, state, at);

  const listEl = document.getElementById('timelog-list');
  if (listEl) {
    const sessions = app.select('time.sessionsForTask', { taskId });
    listEl.innerHTML = sessions.length
      ? sessions.map(s => {
        const span = timeSessionMs(s);
        const day = timeYmd(span.start);
        return `<div class="tl-row">
          <span class="tl-date">${timeWeekdayUi(day)} ${day.slice(5)}</span>
          <span class="tl-span">${timeClockUi(span.start)}–${timeClockUi(span.end)}</span>
          <span class="tl-dur">${formatDurationDomain(span.end - span.start)}</span>
          <span class="tl-src">${s.source === 'manual' ? 'manual' : 'timer'}</span>
          <span class="tl-del" onclick="App.deleteTimeSession('${esc(s.id)}')" title="Delete this session">✕</span>
        </div>`;
      }).join('')
      : '<div class="tl-empty">No time logged yet. Start the timer (ts) or add time above.</div>';
  }

  const toggle = document.getElementById('timelog-toggle');
  if (toggle) {
    const timer = state.timer;
    const mine = timer && timer.taskId === taskId;
    toggle.textContent = mine && timer.status === 'running' ? 'Stop timer' : (mine ? 'Resume timer' : 'Start timer');
  }
}

function renderTimeLogSummaryUi(app, state, nowMs) {
  const el = document.getElementById('timelog-summary');
  const taskId = state.timeLogTaskId;
  if (!el || !taskId) return;
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const sum = app.select('time.taskSummary', { taskId, nowMs: at });
  const stat = (label, ms) => `<div class="tl-stat"><div class="tl-stat-v">${formatDurationDomain(ms)}</div><div class="tl-stat-l">${label}</div></div>`;
  const stats = [stat('Total', sum.ownMs)];
  if (sum.rolledMs > sum.ownMs) stats.push(stat('With sub-tasks', sum.rolledMs));
  stats.push(stat('Today', sum.todayMs), stat('This week', sum.weekMs));
  const timer = state.timer;
  const running = timer && timer.taskId === taskId && timer.status === 'running'
    ? `<div class="tl-running">● Running since ${timeClockUi(timer.startedAt)} (${formatDurationDomain(timerElapsedDomain(timer, at), { clock: true })})</div>`
    : '';
  el.innerHTML = `<div class="tl-stats">${stats.join('')}</div>${running}`;
}

function toggleTimerForLogUi(app, state) {
  const taskId = state.timeLogTaskId;
  if (!taskId) return;
  const timer = state.timer;
  if (timer && timer.taskId === taskId) {
    if (timer.status === 'running') stopTimerUi(app, state);
    else resumeTimerUi(app, state);
    return;
  }
  startTimerUi(app, state, taskId);
}

function addManualTimeUi(app, state) {
  const taskId = state.timeLogTaskId;
  const durEl = document.getElementById('timelog-dur');
  const dateEl = document.getElementById('timelog-date');
  const raw = durEl ? durEl.value : '';
  const durationMs = parseDurationDomain(raw);
  if (!durationMs) {
    app.toast('Enter a duration like 25m, 1h30 or 1:15');
    return;
  }
  const res = app.dispatch('time.addManual', { taskId, durationMs, date: dateEl ? dateEl.value : '' });
  if (!res || res.error) {
    app.toast((res && res.error) || 'Could not add time');
    return;
  }
  if (durEl) durEl.value = '';
  app.toast(`Added ${formatDurationDomain(durationMs)}`);
  app.render();
  renderTimeLogUi(app, state);
  updateTimerChromeUi(app, state, undefined, true);
}

function deleteTimeSessionUi(app, state, sessionId) {
  const session = (state.data.timeSessions || []).find(s => s && s.id === sessionId);
  const span = session ? timeSessionMs(session) : null;
  if (!span) return;
  const day = timeYmd(span.start);
  if (!confirm(`Delete the ${formatDurationDomain(span.end - span.start)} session on ${day} (${timeClockUi(span.start)}–${timeClockUi(span.end)})? This cannot be undone.`)) return;
  if (!app.dispatch('time.deleteSession', { sessionId })) return;
  app.toast('Time session deleted');
  app.render();
  renderTimeLogUi(app, state);
  updateTimerChromeUi(app, state, undefined, true);
}

// ── Reporting page ──────────────────────────────────────────────────

function setReportTodayUi(app, state) {
  state.reportStart = todayS();
  state.reportEnd = state.reportStart;
  const startEl = document.getElementById('report-start');
  const endEl = document.getElementById('report-end');
  if (startEl) startEl.value = state.reportStart;
  if (endEl) endEl.value = state.reportEnd;
  app.renderReport();
}

// Renders the "Time tracked" panel; returns task id -> ms for the row badges.
function renderReportTimeUi(app, state, start, end) {
  const el = document.getElementById('report-time');
  const scopeEl = document.getElementById('report-export-scope');
  const scope = scopeEl && scopeEl.value === 'current' ? 'current' : 'all';
  let report;
  try { report = app.select('time.report', { start, end, scope }); } catch { return {}; }
  const byTask = {};
  for (const t of report.tasks || []) byTask[t.taskId] = t.ms;
  if (!el) return byTask;
  if (report.error) {
    el.innerHTML = '';
    return byTask;
  }

  const scopeLabel = scope === 'current' ? 'current list' : 'all lists';
  const head = `<div class="rt-head">⏱ Time tracked <span class="rt-total">${formatDurationDomain(report.totalMs)}</span><span class="rt-scope">${scopeLabel}</span></div>`;
  if (!report.totalMs) {
    el.innerHTML = `${head}<div class="rt-empty">No time tracked in this period. Select a task and press ts to start a timer.</div>`;
    return byTask;
  }

  const maxDay = Math.max(...report.days.map(d => d.ms));
  const days = report.days.length > 1
    ? `<div class="rt-days">${report.days.map(d => `<div class="rt-day">
        <span class="rt-dl">${timeWeekdayUi(d.date)} ${d.date.slice(5)}</span>
        <span class="rt-bar"><span style="width:${Math.max(2, Math.round((d.ms / maxDay) * 100))}%"></span></span>
        <span class="rt-dv">${formatDurationDomain(d.ms)}</span>
      </div>`).join('')}</div>`
    : '';
  const tasks = report.tasks.slice(0, 50).map(t => {
    const live = !t.removed && state.data.tasks[t.taskId];
    return `<div class="rt-task${live ? ' click' : ''}"${live ? ` onclick="App.jumpTo('${esc(t.taskId)}')"` : ''}>
      <span class="rt-tn">${esc(t.crumb)}${t.removed ? ' <span class="rt-removed">removed</span>' : ''}</span>
      <span class="rt-tv">${formatDurationDomain(t.ms)}</span>
    </div>`;
  }).join('');
  const more = report.tasks.length > 50 ? `<div class="rt-empty">+${report.tasks.length - 50} more</div>` : '';
  el.innerHTML = `${head}${days}<div class="rt-tasks">${tasks}${more}</div>`;
  return byTask;
}
