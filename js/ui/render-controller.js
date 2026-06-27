'use strict';

function bindTaskListEvents(app, state) {
  const tl = document.getElementById('task-list');

  tl.onclick = e => {
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
  ['home-page', 'list-page', 'due-page', 'tags-page'].forEach(id => {
    document.getElementById(id).classList.add('hidden');
  });
  const map = { home: 'home-page', list: 'list-page', due: 'due-page', tags: 'tags-page' };
  document.getElementById(map[p]).classList.remove('hidden');
  renderCurrentPageUi(app, state);
}

function renderCurrentPageUi(app, state) {
  if (state.page === 'home') app.renderHome();
  else if (state.page === 'list') app.renderList();
  else if (state.page === 'due') app.renderDue();
  else if (state.page === 'tags') app.renderTags();
  app.syncSB();
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

function renderListUi(app, state) {
  const list = state.data.lists[state.listId];
  if (!list) {
    app.showPage('home');
    return;
  }

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
  let rendered = md(disp);

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
