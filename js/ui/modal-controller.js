'use strict';

function openOverlay(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeOverlay(app, state, id) {
  document.getElementById(id).classList.add('hidden');
  if (state.page === 'list') app.renderList();
}

function closeAllOverlays(app, state) {
  document.querySelectorAll('.ov').forEach(el => el.classList.add('hidden'));
  if (state.page === 'list') app.renderList();
}

function openDueModalUi(app, state) {
  if (!state.selId) return;
  state.calDate = new Date();
  renderCalUi(app, state);
  app.openModal('ov-due');
}

function renderCalUi(app, state) {
  const d = state.calDate;
  const yr = d.getFullYear();
  const mo = d.getMonth();
  const fd = new Date(yr, mo, 1).getDay();
  const dm = new Date(yr, mo + 1, 0).getDate();
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const DN = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const t2 = state.data.tasks[state.selId];
  const sel = t2 ? t2.due : '';
  const td = todayS();
  let h = `<div class="cal"><div class="calh"><button class="calnav" onclick="App.calPrev()">‹</button><span style="font-weight:600;font-size:13px">${MN[mo]} ${yr}</span><button class="calnav" onclick="App.calNext()">›</button></div><div class="calg">`;
  DN.forEach(n => h += `<div class="cdh">${n}</div>`);
  for (let i = 0; i < fd; i++) h += `<div class="cd"></div>`;
  for (let dy = 1; dy <= dm; dy++) {
    const ds = `${yr}-${String(mo + 1).padStart(2, '0')}-${String(dy).padStart(2, '0')}`;
    h += `<div class="cd${ds === td ? ' tod2' : ''}${ds === sel ? ' selday' : ''}" onclick="App.pickDate('${ds}')">${dy}</div>`;
  }
  h += `</div></div>`;
  document.getElementById('cal-widget').innerHTML = h;
}

function calPrevUi(app, state) {
  state.calDate = new Date(state.calDate.getFullYear(), state.calDate.getMonth() - 1, 1);
  renderCalUi(app, state);
}

function calNextUi(app, state) {
  state.calDate = new Date(state.calDate.getFullYear(), state.calDate.getMonth() + 1, 1);
  renderCalUi(app, state);
}

function pickDateUi(app, state, ds) {
  if (!state.selId) return;
  app.pushUndo(app.snap());
  const t = state.data.tasks[state.selId];
  const before = { due: t.due || '', due_asap: !!t.due_asap };
  t.due = ds;
  t.due_asap = false;
  t.updated_at = now();
  logTaskHistory(t, 'scheduling', { from: before, to: { due: t.due || '', due_asap: !!t.due_asap } });
  app.save();
  app.closeModal('ov-due');
  app.render();
  app.toast(`Due: ${dispDate(ds)}`);
}

function setDueQuickUi(app, state, p, internal, taskId) {
  if (!internal) {
    if (!state.selId) return;
    app.dispatch('task.setDueQuick', { taskId: state.selId, preset: p });
    return;
  }
  if (!taskId) return;
  app.pushUndo(app.snap());
  const t = state.data.tasks[taskId];
  const before = { due: t.due || '', due_asap: !!t.due_asap };
  ({
    today: () => { t.due = todayS(); t.due_asap = false; },
    tomorrow: () => { t.due = tomorrowS(); t.due_asap = false; },
    asap: () => { t.due = ''; t.due_asap = true; },
    nextweek: () => { t.due = nextMonday(); t.due_asap = false; },
    clear: () => { t.due = ''; t.due_asap = false; }
  })[p]?.();
  t.updated_at = now();
  if (before.due !== (t.due || '') || before.due_asap !== !!t.due_asap) {
    logTaskHistory(t, 'scheduling', { from: before, to: { due: t.due || '', due_asap: !!t.due_asap } });
  }
  app.save();
  app.closeModal('ov-due');
  app.render();
  app.toast(`Due: ${p}`);
}

function clearDueUi(app, state, taskId, internal, removeRepeat) {
  if (!internal) {
    if (!taskId) return;
    app.dispatch('task.clearDue', { taskId, removeRepeat: !!removeRepeat });
    return;
  }
  const t = state.data.tasks[taskId];
  if (!t) return;
  app.pushUndo(app.snap());
  const before = { due: t.due || '', due_asap: !!t.due_asap, repeating_due: t.repeating_due ? 'set' : '' };
  t.due = '';
  t.due_asap = false;
  if (removeRepeat) t.repeating_due = null;
  t.updated_at = now();
  logTaskHistory(t, 'scheduling', {
    from: before,
    to: { due: t.due || '', due_asap: !!t.due_asap, repeating_due: t.repeating_due ? 'set' : '' }
  });
  app.save();
  app.render();
  app.toast(removeRepeat ? 'Due and repeating cleared' : 'Due cleared');
}

function toggleRepeatWeekdaysUi() {
  const f = document.getElementById('rep-freq')?.value;
  const w = document.getElementById('rep-weekdays-wrap');
  if (w) w.style.display = f === 'weekly' ? '' : 'none';
}

function openRepeatModalUi(app, state) {
  if (!state.selId) return;
  const t = state.data.tasks[state.selId];
  const r = t.repeating_due || {
    freq: 'weekly',
    interval: 1,
    weekdays: [new Date((t.due || todayS()) + 'T00:00:00').getDay()],
    repeatFrom: 'due',
    paused: false,
    startDate: t.due || todayS()
  };
  document.getElementById('rep-freq').value = r.freq || 'weekly';
  document.getElementById('rep-int').value = String(r.interval || 1);
  document.getElementById('rep-from').value = r.repeatFrom || 'due';
  document.getElementById('rep-paused').checked = !!r.paused;
  document.querySelectorAll('.rep-wd').forEach(cb => cb.checked = false);
  (r.weekdays || []).forEach(day => {
    const el = document.querySelector(`.rep-wd[value="${day}"]`);
    if (el) el.checked = true;
  });
  toggleRepeatWeekdaysUi();
  app.openModal('ov-repeat');
}

function saveRepeatSettingsUi(app, state) {
  if (!state.selId) return;
  app.pushUndo(app.snap());
  const t = state.data.tasks[state.selId];
  const before = t.repeating_due ? JSON.stringify(t.repeating_due) : '';
  const freq = document.getElementById('rep-freq').value;
  const interval = Math.max(1, parseInt(document.getElementById('rep-int').value, 10) || 1);
  const repeatFrom = document.getElementById('rep-from').value;
  const paused = document.getElementById('rep-paused').checked;
  const weekdays = [...document.querySelectorAll('.rep-wd:checked')].map(x => Number(x.value));
  t.repeating_due = {
    freq,
    interval,
    weekdays: freq === 'weekly' ? weekdays : [],
    repeatFrom,
    paused,
    startDate: t.due || todayS(),
    reopenDays: 0
  };
  if (!t.due && !t.due_asap) t.due = todayS();
  t.updated_at = now();
  logTaskHistory(t, 'scheduling', {
    from: { repeating_due: before },
    to: { repeating_due: JSON.stringify(t.repeating_due) }
  });
  app.save();
  app.closeModal('ov-repeat');
  app.render();
  app.toast('Repeating saved');
}

function deleteRepeatSettingsUi(app, state) {
  if (!state.selId) return;
  app.pushUndo(app.snap());
  const t = state.data.tasks[state.selId];
  const before = t.repeating_due ? JSON.stringify(t.repeating_due) : '';
  t.repeating_due = null;
  t.updated_at = now();
  logTaskHistory(t, 'scheduling', { from: { repeating_due: before }, to: { repeating_due: '' } });
  app.save();
  app.closeModal('ov-repeat');
  app.render();
  app.toast('Repeating removed');
}

function openTagsModalUi(app, state, id) {
  state.selId = id;
  document.getElementById('tag-in').value = '';
  renderCurrentTagsUi(app, state);
  app.openModal('ov-tags');
  setTimeout(() => document.getElementById('tag-in').focus(), 50);
}

function renderCurrentTagsUi(_app, state) {
  const t = state.data.tasks[state.selId];
  if (!t) return;
  document.getElementById('cur-tags').innerHTML = Object.keys(t.tags || {}).map(tg => `<div class="tpill"><span>#${esc(tg)}</span><span class="tpx" onclick="App.rmTag('${tg}')">×</span></div>`).join('');
}

function addTagFromInputUi(app, state, internal, payload) {
  if (!internal) {
    const el = document.getElementById('tag-in');
    const raw = el.value.trim().replace(/^#/, '').replace(/,/g, '').trim();
    if (!raw || !state.selId) return;
    app.dispatch('task.addTag', { taskId: state.selId, tag: raw });
    return;
  }
  const taskId = payload.taskId;
  const raw = payload.tag;
  const el = document.getElementById('tag-in');
  const t = state.data.tasks[taskId];
  if (!t || !raw) return;
  app.pushUndo(app.snap());
  const before = t.tags_as_text || '';
  t.tags[raw] = { isPrivate: false };
  t.tags_as_text = Object.keys(t.tags).join(',');
  t.updated_at = now();
  if (before !== (t.tags_as_text || '')) {
    logTaskHistory(t, 'tags', { from: before, to: t.tags_as_text || '' });
  }
  app.save();
  if (el) el.value = '';
  renderCurrentTagsUi(app, state);
  document.getElementById('tag-ac').classList.remove('on');
}

function removeTagUi(app, state, tg, internal, taskId) {
  if (!internal) {
    if (!state.selId || !tg) return;
    app.dispatch('task.removeTag', { taskId: state.selId, tag: tg });
    return;
  }
  const t = state.data.tasks[taskId];
  if (!t) return;
  app.pushUndo(app.snap());
  const before = t.tags_as_text || '';
  delete t.tags[tg];
  t.tags_as_text = Object.keys(t.tags).join(',');
  t.updated_at = now();
  if (before !== (t.tags_as_text || '')) {
    logTaskHistory(t, 'tags', { from: before, to: t.tags_as_text || '' });
  }
  app.save();
  renderCurrentTagsUi(app, state);
}

function clearTagsUi(app, state, taskId, internal) {
  if (!internal) {
    if (!taskId) return;
    app.dispatch('task.clearTags', { taskId });
    return;
  }
  const t = state.data.tasks[taskId];
  if (!t) return;
  app.pushUndo(app.snap());
  const before = t.tags_as_text || '';
  t.tags = {};
  t.tags_as_text = '';
  t.updated_at = now();
  if (before) {
    logTaskHistory(t, 'tags', { from: before, to: '' });
  }
  app.save();
  app.render();
  app.toast('Tags cleared');
}

function updateTagAutocompleteUi(state) {
  const v = document.getElementById('tag-in').value.replace(/^#/, '').toLowerCase();
  const ac = document.getElementById('tag-ac');
  const all = new Set();
  Object.values(state.data.tasks).forEach(t => Object.keys(t.tags || {}).forEach(tg => all.add(tg)));
  const m = [...all].filter(tg => tg.toLowerCase().includes(v) && v.length);
  if (!m.length) {
    ac.classList.remove('on');
    return;
  }
  ac.innerHTML = m.slice(0, 8).map((tg, i) => `<div class="tgsugg${i === 0 ? ' on' : ''}" onclick="App.pickTag('${tg}')">#${tg}</div>`).join('');
  ac.classList.add('on');
}

function pickTagUi(app, tg) {
  document.getElementById('tag-in').value = tg;
  document.getElementById('tag-ac').classList.remove('on');
  app.addTagFromInput();
}

function openNotesModalUi(app, state, id) {
  state.selId = id;
  renderNotesUi(state, id);
  document.getElementById('note-in').value = '';
  app.openModal('ov-notes');
  setTimeout(() => document.getElementById('note-in').focus(), 50);
}

function renderNotesUi(state, id) {
  const t = state.data.tasks[id];
  document.getElementById('notes-list').innerHTML = (!t || !t.notes || !t.notes.length)
    ? '<div style="color:var(--muted);font-size:13px">No notes yet.</div>'
    : t.notes.map(n => `<div style="padding:8px;margin-bottom:8px;background:var(--bg-alt);border-radius:6px"><div class="na">${esc(n.author)} · ${(n.created_at || '').slice(0,10)}</div><div>${md(n.content)}</div><button class="btn btn-sm" style="margin-top:6px;color:var(--danger)" onclick="App.delNote('${id}','${n.id}')">Delete</button></div>`).join('');
}

function addNoteUi(app, state, internal, payload) {
  if (!internal) {
    const c = document.getElementById('note-in').value.trim();
    if (!c || !state.selId) return;
    app.dispatch('task.addNote', { taskId: state.selId, content: c });
    return;
  }
  const c = payload.content;
  const taskId = payload.taskId;
  app.pushUndo(app.snap());
  const t = state.data.tasks[taskId];
  if (!t) return;
  const beforeCount = Number(t.comments_count || 0);
  t.notes = [...(t.notes || []), { id: uid(), author: 'me', content: c, created_at: now(), updated_at: now() }];
  t.comments_count = t.notes.length;
  t.updated_at = now();
  logTaskHistory(t, 'notes', {
    action: 'add-note',
    noteLength: String(c || '').length,
    fromCount: beforeCount,
    toCount: Number(t.comments_count || 0)
  });
  app.save();
  renderNotesUi(state, taskId);
  document.getElementById('note-in').value = '';
  app.render();
  app.toast('Note added');
}

function deleteNoteUi(app, state, tid, nid, internal) {
  if (!internal) {
    app.dispatch('task.deleteNote', { taskId: tid, noteId: nid });
    return;
  }
  app.pushUndo(app.snap());
  const t = state.data.tasks[tid];
  if (!t) return;
  const beforeCount = Number(t.comments_count || 0);
  t.notes = (t.notes || []).filter(n => n.id !== nid);
  t.comments_count = t.notes.length;
  t.updated_at = now();
  logTaskHistory(t, 'notes', {
    action: 'delete-note',
    fromCount: beforeCount,
    toCount: Number(t.comments_count || 0)
  });
  app.save();
  renderNotesUi(state, tid);
  app.render();
}

function clearNotesUi(app, state, taskId, internal) {
  if (!internal) {
    if (!taskId) return;
    app.dispatch('task.clearNotes', { taskId });
    return;
  }
  const t = state.data.tasks[taskId];
  if (!t) return;
  app.pushUndo(app.snap());
  const beforeCount = Number(t.comments_count || 0);
  t.notes = [];
  t.comments_count = 0;
  t.updated_at = now();
  if (beforeCount > 0) {
    logTaskHistory(t, 'notes', {
      action: 'clear-notes',
      fromCount: beforeCount,
      toCount: 0
    });
  }
  app.save();
  app.render();
  app.toast('Notes cleared');
}

function openSortDlgUi(app, S) {
  const opts = [{ v: 'alpha', l: 'Alphabetically' }, { v: 'due', l: 'By due date' }, { v: 'created', l: 'By time created' }, { v: 'updated', l: 'By time updated' }, { v: 'priority', l: 'By priority' }];
  document.getElementById('sort-opts').innerHTML = opts.map(o => `<div class="sopt${S.sortField === o.v ? ' on' : ''}" onclick="App.selSort('${o.v}')"><span>${S.sortField === o.v ? '●' : '○'}</span> ${o.l}</div>`).join('');
  app.openModal('ov-sort');
}

function selSortUi(S, f) {
  S.sortField = f;
  const opts = [{ v: 'alpha', l: 'Alphabetically' }, { v: 'due', l: 'By due date' }, { v: 'created', l: 'By time created' }, { v: 'updated', l: 'By time updated' }, { v: 'priority', l: 'By priority' }];
  document.getElementById('sort-opts').innerHTML = opts.map(o => `<div class="sopt${S.sortField === o.v ? ' on' : ''}" onclick="App.selSort('${o.v}')"><span>${S.sortField === o.v ? '●' : '○'}</span> ${o.l}</div>`).join('');
}

function openMoveDlgUi(app, S) {
  if (!S.selId && !S.msel.size) return;
  document.getElementById('move-q').value = '';
  updateMoveRUi(app, S);
  app.openModal('ov-move');
  setTimeout(() => document.getElementById('move-q').focus(), 50);
}

function updateMoveRUi(app, S) {
  const q = document.getElementById('move-q').value.toLowerCase();
  let h = '';
  const res = app.select('move.searchTargets', { q });
  for (const l of res.lists) {
    h += `<div class="mvt" onclick="App.moveToList('${l.id}')"><span>📋</span><div><div>${esc(l.name)}</div><div class="mvtl">List</div></div></div>`;
  }
  if (q) {
    for (const t of res.tasks) {
      h += `<div class="mvt" onclick="App.moveToTask('${t.id}')"><span>📌</span><div><div>${esc(t.content)}</div><div class="mvtl">${esc(t.listName || '')}</div></div></div>`;
    }
  }
  document.getElementById('move-r').innerHTML = h || '<div style="padding:12px;color:var(--muted);font-size:13px">Type to search</div>';
}

function openExportUi(app) {
  app.closeModal('ov-settings');
  refreshExportUi(app);
  app.openModal('ov-export');
}

function refreshExportUi(app) {
  const fmt = document.getElementById('exp-fmt').value;
  const scope = document.getElementById('exp-scope').value;
  const notes = document.getElementById('exp-notes').checked;
  const done = document.getElementById('exp-done').checked;
  const out = app.select('export.output', { fmt, scope, notes, done });
  document.getElementById('exp-out').value = out;
}

function copyExportUi() {
  navigator.clipboard?.writeText(document.getElementById('exp-out').value).catch(() => { });
}

function downloadExportUi(S) {
  const txt = document.getElementById('exp-out').value;
  const fmt = document.getElementById('exp-fmt').value;
  const ext = { json: 'json', markdown: 'md', opml: 'opml', text: 'txt' }[fmt] || 'txt';
  const list = S.data.lists[S.listId];
  const fn = `${(list ? list.name : 'export').replace(/\s+/g, '-')}.${ext}`;
  const a = document.createElement('a');
  a.href = 'data:text/plain;charset=utf-8,' + encodeURIComponent(txt);
  a.download = fn;
  a.click();
}

function openImportUi(app) {
  app.closeModal('ov-settings');
  document.getElementById('imp-in').value = '';
  app.openModal('ov-import');
}

function showRestoreDeletedUi(app, S) {
  app.closeModal('ov-settings');
  const items = (S.data.deletedItems || []).slice().reverse();
  const cutoff = new Date(Date.now() - 86400000).toISOString();
  const recent = items.filter(i => i.deletedAt > cutoff);
  document.getElementById('del-list').innerHTML = !recent.length
    ? '<div style="color:var(--muted);padding:12px">No recently deleted items.</div>'
    : recent.map(i => `<div class="del-row"><input type="checkbox" data-del="${i.taskId}"><div style="flex:1;font-size:13px">${esc((i.snapshot.content || '').slice(0, 60))}</div><div style="font-size:11px;color:var(--muted)">${(i.deletedAt || '').slice(0, 10)}</div></div>`).join('');
  app.openModal('ov-restore');
}

function showWCUi(app, S) {
  app.closeModal('ov-settings');
  const ids = S.selId ? [S.selId] : (S.data.lists[S.listId]?.root_tasks || []);
  const stats = app.select('stats.wordCount', { ids });
  document.getElementById('wc-r').innerHTML = `<div class="wcs"><span>Words</span><span class="wcv">${stats.words}</span></div><div class="wcs"><span>Characters (no spaces)</span><span class="wcv">${stats.chars}</span></div><div class="wcs"><span>Characters (with spaces)</span><span class="wcv">${stats.charsWithSpaces}</span></div>`;
  app.openModal('ov-wc');
}

function createListUi(app, S) {
  S.listMode = 'create';
  S.listEditId = null;
  document.getElementById('list-mt').textContent = 'New List';
  document.getElementById('list-n').value = '';
  document.getElementById('list-t').value = '';
  document.getElementById('list-ok').textContent = 'Create';
  app.openModal('ov-list');
  setTimeout(() => document.getElementById('list-n').focus(), 50);
}

function renameListUi(app, S, id) {
  const l = S.data.lists[id];
  if (!l) return;
  S.listMode = 'rename';
  S.listEditId = id;
  document.getElementById('list-mt').textContent = 'Rename List';
  document.getElementById('list-n').value = l.name;
  document.getElementById('list-t').value = (l.tags || []).map(t => '#' + t).join(' ');
  document.getElementById('list-ok').textContent = 'Save';
  app.openModal('ov-list');
  setTimeout(() => document.getElementById('list-n').focus(), 50);
}

function parseTaskJsonInput(raw) {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Task JSON must be an object');
  }
  return parsed;
}

function normalizeTaskFromJson(taskId, candidate, state) {
  const existing = state.data.tasks[taskId] || {};
  const normalized = { ...candidate };

  normalized.id = taskId;
  normalized.tasks = Array.isArray(normalized.tasks) ? normalized.tasks : [];
  normalized.tags = (normalized.tags && typeof normalized.tags === 'object' && !Array.isArray(normalized.tags)) ? normalized.tags : {};
  normalized.notes = Array.isArray(normalized.notes) ? normalized.notes : [];
  normalized.assignees = Array.isArray(normalized.assignees) ? normalized.assignees : [];
  normalized.content = typeof normalized.content === 'string' ? normalized.content : String(normalized.content || '');
  normalized.status = Number.isFinite(normalized.status) ? normalized.status : (Number.isFinite(existing.status) ? existing.status : 0);
  normalized.tags_as_text = Object.keys(normalized.tags).join(',');
  normalized.comments_count = normalized.notes.length;

  if (!normalized.checklist_id || !state.data.lists[normalized.checklist_id]) {
    normalized.checklist_id = existing.checklist_id || state.listId;
  }

  if (normalized.parent_id && !state.data.tasks[normalized.parent_id]) {
    normalized.parent_id = '';
  }
  if (normalized.parent_id === taskId) {
    normalized.parent_id = '';
  }

  normalized.created_at = normalized.created_at || existing.created_at || now();
  normalized.updated_at = now();

  return normalized;
}

function setTaskJsonError(message) {
  const el = document.getElementById('task-json-error');
  if (!el) return;
  el.textContent = message || '';
}

function openTaskJsonModalUi(app, state, taskId) {
  const id = taskId || state.selId;
  if (!id) {
    app.toast('Select a task first');
    return;
  }

  const task = state.data.tasks[id];
  if (!task) {
    app.toast('Task not found');
    return;
  }

  state.selId = id;
  setTaskJsonError('');
  document.getElementById('task-json-input').value = JSON.stringify(task, null, 2);
  app.openModal('ov-task-json');
  setTimeout(() => document.getElementById('task-json-input').focus(), 50);
}

function saveTaskJsonUi(app, state) {
  const id = state.selId;
  if (!id) {
    app.toast('Select a task first');
    return;
  }

  const task = state.data.tasks[id];
  if (!task) {
    setTaskJsonError('Task not found');
    return;
  }

  const raw = document.getElementById('task-json-input').value;
  try {
    const before = {
      content: task.content,
      tags_as_text: task.tags_as_text || '',
      assignees: JSON.stringify(task.assignees || []),
      due: task.due || '',
      due_asap: !!task.due_asap,
      repeating_due: task.repeating_due ? JSON.stringify(task.repeating_due) : '',
      color: Number(task.color || 0)
    };
    const parsed = parseTaskJsonInput(raw);
    const normalized = normalizeTaskFromJson(id, parsed, state);
    app.pushUndo(app.snap());
    state.data.tasks[id] = normalized;
    if (before.content !== normalized.content) {
      logTaskHistory(normalized, 'title', { from: before.content, to: normalized.content });
    }
    if (before.tags_as_text !== (normalized.tags_as_text || '')) {
      logTaskHistory(normalized, 'tags', { from: before.tags_as_text, to: normalized.tags_as_text || '' });
    }
    if (before.assignees !== JSON.stringify(normalized.assignees || [])) {
      logTaskHistory(normalized, 'assignment', {
        from: JSON.parse(before.assignees),
        to: normalized.assignees || []
      });
    }
    if (
      before.due !== (normalized.due || '') ||
      before.due_asap !== !!normalized.due_asap ||
      before.repeating_due !== (normalized.repeating_due ? JSON.stringify(normalized.repeating_due) : '')
    ) {
      logTaskHistory(normalized, 'scheduling', {
        from: { due: before.due, due_asap: before.due_asap, repeating_due: before.repeating_due },
        to: {
          due: normalized.due || '',
          due_asap: !!normalized.due_asap,
          repeating_due: normalized.repeating_due ? JSON.stringify(normalized.repeating_due) : ''
        }
      });
    }
    if (before.color !== Number(normalized.color || 0)) {
      logTaskHistory(normalized, 'priority', { from: before.color, to: Number(normalized.color || 0) });
    }
    app.save();
    setTaskJsonError('');
    app.closeModal('ov-task-json');
    app.render();
    app.toast('Task JSON saved');
  } catch (err) {
    setTaskJsonError(err?.message || 'Invalid JSON');
  }
}

function formatHistoryTypeLabel(type) {
  const labels = {
    title: 'Title',
    tags: 'Tags',
    assignment: 'Assignment',
    scheduling: 'Scheduling',
    priority: 'Priority',
    status: 'Status',
    structure: 'Structure',
    deletion: 'Deletion',
    notes: 'Notes',
    creation: 'Creation'
  };
  return labels[type] || (type ? String(type) : 'Change');
}

function statusText(status) {
  if (Number(status) === 1) return 'done';
  if (Number(status) === 2) return 'invalid';
  return 'open';
}

function formatHistorySummary(type, changes) {
  const c = changes || {};

  if (type === 'title') {
    return `Title: "${c.from || ''}" -> "${c.to || ''}"`;
  }

  if (type === 'tags') {
    return `Tags: ${c.from || '(none)'} -> ${c.to || '(none)'}`;
  }

  if (type === 'assignment') {
    const from = Array.isArray(c.from) ? c.from.join(', ') : (c.from || '(none)');
    const to = Array.isArray(c.to) ? c.to.join(', ') : (c.to || '(none)');
    return `Assignees: ${from || '(none)'} -> ${to || '(none)'}`;
  }

  if (type === 'priority') {
    return `Priority: ${Number(c.from || 0)} -> ${Number(c.to || 0)}`;
  }

  if (type === 'status') {
    return `Status: ${statusText(c.from)} -> ${statusText(c.to)}`;
  }

  if (type === 'notes') {
    const action = c.action || 'updated-notes';
    return `Notes ${action}: ${Number(c.fromCount || 0)} -> ${Number(c.toCount || 0)}`;
  }

  if (type === 'creation') {
    const source = c.source || 'unknown';
    return `Created via ${source} (list: ${c.listId || ''}, parent: ${c.parentId || '(root)'})`;
  }

  if (type === 'deletion') {
    return `Deletion event: ${c.action || 'updated'}`;
  }

  if (type === 'structure') {
    return `Structure: ${c.action || 'updated'} (parent ${c.from?.parent_id || '(root)'} -> ${c.to?.parent_id || '(root)'})`;
  }

  if (type === 'scheduling') {
    const fromDue = c.from?.due || (c.from?.due_asap ? 'asap' : '(none)');
    const toDue = c.to?.due || (c.to?.due_asap ? 'asap' : '(none)');
    if (c.from?.repeating_due !== undefined || c.to?.repeating_due !== undefined) {
      const fromRep = c.from?.repeating_due ? 'set' : '(none)';
      const toRep = c.to?.repeating_due ? 'set' : '(none)';
      return `Scheduling: due ${fromDue} -> ${toDue}; repeat ${fromRep} -> ${toRep}`;
    }
    return `Scheduling: due ${fromDue} -> ${toDue}`;
  }

  return JSON.stringify(c || {}, null, 2);
}

function renderTaskHistoryUi(state, taskId) {
  const t = state.data.tasks[taskId];
  const listEl = document.getElementById('task-history-list');
  if (!listEl) return;
  if (!t) {
    listEl.innerHTML = '<div class="task-history-empty">Task not found</div>';
    return;
  }

  const history = Array.isArray(t.history) ? t.history.slice().reverse() : [];
  if (!history.length) {
    listEl.innerHTML = '<div class="task-history-empty">No history recorded yet.</div>';
    return;
  }

  listEl.innerHTML = history.map(h => {
    const at = h.at ? new Date(h.at).toLocaleString() : '';
    const type = esc(formatHistoryTypeLabel(h.type));
    const summary = esc(formatHistorySummary(h.type, h.changes));
    return `<div class="task-history-row"><div class="task-history-head"><span class="task-history-type">${type}</span><span class="task-history-at">${at}</span></div><pre class="task-history-changes">${summary}</pre></div>`;
  }).join('');
}

function openTaskHistoryUi(app, state, taskId) {
  const id = taskId || state.selId;
  if (!id) {
    app.toast('Select a task first');
    return;
  }
  if (!state.data.tasks[id]) {
    app.toast('Task not found');
    return;
  }
  state.selId = id;
  renderTaskHistoryUi(state, id);
  app.openModal('ov-task-history');
}
