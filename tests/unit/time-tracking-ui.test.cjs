const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function loadScripts(files, exportsList, globals = {}) {
  const sandbox = { console, JSON, Math, Date, Promise, setTimeout, clearTimeout, ...globals };
  vm.createContext(sandbox);
  for (const rel of files) vm.runInContext(read(rel), sandbox, { filename: rel });
  vm.runInContext(`globalThis.__exports = { ${exportsList.join(', ')} };`, sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

const MIN = 60 * 1000;

// ── Keyboard ─────────────────────────────────────────────────────────

test('ts toggles the timer and tl opens the time log for the selected task', () => {
  const { handleTwoKeySequence } = loadScripts(['js/ui/keyboard-controller.js'], ['handleTwoKeySequence'], {
    document: { getElementById: () => ({ classList: { contains: () => true } }) }
  });
  const calls = [];
  const app = {
    showKH: () => {},
    clearKH: () => {},
    toggleTimerSelection: () => calls.push('ts'),
    openTimeLog: id => calls.push(`tl:${id}`),
    addTagSelection: () => calls.push('tt')
  };
  const state = { selId: 'a', kbuf: '', kbtimer: null, msel: new Set(), data: { settings: {} } };
  const press = key => handleTwoKeySequence(app, state, { key, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => {} });

  press('t'); press('s');
  press('t'); press('l');
  press('t'); press('t');

  assert.deepEqual(calls, ['ts', 'tl:a', 'tt']);
});

test('shortcuts are suspended while the time log or check-in dialog is open', () => {
  for (const open of ['ov-timelog', 'ov-checkin']) {
    const { handleGlobalKey } = loadScripts(['js/ui/keyboard-controller.js'], ['handleGlobalKey'], {
      document: {
        activeElement: null,
        getElementById: id => ({ classList: { contains: () => id !== open } })
      }
    });
    const calls = [];
    const app = { closeAll: () => calls.push('closeAll'), twoKey: () => calls.push('twoKey') };
    const state = { selId: 'a', editId: null, kbuf: '', msel: new Set(), data: { settings: {} } };

    handleGlobalKey(app, state, { key: 't', preventDefault: () => {} });
    handleGlobalKey(app, state, { key: 'Escape', preventDefault: () => {} });
    assert.deepEqual(calls, ['closeAll'], open);
  }
});

// ── Command palette & help ───────────────────────────────────────────

test('timer commands are in the command palette', () => {
  const { buildCommandPaletteItems } = loadScripts(['js/ui/command-palette-commands.js'], ['buildCommandPaletteItems']);
  const calls = [];
  const app = new Proxy({ select: () => [] }, {
    get: (target, prop) => (prop in target ? target[prop] : () => calls.push(prop))
  });
  const items = buildCommandPaletteItems(app, { data: { settings: {} }, msel: new Set() });
  const byLabel = label => items.find(i => i.l === label);

  for (const [label, method] of [
    ['Start/stop timer', 'toggleTimerSelection'],
    ['Time log', 'openTimeLog'],
    ['Stop timer', 'stopTimer'],
    ['Resume timer', 'resumeTimer'],
    ['Jump to timed task', 'jumpToTimedTask']
  ]) {
    assert.ok(byLabel(label), label);
    byLabel(label).fn();
    assert.equal(calls.at(-1), method, label);
  }
  assert.equal(byLabel('Start/stop timer').s, 'ts');
  assert.equal(byLabel('Time log').s, 'tl');
});

test('the shortcuts help lists ts and tl', () => {
  const src = read('js/ui/utilities-controller.js');
  assert.match(src, /\['ts', 'Start \/ stop \/ resume timer on selected task'\]/);
  assert.match(src, /\['tl', 'Time log of selected task/);
});

// ── Task row chip ────────────────────────────────────────────────────

function loadRender() {
  return loadScripts(['js/domain/time-tracking-ops.js', 'js/ui/render-controller.js'], ['buildTaskItemUi', 'readTimeTotalsUi'], {
    md: s => s,
    esc: s => String(s),
    getDueCls: () => '',
    fmtDue: () => '',
    document: { getElementById: () => null, querySelectorAll: () => [] },
    requestAnimationFrame: fn => fn()
  });
}

function renderState(extra) {
  return {
    data: {
      settings: { showTaskJsonChip: false, showTaskHistoryChip: false },
      tasks: { t1: { id: 't1', content: 'Task one', status: 0, color: 0, tasks: [], tags_as_text: '', assignees: [], comments_count: 0, created_at: '', updated_at: '' } },
      lists: { l1: { id: 'l1', style: 'none', root_tasks: ['t1'] } }
    },
    selId: null, msel: new Set(), editId: null, filter: '', showNotes: false, timer: null, timeTotals: null,
    ...extra
  };
}

test('a task row shows its tracked time (with sub-tasks) as a chip that opens the time log', () => {
  const { buildTaskItemUi } = loadRender();
  const app = {};
  const list = { style: 'none' };

  const none = buildTaskItemUi(app, renderState({ timeTotals: { own: {}, rolled: {} } }), 't1', 0, list);
  assert.equal(none.includes('ttime'), false);

  const notLoaded = buildTaskItemUi(app, renderState(), 't1', 0, list);
  assert.equal(notLoaded.includes('ttime'), false);

  const html = buildTaskItemUi(app, renderState({ timeTotals: { own: { t1: 25 * MIN }, rolled: { t1: 85 * MIN } } }), 't1', 0, list);
  assert.match(html, /<span class="ttime" data-id="t1" data-a="time" title="Own: 25m · With sub-tasks: 1h 25m · Click for the time log \(tl\)">⏱ 1h 25m<\/span>/);

  const running = buildTaskItemUi(app, renderState({
    timeTotals: { own: {}, rolled: {} },
    timer: { taskId: 't1', status: 'running', startedAt: 0 }
  }), 't1', 0, list);
  assert.match(running, /class="ttime running"[^>]*>● 0m</);

  const paused = buildTaskItemUi(app, renderState({
    timeTotals: { own: { t1: 5 * MIN }, rolled: { t1: 5 * MIN } },
    timer: { taskId: 't1', status: 'paused' }
  }), 't1', 0, list);
  assert.match(paused, /class="ttime paused"[^>]*>⏸ 5m</);
});

test('readTimeTotalsUi returns null when the time query is unavailable', () => {
  const { readTimeTotalsUi } = loadRender();
  assert.equal(readTimeTotalsUi({ select: () => { throw new Error('No query resolver registered'); } }), null);
  assert.deepEqual(readTimeTotalsUi({ select: (name, p) => ({ name, p }) }).name, 'time.totals');
});

// ── Desktop notification setting ─────────────────────────────────────

function loadNotifySetting(Notification) {
  const globals = {
    document: { getElementById: () => null },
    setSettingDomain: (app, state, key, value) => { state.data.settings[key] = value; }
  };
  if (Notification) globals.Notification = Notification;
  const { setTimerNotifyUi } = loadScripts(['js/ui/time-tracking-controller.js'], ['setTimerNotifyUi'], globals);
  const toasts = [];
  const app = { toast: m => toasts.push(m), syncSettings: () => {} };
  const state = { data: { settings: {} } };
  return { setTimerNotifyUi, app, state, toasts };
}

test('turning on desktop notifications asks for permission and reverts when refused', async () => {
  const unsupported = loadNotifySetting(null);
  unsupported.setTimerNotifyUi(unsupported.app, unsupported.state, true);
  assert.equal(unsupported.state.data.settings.timerNotify, false);
  assert.match(unsupported.toasts[0], /not supported/);

  const denied = loadNotifySetting({ permission: 'denied' });
  denied.setTimerNotifyUi(denied.app, denied.state, true);
  assert.equal(denied.state.data.settings.timerNotify, false);
  assert.match(denied.toasts[0], /blocked/);

  const asks = [];
  const granted = loadNotifySetting({ permission: 'default', requestPermission: () => { asks.push(1); return Promise.resolve('granted'); } });
  granted.setTimerNotifyUi(granted.app, granted.state, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(asks.length, 1);
  assert.equal(granted.state.data.settings.timerNotify, true);

  const refused = loadNotifySetting({ permission: 'default', requestPermission: () => Promise.resolve('default') });
  refused.setTimerNotifyUi(refused.app, refused.state, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(refused.state.data.settings.timerNotify, false);

  granted.setTimerNotifyUi(granted.app, granted.state, false);
  assert.equal(granted.state.data.settings.timerNotify, false);
});

// ── Wiring in app.html ───────────────────────────────────────────────

test('app.html wires the status bar slot, dialogs, report panel and settings', () => {
  const html = read('app.html');
  for (const id of ['sb-timer', 'ov-timelog', 'ov-checkin', 'checkin-body', 'checkin-actions', 'timelog-dur', 'timelog-date', 'timelog-list', 'report-time', 'report-incl-time', 's-timer-checkin', 's-timer-grace', 's-timer-notify', 's-time-retention']) {
    assert.match(html, new RegExp(`id="${id}"`), id);
  }
  assert.match(html, /onclick="App\.setReportToday\(\)"/);
  assert.match(html, /id="report-export-scope" onchange="App\.renderReport\(\)"/);
});
