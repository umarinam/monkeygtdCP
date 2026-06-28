'use strict';

function startEditUi(app, S, id, pos) {
  if (S.editId && S.editId !== id) app.commitEdit(S.editId);
  S.editId = id;
  S.selId = id;
  app.renderList();
  const el = document.getElementById(`ea-${id}`);
  if (!el) return;
  app.hideInlineAutocomplete();
  el.focus();
  if (pos === 'start') el.setSelectionRange(0, 0);
  else el.setSelectionRange(el.value.length, el.value.length);
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  el.addEventListener('input', () => {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
    app.updateInlineAutocomplete(id, el);
  });
  el.addEventListener('keydown', e => app.editKey(e, id));
  el.addEventListener('click', () => app.updateInlineAutocomplete(id, el));
  el.addEventListener('keyup', () => app.updateInlineAutocomplete(id, el));
  el.addEventListener('blur', () => {
    if (S.editId === id) app.commitEdit(id);
  });
  app.updateInlineAutocomplete(id, el);
}

function editKeyUi(app, S, e, id) {
  if (app.isInlineAutocompleteOpen()) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      app.moveInlineAutocomplete(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      app.moveInlineAutocomplete(-1);
      return;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      app.acceptInlineAutocomplete();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      app.hideInlineAutocomplete();
      return;
    }
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    S.editId = null;
    app.renderList();
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    const el = document.getElementById(`ea-${id}`);
    if (el) {
      app.saveEdit(id, el.value);
      S.editId = null;
    }
    const nid = app.addTask(id, false, '');
    app.renderList();
    app.startEdit(nid);
    return;
  }
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    const el = document.getElementById(`ea-${id}`);
    if (el) app.saveEdit(id, el.value);
    S.editId = null;
    app.renderList();
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const el = document.getElementById(`ea-${id}`);
    if (el) {
      app.saveEdit(id, el.value);
      S.editId = null;
    }
    if (e.shiftKey) app.unindent(id);
    else app.indent(id);
    app.startEdit(id);
    return;
  }
}

function commitEditUi(app, S, id) {
  const el = document.getElementById(`ea-${id}`);
  if (!el) return;
  app.hideInlineAutocomplete();
  const v = el.value.trim();
  if (v) app.saveEdit(id, v);
  else {
    const t = S.data.tasks[id];
    if (t && !t.content) app.deleteTask(id);
  }
  if (S.editId === id) {
    S.editId = null;
    app.renderList();
  }
}

function isInlineAutocompleteOpenUi(S) {
  return !!S.iac.open && S.iac.items.length > 0;
}

function hideInlineAutocompleteUi(S) {
  const id = S.iac.taskId;
  if (id) {
    const box = document.getElementById(`iac-${id}`);
    if (box) {
      box.classList.remove('on');
      box.innerHTML = '';
    }
  }
  S.iac = { open: false, taskId: null, type: '', query: '', start: 0, end: 0, items: [], index: 0 };
}

