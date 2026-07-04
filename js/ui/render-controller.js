'use strict';

function bindTaskListEvents(app, state) {
  const tl = document.getElementById('task-list');

  tl.onclick = e => {
    const internalLink = e.target.closest('a[href^="#task-"]');
    if (internalLink) {
      const href = internalLink.getAttribute('href') || '';
      const taskId = href.replace(/^#task-/, '');
      if (taskId) {
        e.preventDefault();
        app.jumpTo(taskId);
        return;
      }
    }

    const ti = e.target.closest('.ti');
    if (!ti) return;
    if (e.target.closest('.edit-area')) return;

    const id = ti.dataset.id;
    const a = e.target.closest('[data-a]')?.dataset?.a;

    if (a === 'tog') {
      app.toggleCollapse(id);
      return;
    }
    if (a === 'sts') {
      app.toggleStatus(id);
      return;
    }
    if (a === 'due') {
      state.selId = id;
      app.openDueModal();
      return;
    }
    if (a === 'repeat') {
      state.selId = id;
      app.openRepeatModal();
      return;
    }
    if (a === 'ftag') {
      app.filterTag(e.target.dataset.tag);
      return;
    }
    if (a === 'notes') {
      app.openNotesModal(id);
      return;
    }
    if (a === 'json') {
      app.openTaskJson(id);
      return;
    }
    if (a === 'hist') {
      app.openTaskHistory(id);
      return;
    }

    const ts = Date.now();
    const isPlainClick = !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
    if (isPlainClick && state.lastClickId === id && (ts - state.lastClickAt) < 320) {
      state.lastClickId = '';
      state.lastClickAt = 0;
      app.startEdit(id);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      state.msel.has(id) ? state.msel.delete(id) : state.msel.add(id);
    } else {
      state.selId = id;
      state.msel.clear();
    }

    state.lastClickId = id;
    state.lastClickAt = ts;
    app.renderList();
    app.syncSB();
  };

  tl.addEventListener('dragstart', e => {
    const ti = e.target.closest('.ti');
    if (!ti) return;
    state.dragSrc = ti.dataset.id;
    ti.classList.add('ds');
    e.dataTransfer.effectAllowed = 'move';
  });

  tl.addEventListener('dragend', () => {
    document.querySelectorAll('.ds,.do').forEach(el => el.classList.remove('ds', 'do'));
  });

  tl.addEventListener('dragover', e => {
    e.preventDefault();
    const ti = e.target.closest('.ti');
    if (!ti) return;
    document.querySelectorAll('.do').forEach(el => el.classList.remove('do'));
    ti.classList.add('do');
  });

  tl.addEventListener('drop', e => {
    e.preventDefault();
    const ti = e.target.closest('.ti');
    if (ti && state.dragSrc && state.dragSrc !== ti.dataset.id) {
      app.pushUndo(app.snap());
      app.moveBefore(state.dragSrc, ti.dataset.id);
    }
    state.dragSrc = null;
  });
}

function scrollToSelectedTask(state) {
  if (!state.selId) return;
  const el = document.querySelector(`.ti[data-id="${state.selId}"]`);
  if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function showPageUi(app, state, p) {
  state.page = p;
  ['home-page', 'list-page', 'due-page', 'report-page', 'kanban-page', 'tags-page'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  const map = { home: 'home-page', list: 'list-page', due: 'due-page', report: 'report-page', kanban: 'kanban-page', tags: 'tags-page' };
  document.getElementById(map[p]).classList.remove('hidden');
  renderCurrentPageUi(app, state);
}

function renderCurrentPageUi(app, state) {
  if (state.page === 'home') app.renderHome();
  else if (state.page === 'list') app.renderList();
  else if (state.page === 'due') app.renderDue();
  else if (state.page === 'report') app.renderReport();
  else if (state.page === 'kanban') app.renderKanban();
  else if (state.page === 'tags') app.renderTags();
  app.syncSB();
}

function ensureReportFilters(state) {
  if (!state.reportFilters) {
    state.reportFilters = { added: true, modified: true, completed: true, deleted: true, untouched: true };
    return state.reportFilters;
  }

  for (const key of ['added', 'modified', 'completed', 'deleted', 'untouched']) {
    if (typeof state.reportFilters[key] !== 'boolean') state.reportFilters[key] = true;
  }

  return state.reportFilters;
}

function filterReportRows(rows, filters) {
  return (rows || []).filter(r => !!filters[r.statusKey]);
}

function buildReportLegendUi(filters, counts) {
  const items = [
    ['added', 'Added'],
    ['modified', 'Modified'],
    ['completed', 'Completed'],
    ['deleted', 'Deleted'],
    ['untouched', 'Untouched']
  ];

  return items.map(([key, label]) => {
    const activeCls = filters[key] ? ' active' : ' off';
    const cnt = Number(counts[key] || 0);
    return `<button class="report-pill rp-${key}${activeCls}" onclick="App.toggleReportFilter('${key}')">${label} (${cnt})</button>`;
  }).join('');
}

function renderReportUi(app, state) {
  const startEl = document.getElementById('report-start');
  const endEl = document.getElementById('report-end');
  if (startEl && !startEl.value) startEl.value = state.reportStart || todayS();
  if (endEl && !endEl.value) endEl.value = state.reportEnd || todayS();

  const start = (startEl && startEl.value) || state.reportStart || todayS();
  const end = (endEl && endEl.value) || state.reportEnd || todayS();
  state.reportStart = start;
  state.reportEnd = end;

  const rows = app.select('report.rows', { start, end });
  const filters = ensureReportFilters(state);
  const counts = rows.reduce((acc, row) => {
    acc[row.statusKey] = (acc[row.statusKey] || 0) + 1;
    return acc;
  }, { added: 0, modified: 0, completed: 0, deleted: 0, untouched: 0 });
  const legendEl = document.getElementById('report-legend');
  if (legendEl) legendEl.innerHTML = buildReportLegendUi(filters, counts);

  const filteredRows = filterReportRows(rows, filters);
  const list = state.data.lists[state.listId];
  if (!list) {
    document.getElementById('report-c').innerHTML = '<div class="empty"><div class="empty-t">No active list</div></div>';
    return;
  }

  const title = `<div class="report-head">${esc(list.name)} · ${esc(start)} to ${esc(end)}</div>`;
  if (!filteredRows.length) {
    document.getElementById('report-c').innerHTML = `${title}<div class="empty"><div class="empty-t">No items found</div></div>`;
    return;
  }

  const html = filteredRows.map(r => {
    const indent = Math.max(0, Number(r.depth || 0)) * 18;
    const deletedMark = r.statusKey === 'deleted' ? '<span class="report-deleted-mark">deleted</span>' : '';
    return `<div class="report-row rk-${r.statusKey}" style="padding-left:${indent + 10}px">
      <span class="report-dot"></span>
      <span class="report-content">${esc(r.content || '(untitled)')}</span>
      ${deletedMark}
    </div>`;
  }).join('');

  document.getElementById('report-c').innerHTML = `${title}<div class="report-list">${html}</div>`;
}

function sibIndexUi(state, id) {
  const t = state.data.tasks[id];
  if (!t) return 1;
  const sibs = t.parent_id
    ? (state.data.tasks[t.parent_id]?.tasks || [])
    : (state.data.lists[t.checklist_id]?.root_tasks || []);
  return (sibs.indexOf(id) + 1) || 1;
}

function filterIdsUi(app, state, ids) {
  return app.select('tasks.filterIds', { ids, q: state.filter });
}

function ancestorsUi(state, id) {
  const res = [];
  let t = state.data.tasks[id];
  while (t && t.parent_id) {
    const p = state.data.tasks[t.parent_id];
    if (p) res.unshift(p);
    t = p;
  }
  return res;
}

function renderHomeUi(state) {
  const lists = Object.values(state.data.lists).sort((a, b) => a.name.localeCompare(b.name));
  document.getElementById('list-title').textContent = 'MonkeyGTD';

  if (!lists.length) {
    document.getElementById('lists-c').innerHTML = '<div class="empty"><div class="empty-t">No lists yet</div></div>';
    return;
  }

  document.getElementById('lists-c').innerHTML = lists.map(l => {
    const tasks = Object.values(state.data.tasks).filter(t => t.checklist_id === l.id && !t.deleted);
    const open = tasks.filter(t => t.status === 0).length;
    const tagH = (l.tags || []).map(t => `<span class="ltag">#${esc(t)}</span>`).join('');
    return `<div class="lcard${l.archived ? ' arch' : ''}" onclick="App.openList('${l.id}')">
      <div style="flex:1">
        <div style="font-weight:500">${esc(l.name)}${l.archived ? ' (archived)' : ''}</div>
        ${tagH ? `<div style="display:flex;gap:4px;margin-top:4px">${tagH}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;align-items:center">
        <span style="font-size:12px;color:var(--muted)">${open} open</span>
        <button class="btn btn-sm" onclick="event.stopPropagation();App.renameList('${l.id}')">✏</button>
        ${l.archived
          ? `<button class="btn btn-sm" onclick="event.stopPropagation();App.unarchiveList('${l.id}')">↩</button>`
          : `<button class="btn btn-sm" onclick="event.stopPropagation();App.archiveList('${l.id}')">📦</button>`}
        <button class="btn btn-sm" style="color:var(--danger)" onclick="event.stopPropagation();App.deleteList('${l.id}')">🗑</button>
      </div>
    </div>`;
  }).join('');
}

function renderBreadcrumbsUi(app, state) {
  const bc = document.getElementById('breadcrumbs');
  if (!state.hoistId || !state.data.settings.showBreadcrumbs) {
    bc.classList.remove('on');
    return;
  }

  bc.classList.add('on');
  const ancestors = ancestorsUi(state, state.hoistId);
  const list = state.data.lists[state.listId];
  let h = `<span class="crumb" onclick="App.unHoist()">⊞ ${esc(list ? list.name : '')}</span>`;
  for (const a of ancestors) {
    h += `<span style="color:var(--muted)">›</span><span class="crumb" onclick="App.hoistTask('${a.id}')">${esc(a.content.slice(0,35))}</span>`;
  }
  h += `<span style="color:var(--muted)">›</span>`;
  const ht = state.data.tasks[state.hoistId];
  h += `<span style="font-weight:600">${esc((ht ? ht.content : '').slice(0,35))}</span>`;
  bc.innerHTML = h;
}

function openListUi(app, state, id) {
  state.listId = id;
  state.selId = null;
  state.hoistId = null;
  state.filter = '';
  const s = document.getElementById('search');
  s.value = '';
  s.classList.remove('has-v');
  app.showPage('list');
}

function filterTagUi(app, state, tg) {
  state.filter = '#' + tg;
  const s = document.getElementById('search');
  s.value = '#' + tg;
  s.classList.add('has-v');
  app.showPage('list');
}

function renderDueUi(app, state) {
  const sections = app.select('due.sections');
  let h = sections.map(sec => {
    const items = sec.items;
    if (!items.length) return '';
    return `<div class="dsec"><div class="dsec-h">${sec.title} (${items.length})</div>${items.map(t => {
      const l = state.data.lists[t.checklist_id];
      return `<div class="dti" onclick="App.jumpTo('${t.id}')">
        <input type="checkbox" ${t.status === 1 ? 'checked' : ''} onclick="event.stopPropagation();App.toggleStatus('${t.id}')">
        <div style="flex:1"><div>${esc(t.content.slice(0,80))}</div><div class="dlist">${l ? esc(l.name) : ''}</div></div>
        <div style="font-size:11px;color:var(--muted)">${fmtDue(t, state.data.settings.relativeDates)}</div>
      </div>`;
    }).join('')}</div>`;
  }).join('');

  if (!h) {
    h = '<div class="empty"><div style="font-size:40px;margin-bottom:12px">🗓</div><div class="empty-t">No due tasks</div><div class="empty-d">Add due dates with ^today, ^tomorrow, or press <strong>dd</strong>.</div></div>';
  }
  document.getElementById('due-c').innerHTML = h;
}

function renderTagsUi(app) {
  const cloud = app.select('tags.cloud');
  const tags = cloud.tags;
  const map = cloud.map;
  if (!tags.length) {
    document.getElementById('tags-c').innerHTML = '<div class="empty"><div class="empty-t">No tags yet</div></div>';
    return;
  }
  document.getElementById('tags-c').innerHTML = `<div class="tag-cloud">${tags.map(tg => `<span class="tci" onclick="App.filterTag('${esc(tg)}')">#${esc(tg)}<span class="tc2">${map[tg]}</span></span>`).join('')}</div>`;
}

function renderKanbanUi(app, state) {
  const list = state.data.lists[state.listId];
  if (!list) {
    app.showPage('home');
    return;
  }

  const order = [];
  const walk = (ids) => {
    for (const id of ids || []) {
      const t = state.data.tasks[id];
      if (!t || t.deleted) continue;
      order.push(t);
      walk(t.tasks || []);
    }
  };
  walk(list.root_tasks || []);

  if (!order.length) {
    document.getElementById('kanban-c').innerHTML = '<div class="empty"><div class="empty-t">No tasks yet</div><div class="empty-d">Add tasks in list view to populate your Kanban board.</div></div>';
    return;
  }

  const groups = [
    { title: 'Open', cls: 'open', items: order.filter(t => Number(t.status || 0) === 0), empty: 'No open tasks' },
    { title: 'Done', cls: 'done', items: order.filter(t => Number(t.status || 0) === 1), empty: 'No done tasks' },
    { title: 'Invalid', cls: 'invalid', items: order.filter(t => Number(t.status || 0) === 2), empty: 'No invalid tasks' }
  ];

  document.getElementById('kanban-c').innerHTML = `<div class="kanban-grid">${groups.map(group => {
    return `<section class="kanban-col ${group.cls}">
      <div class="kanban-col-h">${group.title} (${group.items.length})</div>
      <div class="kanban-col-b">${group.items.length
        ? group.items.map(t => `<div class="kanban-card" onclick="App.jumpTo('${t.id}')">
            <input type="checkbox" ${Number(t.status || 0) === 1 ? 'checked' : ''} onclick="event.stopPropagation();App.toggleStatus('${t.id}')">
            <div class="kanban-card-c">${esc((t.content || '').slice(0, 140))}</div>
          </div>`).join('')
        : `<div class="kanban-empty">${group.empty}</div>`}
      </div>
    </section>`;
  }).join('')}</div>`;
}

function ensureSelectionVisibleUi(app, state) {
  const visible = app.visible();

  if (!visible.length) {
    state.selId = null;
    if (state.msel) state.msel.clear();
    return;
  }

  if (state.selId && !visible.includes(state.selId)) {
    state.selId = visible[0];
  }

  if (state.msel && state.msel.size) {
    for (const id of Array.from(state.msel)) {
      if (!visible.includes(id)) state.msel.delete(id);
    }
  }
}

function renderListUi(app, state) {
  const list = state.data.lists[state.listId];
  if (!list) {
    app.showPage('home');
    return;
  }

  ensureSelectionVisibleUi(app, state);

  document.getElementById('list-title').textContent = list.name;
  app.renderBreadcrumbs();

  const roots = state.hoistId ? [state.hoistId] : (list.root_tasks || []);
  const html = buildTaskTreeUi(app, state, roots, 0, list);
  document.getElementById('task-list').innerHTML = html || `<div class="empty">
      <div style="font-size:40px;margin-bottom:12px">📋</div>
      <div class="empty-t">No tasks yet</div>
      <div class="empty-d">Press <strong>Enter</strong> to add your first task.</div></div>`;

  bindTaskListEvents(app, state);
  requestAnimationFrame(() => app.scrollSel());
}

function buildTaskTreeUi(app, state, ids, depth, list) {
  const gs = state.data.settings;
  let list2 = ids || [];

  if (state.filter) list2 = filterIdsUi(app, state, list2);
  if (!gs.showCompleted) list2 = list2.filter(id => {
    const t = state.data.tasks[id];
    return t && t.status === 0;
  });

  if (gs.moveCompletedDown) {
    const open = list2.filter(id => {
      const t = state.data.tasks[id];
      return t && t.status === 0;
    });
    const done = list2.filter(id => {
      const t = state.data.tasks[id];
      return t && t.status !== 0;
    });
    list2 = [...open, ...done];
  }

  if (gs.hideFuture) {
    list2 = list2.filter(id => {
      const t = state.data.tasks[id];
      if (!t) return false;
      if (!t.due && !t.due_asap) return true;
      const c = getDueCls(t);
      return ['ov', 'tod', 'tom', 'asap', ''].includes(c);
    });
  }

  return list2.map(id => buildTaskItemUi(app, state, id, depth, list)).join('');
}

function resolveWikiTargetTaskId(state, rawTarget) {
  const target = String(rawTarget || '').trim();
  if (!target) return '';

  const tasks = Object.values(state.data.tasks || {}).filter(t => t && !t.deleted);
  const norm = s => String(s || '').trim().toLowerCase();

  if (state.data.tasks[target]) return target;
  if (target.startsWith('#task-')) {
    const id = target.slice('#task-'.length);
    if (state.data.tasks[id]) return id;
  }

  const listSep = target.includes('::') ? '::' : (target.includes('/') ? '/' : '');
  if (listSep) {
    const parts = target.split(listSep);
    const listName = parts[0];
    const taskText = parts.slice(1).join(listSep).trim();
    const list = Object.values(state.data.lists || {}).find(l => norm(l.name) === norm(listName));
    if (list && taskText) {
      const listTasks = tasks.filter(t => t.checklist_id === list.id);
      const exact = listTasks.find(t => norm(t.content) === norm(taskText));
      if (exact) return exact.id;
      const partial = listTasks.find(t => norm(t.content).includes(norm(taskText)));
      if (partial) return partial.id;
    }
  }

  const exactGlobal = tasks.find(t => norm(t.content) === norm(target));
  if (exactGlobal) return exactGlobal.id;
  const partialGlobal = tasks.find(t => norm(t.content).includes(norm(target)));
  return partialGlobal ? partialGlobal.id : '';
}

function applyWikiLinksInContent(state, content) {
  return String(content || '').replace(/\[\[([^\]]+)\]\]/g, (full, rawLabel) => {
    const label = String(rawLabel || '').replace(/[\r\n\[\]]/g, ' ').trim();
    if (!label) return full;
    const targetId = resolveWikiTargetTaskId(state, label);
    if (!targetId) return full;
    return `[${label}](#task-${targetId})`;
  });
}

function buildTaskItemUi(app, state, id, depth, list) {
  const t = state.data.tasks[id];
  if (!t || t.deleted) return '';

  const isSel = state.selId === id;
  const isMsel = state.msel.has(id);
  const isEdit = state.editId === id;
  const hasKids = t.tasks && t.tasks.length > 0;
  const colCls = t.color > 0 ? ` priority-${t.color}` : '';
  const sCls = ` s${t.status}`;
  const selCls = isSel ? ' sel' : '';
  const mselCls = isMsel ? ' msel' : '';
  const guides = Array(depth).fill('<div class="ig"></div>').join('');

  const tog = hasKids
    ? `<div class="tog${t._collapsed ? ' coll' : ' exp'}" data-id="${id}" data-a="tog">${t._collapsed ? '▶' : '▼'}</div>`
    : `<div class="tog leaf">•</div>`;

  const lStyle = list ? list.style : 'none';
  const ckd = t.status === 1 ? 'checked' : '';
  const cb = `<input type="checkbox" class="tcb" data-id="${id}" data-a="sts" ${ckd}>`;
  const disp = t.content.replace(/^\[\*\]\s*/, '').replace(/^\[\d\]\s*/, '');
  const wikiAwareContent = applyWikiLinksInContent(state, disp);
  let rendered = md(wikiAwareContent);

  if (state.filter) {
    const words = state.filter
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w && !/^[#@^]/.test(w) && !w.includes(':'));

    for (const w of words) {
      const re = new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
      rendered = rendered.replace(re, '<mark>$1</mark>');
    }
  }

  let metaH = '';
  if (t.due || t.due_asap) {
    const c = getDueCls(t);
    metaH += `<span class="tdue ${c}" data-id="${id}" data-a="due">${fmtDue(t, state.data.settings.relativeDates)}</span>`;
  }
  if (t.repeating_due) metaH += `<span class="trep" data-id="${id}" data-a="repeat">🔁</span>`;
  if (t.tags_as_text) {
    metaH += `<span class="ttags">${t.tags_as_text
      .split(',')
      .filter(Boolean)
      .map(tg => `<span class="ttag" data-tag="${tg.trim()}" data-a="ftag">#${esc(tg.trim())}</span>`)
      .join('')}</span>`;
  }
  if (t.assignees && t.assignees.length) metaH += t.assignees.map(a => `<span class="tass">@${esc(a)}</span>`).join('');
  if (t.comments_count > 0) metaH += `<span class="tni" data-id="${id}" data-a="notes">💬 ${t.comments_count}</span>`;
  if (state.data.settings.showTaskJsonChip !== false) {
    metaH += `<span class="tjson" data-id="${id}" data-a="json">{ }</span>`;
  }
  if (state.data.settings.showTaskHistoryChip !== false) {
    metaH += `<span class="thist" data-id="${id}" data-a="hist">H</span>`;
  }

  const detailH = `<div class="tdetail" id="dtl-${id}">Created: ${(t.created_at || '').slice(0,10)}${t.updated_at ? ` · Updated: ${t.updated_at.slice(0,10)}` : ''}${t.completed_at ? ` · Done: ${t.completed_at.slice(0,10)}` : ''}</div>`;
  let notesH = '';
  if (state.showNotes && t.notes && t.notes.length) {
    notesH = `<div class="tnotes">${t.notes.map(n => `<div class="tnote"><div class="na">${esc(n.author)} · ${(n.created_at || '').slice(0,10)}</div><div>${md(n.content)}</div></div>`).join('')}</div>`;
  }

  let pfx = '';
  if (lStyle === 'numbered') {
    const si = sibIndexUi(state, id);
    pfx = `<span style="color:var(--muted);font-size:12px;margin-right:4px;min-width:18px;text-align:right">${si}.</span>`;
  } else if (lStyle === 'bullets') {
    pfx = `<span style="color:var(--muted);margin-right:4px">•</span>`;
  }

  const bodyH = isEdit
    ? `<div class="tb"><textarea class="edit-area" id="ea-${id}" data-id="${id}">${esc(t.content)}</textarea><div class="iac" id="iac-${id}"></div></div>`
    : `<div class="tb"><div class="tline"><div class="tc">${pfx}${rendered}</div>${metaH ? `<div class="tmeta">${metaH}</div>` : ''}</div>${detailH}${notesH}</div>`;

  let html = `<div class="ti${sCls}${colCls}${selCls}${mselCls}" data-id="${id}" data-depth="${depth}" draggable="true">
      ${t.color > 0 ? '<div class="cbar"></div>' : ''}
      <div style="display:flex">${guides}</div>${tog}${cb}${bodyH}</div>`;

  if (hasKids && !t._collapsed) html += buildTaskTreeUi(app, state, t.tasks || [], depth + 1, list);
  return html;
}
