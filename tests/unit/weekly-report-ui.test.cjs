const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

function pad2(n) {
  return String(n).padStart(2, '0');
}
function localDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function loadController({ elements = {}, clipboard, created = [] } = {}) {
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    Number,
    encodeURIComponent,
    dateStr: (d = new Date()) => localDateStr(d),
    todayS: () => localDateStr(new Date()),
    document: {
      getElementById: id => elements[id] || null,
      createElement: () => {
        const a = { clicked: false, click() { a.clicked = true; } };
        created.push(a);
        return a;
      }
    },
    navigator: { clipboard }
  };
  vm.createContext(sandbox);
  vm.runInContext(
    `${read('js/ui/report-export-controller.js')}; globalThis.__exports = { setReportLastDaysUi, copyWeeklyReportUi, downloadWeeklyReportUi, readReportExportOptions };`,
    sandbox,
    { filename: 'report-export-controller.js' }
  );
  return sandbox.__exports;
}

function makeApp(result) {
  const calls = { toast: [], select: [], render: 0 };
  return {
    calls,
    toast: msg => calls.toast.push(msg),
    renderReport: () => { calls.render++; },
    select: (name, payload) => {
      calls.select.push({ name, payload });
      return result;
    }
  };
}

const okResult = {
  text: '# Weekly Activity Export\n',
  counts: { done: 3, new: 2, edited: 1, dropped: 0, reopened: 0, newLists: 0 },
  error: ''
};

test('setReportLastDaysUi sets the range to the last N days ending today and re-renders', () => {
  const elements = {
    'report-days': { value: '14' },
    'report-start': { value: '' },
    'report-end': { value: '' }
  };
  const { setReportLastDaysUi } = loadController({ elements });
  const app = makeApp(okResult);
  const state = { reportStart: '', reportEnd: '' };

  setReportLastDaysUi(app, state);

  const expectedStart = new Date();
  expectedStart.setDate(expectedStart.getDate() - 14);
  assert.equal(state.reportStart, localDateStr(expectedStart));
  assert.equal(state.reportEnd, localDateStr(new Date()));
  assert.equal(elements['report-start'].value, state.reportStart);
  assert.equal(elements['report-end'].value, state.reportEnd);
  assert.equal(app.calls.render, 1);
});

test('setReportLastDaysUi rejects empty, zero, negative and oversized values', () => {
  for (const bad of ['', '0', '-3', '400', 'abc']) {
    const elements = { 'report-days': { value: bad } };
    const { setReportLastDaysUi } = loadController({ elements });
    const app = makeApp(okResult);
    const state = { reportStart: '2026-01-01', reportEnd: '2026-01-08' };

    setReportLastDaysUi(app, state);

    assert.equal(state.reportStart, '2026-01-01', `start unchanged for "${bad}"`);
    assert.equal(app.calls.render, 0);
    assert.equal(app.calls.toast.length, 1);
  }
});

test('copyWeeklyReportUi sends the page options to report.weekly and copies the result', async () => {
  const written = [];
  const elements = {
    'report-start': { value: '2026-06-01' },
    'report-end': { value: '2026-06-08' },
    'report-export-scope': { value: 'current' },
    'report-incl-prompt': { checked: false },
    'report-incl-upcoming': { checked: true }
  };
  const { copyWeeklyReportUi } = loadController({
    elements,
    clipboard: { writeText: text => { written.push(text); return Promise.resolve(); } }
  });
  const app = makeApp(okResult);

  copyWeeklyReportUi(app, { reportStart: '2000-01-01', reportEnd: '2000-01-02' });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.select[0])), {
    name: 'report.weekly',
    payload: {
      start: '2026-06-01',
      end: '2026-06-08',
      scope: 'current',
      includePrompt: false,
      includeUpcoming: true,
      includeTime: true
    }
  });
  assert.deepEqual(written, [okResult.text]);
  assert.equal(app.calls.toast[0], 'Copied weekly report (3 done, 2 new, 1 edited)');
});

test('copyWeeklyReportUi falls back to state dates and defaults when the controls are absent', () => {
  const { readReportExportOptions } = loadController();

  const opts = readReportExportOptions({ reportStart: '2026-06-01', reportEnd: '2026-06-08' });

  assert.deepEqual(JSON.parse(JSON.stringify(opts)), {
    start: '2026-06-01',
    end: '2026-06-08',
    scope: 'all',
    includePrompt: true,
    includeUpcoming: true,
    includeTime: true
  });
});

