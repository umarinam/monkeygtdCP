'use strict';

function readReportExportOptions(state) {
  const el = id => document.getElementById(id);
  const checked = (id, fallback) => (el(id) ? !!el(id).checked : fallback);
  return {
    start: (el('report-start') && el('report-start').value) || state.reportStart,
    end: (el('report-end') && el('report-end').value) || state.reportEnd,
    scope: el('report-export-scope') && el('report-export-scope').value === 'current' ? 'current' : 'all',
    includePrompt: checked('report-incl-prompt', true),
    includeUpcoming: checked('report-incl-upcoming', true),
    includeTime: checked('report-incl-time', true)
  };
}

function buildWeeklyReportUi(app, state) {
  const opts = readReportExportOptions(state);
  const result = app.select('report.weekly', opts);
  if (result.error) {
    app.toast(result.error);
    return null;
  }
  return { ...result, opts };
}

function setReportLastDaysUi(app, state) {
  const input = document.getElementById('report-days');
  const days = Math.floor(Number(input && input.value));
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    app.toast('Enter a number of days from 1 to 366');
    return;
  }

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  state.reportEnd = todayS();
  state.reportStart = dateStr(startDate);

  const startEl = document.getElementById('report-start');
  const endEl = document.getElementById('report-end');
  if (startEl) startEl.value = state.reportStart;
  if (endEl) endEl.value = state.reportEnd;
  app.renderReport();
}

function copyWeeklyReportUi(app, state) {
  const report = buildWeeklyReportUi(app, state);
  if (!report) return;

  const c = report.counts;
  const summary = `${c.done} done, ${c.new} new, ${c.edited} edited`;
  const pending = navigator.clipboard && navigator.clipboard.writeText(report.text);
  if (!pending) {
    app.toast('Clipboard unavailable - use Download .md');
    return;
  }
  pending
    .then(() => app.toast(`Copied weekly report (${summary})`))
    .catch(() => app.toast('Copy failed - use Download .md'));
}

function downloadWeeklyReportUi(app, state) {
  const report = buildWeeklyReportUi(app, state);
  if (!report) return;

  const a = document.createElement('a');
  a.href = 'data:text/markdown;charset=utf-8,' + encodeURIComponent(report.text);
  a.download = `weekly-report-${report.opts.start}-to-${report.opts.end}.md`;
  a.click();
  app.toast('Downloaded');
}