function updateInlineAutocompleteUi(app, S, id, el) {
  const box = document.getElementById(`iac-${id}`);
  if (!box || !el) {
    app.hideInlineAutocomplete();
    return;
  }
  const caret = el.selectionStart || 0;
  const before = el.value.slice(0, caret);
  const m = before.match(/(^|\s)([#@])([\w-]*)$/);
  const wm = before.match(/\[\[([^\]]*)$/);
  if (!m && !wm) {
    app.hideInlineAutocomplete();
    return;
  }

  const prevType = S.iac.type;
  const prevQuery = S.iac.query;
  const type = m ? (m[2] === '#' ? 'tag' : 'assign') : 'wiki';
  const rawQ = m ? (m[3] || '') : (wm[1] || '');
  const q = rawQ.toLowerCase();
  const start = caret - rawQ.length;
  const end = caret;
  const items = type === 'tag'
    ? app.getTagSuggestions(q)
    : type === 'assign'
      ? app.getAssigneeSuggestions(q)
      : getWikiSuggestionsUi(S, q);
  if (!items.length) {
    app.hideInlineAutocomplete();
    return;
  }

  S.iac.open = true;
  S.iac.taskId = id;
  S.iac.type = type;
  S.iac.query = q;
  S.iac.start = start;
  S.iac.end = end;
  if (!S.iac.items.length || prevType !== type || prevQuery !== q) S.iac.index = 0;
  S.iac.items = items;
  app.renderInlineAutocomplete();
}

function getTagSuggestionsUi(S, q) {
  const set = new Set();
  Object.values(S.data.tasks).forEach(t => Object.keys(t.tags || {}).forEach(tag => set.add(tag)));
  Object.values(S.data.lists).forEach(l => (l.tags || []).forEach(tag => set.add(tag)));
  return [...set].filter(tag => !q || tag.toLowerCase().includes(q)).sort().slice(0, 8);
}

function getAssigneeSuggestionsUi(S, q) {
  const set = new Set();
  Object.values(S.data.tasks).forEach(t => (t.assignees || []).forEach(a => set.add(a)));
  return [...set].filter(a => !q || a.toLowerCase().includes(q)).sort().slice(0, 8);
}

function getWikiSuggestionsUi(S, q) {
  const norm = s => String(s || '').trim().toLowerCase();
  const out = new Set();
  const tasks = Object.values(S.data.tasks || {}).filter(t => t && !t.deleted && String(t.content || '').trim());

  for (const t of tasks) {
    const list = (S.data.lists || {})[t.checklist_id] || null;
    const title = String(t.content || '').trim().replace(/\s+/g, ' ');
    if (!title) continue;
    out.add(title);
    if (list && list.name) out.add(`${String(list.name).trim()}::${title}`);
  }

  return [...out]
    .filter(v => !q || norm(v).includes(q))
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 8);
}

function renderInlineAutocompleteUi(app, S) {
  if (!S.iac.open || !S.iac.taskId) return;
  const box = document.getElementById(`iac-${S.iac.taskId}`);
  if (!box) return;
  box.innerHTML = S.iac.items
    .map(
      (item, i) =>
        `<div class="iaci${i === S.iac.index ? ' on' : ''}" data-idx="${i}"><span>${S.iac.type === 'tag' ? '#' : S.iac.type === 'assign' ? '@' : '[['}${esc(item)}${S.iac.type === 'wiki' ? ']]' : ''}</span><span class="iacp">${S.iac.type === 'tag' ? 'tag' : S.iac.type === 'assign' ? 'assignee' : 'wiki link'}</span></div>`
    )
    .join('');
  box.classList.add('on');
  box.querySelectorAll('.iaci').forEach(row => {
    row.addEventListener('mousedown', ev => {
      ev.preventDefault();
      const idx = Number(row.getAttribute('data-idx'));
      app.acceptInlineAutocomplete(idx);
    });
  });
}

function moveInlineAutocompleteUi(app, S, dir) {
  if (!app.isInlineAutocompleteOpen()) return;
  const len = S.iac.items.length;
  S.iac.index = (S.iac.index + dir + len) % len;
  app.renderInlineAutocomplete();
}

function acceptInlineAutocompleteUi(app, S, forceIdx) {
  if (!app.isInlineAutocompleteOpen()) return;
  const id = S.iac.taskId;
  const el = document.getElementById(`ea-${id}`);
  if (!el) {
    app.hideInlineAutocomplete();
    return;
  }
  const idx = Number.isInteger(forceIdx) ? forceIdx : S.iac.index;
  const picked = S.iac.items[idx];
  const insert = S.iac.type === 'wiki' ? `${picked}]] ` : `${picked} `;
  el.value = el.value.slice(0, S.iac.start) + insert + el.value.slice(S.iac.end);
  const caret = S.iac.start + insert.length;
  el.focus();
  el.setSelectionRange(caret, caret);
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
  const editId = id;
  app.hideInlineAutocomplete();
  app.updateInlineAutocomplete(editId, el);
}