test('copyWeeklyReportUi shows the error and copies nothing for an invalid range', () => {
  const written = [];
  const { copyWeeklyReportUi } = loadController({
    clipboard: { writeText: text => { written.push(text); return Promise.resolve(); } }
  });
  const app = makeApp({ text: '', counts: okResult.counts, error: 'Pick a valid date range' });

  copyWeeklyReportUi(app, { reportStart: '2026-06-10', reportEnd: '2026-06-01' });

  assert.deepEqual(app.calls.toast, ['Pick a valid date range']);
  assert.equal(written.length, 0);
});

test('copyWeeklyReportUi points to Download when the clipboard is unavailable or rejects', async () => {
  const noClipboard = loadController({ clipboard: undefined });
  const app1 = makeApp(okResult);
  noClipboard.copyWeeklyReportUi(app1, { reportStart: '2026-06-01', reportEnd: '2026-06-08' });
  assert.equal(app1.calls.toast[0], 'Clipboard unavailable - use Download .md');

  const rejecting = loadController({ clipboard: { writeText: () => Promise.reject(new Error('denied')) } });
  const app2 = makeApp(okResult);
  rejecting.copyWeeklyReportUi(app2, { reportStart: '2026-06-01', reportEnd: '2026-06-08' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app2.calls.toast[0], 'Copy failed - use Download .md');
});

test('downloadWeeklyReportUi downloads a dated Markdown file with the export text', () => {
  const created = [];
  const { downloadWeeklyReportUi } = loadController({ created });
  const app = makeApp(okResult);

  downloadWeeklyReportUi(app, { reportStart: '2026-06-01', reportEnd: '2026-06-08' });

  assert.equal(created.length, 1);
  assert.equal(created[0].download, 'weekly-report-2026-06-01-to-2026-06-08.md');
  assert.equal(created[0].clicked, true);
  assert.equal(created[0].href.startsWith('data:text/markdown;charset=utf-8,'), true);
  assert.equal(decodeURIComponent(created[0].href.split(',')[1]), okResult.text);
});

test('downloadWeeklyReportUi does nothing for an invalid range', () => {
  const created = [];
  const { downloadWeeklyReportUi } = loadController({ created });
  const app = makeApp({ text: '', counts: okResult.counts, error: 'Pick a valid date range' });

  downloadWeeklyReportUi(app, { reportStart: '', reportEnd: '' });

  assert.equal(created.length, 0);
  assert.deepEqual(app.calls.toast, ['Pick a valid date range']);
});

test('report.weekly query passes the payload and the active list to the domain builder', () => {
  const handlers = new Map();
  const received = [];
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    buildWeeklyReportDomain: (data, opts) => {
      received.push({ data, opts });
      return { text: 'x', counts: {}, error: '' };
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(`${read('js/domain/queries.js')}; globalThis.__exports = { registerAppQueries };`, sandbox);

  const state = { listId: 'l7', data: { tasks: {}, lists: {} } };
  sandbox.__exports.registerAppQueries(
    { queryService: { register: (name, fn) => handlers.set(name, fn) } },
    { state, walkTasks() {}, skipChildren: Symbol('skip'), todayS: () => '', tomorrowS: () => '', cmpDate: () => 0, esc: s => s }
  );

  const result = handlers.get('report.weekly')({ start: '2026-06-01', end: '2026-06-08', scope: 'current' });

  assert.equal(result.text, 'x');
  assert.equal(received[0].data, state.data);
  assert.deepEqual(JSON.parse(JSON.stringify(received[0].opts)), {
    start: '2026-06-01',
    end: '2026-06-08',
    scope: 'current',
    currentListId: 'l7'
  });
});

test('app.html loads the weekly report modules and wires the Reporting page controls', () => {
  const html = read('app.html');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);

  assert.equal(scripts.includes('js/domain/weekly-report.js'), true);
  assert.equal(scripts.includes('js/ui/report-export-controller.js'), true);
  assert.equal(scripts.indexOf('js/ui/report-export-controller.js') < scripts.indexOf('js/app.js'), true);

  for (const needle of ['App.copyWeeklyReport()', 'App.downloadWeeklyReport()', 'App.setReportLastDays()', 'id="report-days"', 'id="report-export-scope"']) {
    assert.equal(html.includes(needle), true, `app.html should contain ${needle}`);
  }

  const appSource = read('js/app.js');
  for (const method of ['setReportLastDays()', 'copyWeeklyReport()', 'downloadWeeklyReport()']) {
    assert.equal(appSource.includes(method), true, `App should define ${method}`);
  }
});

test('readReportExportOptions turns the time section off when its box is unchecked', () => {
  const { readReportExportOptions } = loadController({ elements: { 'report-incl-time': { checked: false } } });
  const opts = readReportExportOptions({ reportStart: '2026-06-01', reportEnd: '2026-06-08' });
  assert.equal(opts.includeTime, false);
  assert.equal(opts.includeUpcoming, true);
});
