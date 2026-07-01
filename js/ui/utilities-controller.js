'use strict';

/**
 * Utilities UI Controller
 * Handles various utility operations (toggle details, progress, jump to, wipe/reset, extract)
 */

function showProgressUi(app, S, id) {
  const stats = app.select('stats.progress', { id });
  if (!stats) return;
  app.toast(`${stats.done}/${stats.total} done`);
}

function toggleDetailsUi(app) {
  const ds = document.querySelectorAll('[id^="dtl-"]');
  const visible = ds.length && ds[0].style.display !== 'none';
  ds.forEach((el) => (el.style.display = visible ? 'none' : 'block'));
  app.toast(`Details ${visible ? 'hidden' : 'visible'}`);
}

function wipeCompletedUi(app, S) {
  if (!confirm('Delete all completed tasks in this list?')) return;
  app.dispatch('task.wipeCompleted');
}

function wipeCompletedDomainUi(app, S) {
  wipeCompletedDomain(app, S, walkTasks, SKIP_CHILDREN);
}

function resetCompletedUi(app, S) {
  app.dispatch('task.resetCompleted');
}

function resetCompletedDomainUi(app, S) {
  resetCompletedDomain(app, S, walkTasks);
}

function extractBranchUi(app, S) {
  if (!S.selId) return;
  const t0 = S.data.tasks[S.selId];
  if (!t0) return;
  if (!confirm(`Extract "${t0.content.slice(0, 40)}" as a new list?`)) return;
  app.dispatch('task.extractBranch');
}

function extractBranchDomainUi(app, S) {
  extractBranchDomain(app, S, walkTasks, uid, mkList, app.sibList.bind(app));
}

function jumpToUi(app, S, id) {
  const t = S.data.tasks[id];
  if (!t) return;
  S.listId = t.checklist_id;
  S.selId = id;
  app.showPage('list');
  setTimeout(() => app.scrollSel(), 80);
}

function showShortcutsUi(app) {
  const groups = [
    { heading: 'Navigation', items: [
      ['j / ↓', 'Move down'],
      ['k / ↑', 'Move up'],
      ['←', 'Collapse / go to parent'],
      ['→', 'Expand / go to first child'],
      ['Home / End', 'First / last task'],
      ['PageUp / PageDown', 'Jump 10 tasks'],
      ['Shift+→ / Shift+←', 'Hoist (focus) / un-focus'],
      ['Ctrl+Shift+→ / ←', 'Expand all / collapse all'],
    ]},
    { heading: 'Editing', items: [
      ['Enter', 'Add task below'],
      ['Shift+Enter', 'Add child task'],
      ['Alt+Enter', 'Add task above'],
      ['F2 / double-click', 'Edit task'],
      ['Delete', 'Delete task'],
      ['Tab / Shift+Tab', 'Indent / un-indent'],
      ['Ctrl+↑ / Ctrl+↓', 'Move task up / down'],
      ['Ctrl+Z / uu', 'Undo'],
      ['Ctrl+D', 'Duplicate task'],
    ]},
    { heading: 'Status & Due', items: [
      ['Space', 'Toggle completed'],
      ['Shift+Space', 'Mark invalidated'],
      ['dd', 'Set due date…'],
      ['td', 'Due today'],
      ['tm', 'Due tomorrow'],
      ['as', 'Due ASAP'],
      ['cd', 'Clear due date'],
      ['dr', 'Repeating due settings'],
    ]},
    { heading: 'Tags & Notes', items: [
      ['tt', 'Add tags'],
      ['ct', 'Clear tags'],
      ['nn', 'Add note'],
      ['cn', 'Clear notes'],
      ['sn', 'Show/hide all notes'],
    ]},
    { heading: 'Copy & Clipboard', items: [
      ['Ctrl+C', 'Copy'],
      ['Ctrl+X', 'Cut'],
      ['Ctrl+V', 'Paste'],
      ['Ctrl+A', 'Select all visible'],
    ]},
    { heading: 'View & Navigation', items: [
      ['/', 'Focus search'],
      ['Shift+Shift', 'Command palette'],
      ['gh', 'Lists home'],
      ['gd', 'Due page'],
      ['gt', 'Tags page'],
      ['hc', 'Hide/show completed'],
      ['df', 'Toggle relative dates'],
      ['om', 'Zen mode'],
      ['oo', 'Settings'],
      ['?', 'Show this shortcuts list'],
    ]},
    { heading: 'List & Data', items: [
      ['mm', 'Move to list'],
      ['ss', 'Sort'],
      ['ex', 'Export'],
      ['im', 'Import'],
      ['rd', 'Restore deleted'],
      ['wc', 'Word count'],
      ['xx', 'Extract branch as new list'],
      ['wipe', 'Wipe completed'],
      ['reset', 'Reset completed'],
    ]},
    { heading: 'Gist Sync', items: [
      ['sg', 'Sync now (bidirectional)'],
      ['sp', 'Pull from Gist'],
      ['sh', 'Push to Gist'],
    ]},
  ];

  const html = groups.map(g => {
    const rows = g.items.map(([k, d]) =>
      `<tr><td style="padding:3px 14px 3px 0;white-space:nowrap"><kbd style="background:var(--bg2);border:1px solid var(--bd);border-radius:3px;padding:1px 5px;font-size:11px;font-family:monospace">${k}</kbd></td><td style="padding:3px 0;color:var(--fg)">${d}</td></tr>`
    ).join('');
    return `<div style="margin-bottom:14px"><div class="sst" style="margin-bottom:6px">${g.heading}</div><table style="border-collapse:collapse;width:100%">${rows}</table></div>`;
  }).join('');

  document.getElementById('shortcuts-r').innerHTML = html;
  app.openModal('ov-shortcuts');
}
