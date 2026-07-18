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

  // Ensure target path is visible even when ancestors were collapsed.
  let p = t.parent_id;
  while (p) {
    const parent = S.data.tasks[p];
    if (!parent) break;
    parent._collapsed = false;
    p = parent.parent_id;
  }

  // If current hoist would hide the target, clear it before navigation.
  if (S.hoistId) {
    let inHoistPath = false;
    let cursor = id;
    while (cursor) {
      if (cursor === S.hoistId) {
        inHoistPath = true;
        break;
      }
      const node = S.data.tasks[cursor];
      cursor = node ? node.parent_id : '';
    }
    if (!inHoistPath) S.hoistId = null;
  }

  S.listId = t.checklist_id;
  S.selId = id;
  app.showPage('list');
  setTimeout(() => app.scrollSel(), 80);
}

function addOneNoteLinkUi(app, S) {
  if (!S.selId) {
    app.toast('Select a task first');
    return;
  }

  const t = S.data.tasks[S.selId];
  if (!t || t.deleted) {
    app.toast('Task not found');
    return;
  }

  const raw = prompt('Paste OneNote link:', '');
  if (raw === null) return;

  const link = normalizePromptLink(raw, 'onenote');

  if (!link) {
    app.toast('Link not added');
    return;
  }

  const token = `[fa:onenote](${link})`;
  if (String(t.content || '').includes(token)) {
    app.toast('OneNote link already exists');
    return;
  }

  app.pushUndo(app.snap());
  const before = String(t.content || '');
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  t.content = `${before}${sep}${token}`.trim();
  t.updated_at = now();
  logTaskHistory(t, 'title', { from: before, to: t.content, source: 'onenote-link' });
  app.save();
  app.render();
  app.toast('OneNote link added');
}

function addEmailLinkUi(app, S) {
  if (!S.selId) {
    app.toast('Select a task first');
    return;
  }

  const t = S.data.tasks[S.selId];
  if (!t || t.deleted) {
    app.toast('Task not found');
    return;
  }

  const raw = prompt('Paste email or email link:', '');
  if (raw === null) return;

  const link = normalizePromptLink(raw, 'email');

  if (!link) {
    app.toast('Link not added');
    return;
  }

  const token = `[fa:envelope](${link})`;
  if (String(t.content || '').includes(token)) {
    app.toast('Email link already exists');
    return;
  }

  app.pushUndo(app.snap());
  const before = String(t.content || '');
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  t.content = `${before}${sep}${token}`.trim();
  t.updated_at = now();
  logTaskHistory(t, 'title', { from: before, to: t.content, source: 'email-link' });
  app.save();
  app.render();
  app.toast('Email link added');
}

function addFileLinkUi(app, S) {
  if (!S.selId) {
    app.toast('Select a task first');
    return;
  }

  const t = S.data.tasks[S.selId];
  if (!t || t.deleted) {
    app.toast('Task not found');
    return;
  }

  const raw = prompt('Paste file path:', '');
  if (raw === null) return;

  const link = normalizePromptLink(raw, 'file');

  if (!link) {
    app.toast('Link not added');
    return;
  }

  const token = `[fa:file](${link})`;
  if (String(t.content || '').includes(token)) {
    app.toast('File link already exists');
    return;
  }

  app.pushUndo(app.snap());
  const before = String(t.content || '');
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  t.content = `${before}${sep}${token}`.trim();
  t.updated_at = now();
  logTaskHistory(t, 'title', { from: before, to: t.content, source: 'file-link' });
  app.save();
  app.render();
  app.toast('File link added');
}

function addWebLinkUi(app, S) {
  if (!S.selId) {
    app.toast('Select a task first');
    return;
  }

  const t = S.data.tasks[S.selId];
  if (!t || t.deleted) {
    app.toast('Task not found');
    return;
  }

  const raw = prompt('Paste web link:', '');
  if (raw === null) return;

  const link = normalizePromptLink(raw, 'web');

  if (!link) {
    app.toast('Link not added');
    return;
  }

  const token = `[fa:link](${link})`;
  if (String(t.content || '').includes(token)) {
    app.toast('Web link already exists');
    return;
  }

  app.pushUndo(app.snap());
  const before = String(t.content || '');
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  t.content = `${before}${sep}${token}`.trim();
  t.updated_at = now();
  logTaskHistory(t, 'title', { from: before, to: t.content, source: 'web-link' });
  app.save();
  app.render();
  app.toast('Web link added');
}

function addLabeledWebLinkUi(app, S) {
  if (!S.selId) {
    app.toast('Select a task first');
    return;
  }

  const t = S.data.tasks[S.selId];
  if (!t || t.deleted) {
    app.toast('Task not found');
    return;
  }

  const rawLabel = prompt('Display label:', 'Link');
  if (rawLabel === null) return;
  const label = String(rawLabel || '').trim().replace(/[\r\n\[\]]+/g, ' ');
  if (!label) {
    app.toast('Label required');
    return;
  }

  const rawUrl = prompt('Paste web link:', '');
  if (rawUrl === null) return;
  const link = normalizePromptLink(rawUrl, 'web');

  if (!link) {
    app.toast('Link not added');
    return;
  }

  const token = `[${label}](${link})`;
  if (String(t.content || '').includes(token)) {
    app.toast('Link already exists');
    return;
  }

  app.pushUndo(app.snap());
  const before = String(t.content || '');
  const sep = before && !/\s$/.test(before) ? ' ' : '';
  t.content = `${before}${sep}${token}`.trim();
  t.updated_at = now();
  logTaskHistory(t, 'title', { from: before, to: t.content, source: 'web-link-labeled' });
  app.save();
  app.render();
  app.toast('Link added');
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
      ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
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
      ['hf', 'Hide/show future due'],
    ]},
    { heading: 'Tags & Notes', items: [
      ['tt', 'Add tags'],
      ['ct', 'Clear tags'],
      ['nn', 'Add note'],
      ['no', 'Add OneNote link'],
      ['ne', 'Add email link'],
      ['nf', 'Add file link'],
      ['nw', 'Add web link'],
      ['Ctrl+K', 'Add labeled web link'],
      ['cn', 'Clear notes'],
      ['sn', 'Show/hide all notes'],
      ['tj', 'Edit task JSON'],
      ['th', 'View task history'],
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
      ['ll', 'Open lists picker'],
      ['gh', 'Lists home'],
      ['gd', 'Due page'],
      ['gg / gl', 'Go to selected task in list'],
      ['gr', 'Reporting page'],
      ['gt', 'Tags page'],
      ['hc', 'Hide/show completed'],
      ['df', 'Toggle relative dates'],
      ['sd', 'Toggle details'],
      ['pc', 'Show branch progress'],
      ['om', 'Zen mode'],
      ['oo', 'Settings'],
      ['?', 'Show this shortcuts list'],
    ]},
    { heading: 'List & Data', items: [
      ['ca', 'Clear assignees'],
      ['mm', 'Move to list'],
      ['ss', 'Sort'],
      ['ec', 'Expand/collapse all'],
      ['st', 'Toggle multi-select for task'],
      ['tc / lc', 'Copy task permalink'],
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
