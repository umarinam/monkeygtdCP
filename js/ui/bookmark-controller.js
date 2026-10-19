'use strict';

function bookmarkByIdUi(state, id) {
  return bookmarkListDomain(state).find(b => b.id === id) || null;
}

function bookmarkSelectedTaskUi(state) {
  const t = state.selId ? state.data.tasks[state.selId] : null;
  return t && !t.deleted ? t : null;
}

// ab: bookmark the selected task, or the current list when nothing is selected.
function openBookmarkDialogUi(app, state, opts = {}) {
  const task = bookmarkSelectedTaskUi(state);
  const listId = task ? task.checklist_id : state.listId;
  if (!listId || !state.data.lists[listId]) {
    app.toast('Open a list or select a task to bookmark');
    return;
  }

  state.bookmarkDraft = { taskId: task ? task.id : '', listId, currentFilter: String(state.filter || '').trim(), id: '', filter: '' };
  document.getElementById('bm-target').value = task ? 'task' : 'list';
  document.getElementById('bm-target-row').style.display = task ? '' : 'none';
  refreshBookmarkDialogUi(app, state, opts.shortcut);
  app.openModal('ov-bookmark');
  setTimeout(() => document.getElementById('bm-name').focus(), 50);
}

// Fills the dialog for the chosen target, editing that target's bookmark when it has one.
function refreshBookmarkDialogUi(app, state, shortcut) {
  const draft = state.bookmarkDraft;
  if (!draft) return;
  const el = id => document.getElementById(id);
  const useTask = !!draft.taskId && el('bm-target').value !== 'list';
  const existing = useTask
    ? findBookmarkDomain(state, { taskId: draft.taskId })
    : (draft.currentFilter && findBookmarkDomain(state, { listId: draft.listId, filter: draft.currentFilter }))
      || findBookmarkDomain(state, { listId: draft.listId, filter: '' });

  draft.id = existing ? existing.id : '';
  draft.filter = (existing && existing.filter) || draft.currentFilter;

  const holder = s => bookmarkListDomain(state).find(b => b.shortcut === s && b.id !== draft.id);
  el('bm-shortcut').innerHTML = '<option value="">None</option>' + BOOKMARK_SHORTCUTS.map(s => {
    const h = holder(s);
    return `<option value="${s}">${esc(h ? `${s} - now "${bookmarkNameDomain(state, h)}"` : s)}</option>`;
  }).join('');
  el('bm-shortcut').value = shortcut || (existing ? existing.shortcut : '');

  el('bm-title').textContent = existing ? 'Edit Bookmark' : 'Add Bookmark';
  el('bm-name').value = existing ? existing.name : '';
  el('bm-name').placeholder = useTask
    ? bookmarkTaskTextDomain(state.data.tasks[draft.taskId].content)
    : state.data.lists[draft.listId].name;
  el('bm-filter').checked = !!(existing && existing.filter);
  el('bm-filter-label').textContent = `Also apply the filter ${draft.filter}`;
  el('bm-filter-row').style.display = draft.filter ? '' : 'none';
  el('bm-remove').style.display = existing ? '' : 'none';
}

function saveBookmarkDialogUi(app, state) {
  const draft = state.bookmarkDraft;
  if (!draft) return;
  const el = id => document.getElementById(id);
  const useTask = !!draft.taskId && el('bm-target').value !== 'list';
  const res = app.dispatch('bookmark.save', {
    id: draft.id,
    taskId: useTask ? draft.taskId : '',
    listId: draft.listId,
    name: el('bm-name').value,
    filter: el('bm-filter').checked ? draft.filter : '',
    shortcut: el('bm-shortcut').value
  });
  if (!res || res.error) {
    app.toast((res && res.error) || 'Could not save the bookmark');
    return;
  }

  state.bookmarkDraft = null;
  app.closeModal('ov-bookmark');
  app.render();
  const b = res.bookmark;
  app.toast(`Bookmarked "${bookmarkNameDomain(state, b)}"${b.shortcut ? ` - press ${b.shortcut} to open it` : ''}`);
}

function removeBookmarkByIdUi(app, state, id) {
  const b = bookmarkByIdUi(state, id);
  if (!b) return;
  const name = bookmarkNameDomain(state, b);
  app.dispatch('bookmark.remove', { ids: [id] });
  app.render();
  app.toast(`Removed bookmark "${name}"`);
}

function removeBookmarkDialogUi(app, state) {
  const draft = state.bookmarkDraft;
  if (!draft || !draft.id) return;
  state.bookmarkDraft = null;
  app.closeModal('ov-bookmark');
  removeBookmarkByIdUi(app, state, draft.id);
}

// Opens the bookmark's list (with its filter), hoisting a task that has sub-tasks or selecting a leaf.
function openBookmarkUi(app, state, id) {
  const b = bookmarkByIdUi(state, id);
  if (!b) return;
  const target = bookmarkTargetDomain(state, b);
  if (target.listMissing) {
    app.toast(`Bookmark "${bookmarkNameDomain(state, b)}": its list was deleted`);
    return;
  }

  app.openList(target.listId);
  const task = target.task;
  if (task) {
    const hasSubtasks = (task.tasks || []).some(cid => state.data.tasks[cid] && !state.data.tasks[cid].deleted);
    if (hasSubtasks) state.hoistId = task.id;
    app.jumpTo(task.id);
  }
  if (b.filter) {
    const srch = document.getElementById('search');
    if (srch) srch.value = b.filter;
    applySearchInputUi(app, state, b.filter);
  }
  app.toast(target.taskMissing
    ? `The bookmarked task was deleted - opened "${target.list.name}"`
    : `Opened bookmark "${bookmarkNameDomain(state, b)}"`);
}

// b0-b9: open the bookmark on that digit; in a list with none on it, offer to set it.
function openBookmarkByShortcutUi(app, state, digit) {
  const shortcut = `b${digit}`;
  const b = bookmarkByShortcutDomain(state, shortcut);
  if (b) {
    openBookmarkUi(app, state, b.id);
    return;
  }
  if (state.page === 'list' && state.data.lists[state.listId]) {
    openBookmarkDialogUi(app, state, { shortcut });
    return;
  }
  app.toast(`No bookmark on ${shortcut} - open a list and press ${shortcut} to set one`);
}

function moveToBookmarkUi(app, state, id) {
  const b = bookmarkByIdUi(state, id);
  if (!b) return;
  if (!app.selectedIds().length) {
    app.toast('Select the task(s) to move first');
    return;
  }
  const target = bookmarkTargetDomain(state, b);
  if (target.listMissing || target.taskMissing) {
    app.toast(`Bookmark "${bookmarkNameDomain(state, b)}" points to a deleted ${target.listMissing ? 'list' : 'task'}`);
    return;
  }
  if (target.task) app.moveToTask(target.task.id);
  else app.moveToList(target.listId);
}

// cb: remove the bookmarks on the selected tasks, or the list's own bookmarks when nothing is selected.
function removeBookmarksHereUi(app, state) {
  const ids = app.selectedIds();
  let doomed;
  if (ids.length) {
    const selected = new Set(ids);
    doomed = bookmarkListDomain(state).filter(b => b.taskId && selected.has(b.taskId));
    if (!doomed.length) {
      app.toast('No bookmark on the selected task(s)');
      return;
    }
  } else {
    doomed = bookmarkListDomain(state).filter(b => !b.taskId && b.listId === state.listId);
    if (!doomed.length) {
      app.toast('This list has no bookmark');
      return;
    }
  }
  const removed = app.dispatch('bookmark.remove', { ids: doomed.map(b => b.id) });
  app.render();
  app.toast(`Removed ${removed} bookmark${removed === 1 ? '' : 's'}`);
}

function openBookmarkPickerUi(app, state, mode) {
  if (!bookmarkListDomain(state).length) {
    app.toast('No bookmarks yet - press ab to bookmark a task or list');
    return;
  }
  if (mode === 'bookmarks-move' && !app.selectedIds().length) {
    app.toast('Select the task(s) to move first');
    return;
  }
  app.openCP(mode);
}

// Palette rows for the bookmark pickers: 'bookmarks' opens, 'bookmarks-move' moves, 'bookmarks-remove' removes.
function buildBookmarkPaletteItems(app, state, mode) {
  const run = mode === 'bookmarks-move' ? moveToBookmarkUi
    : mode === 'bookmarks-remove' ? removeBookmarkByIdUi
    : openBookmarkUi;
  return bookmarkListDomain(state).map(b => {
    const target = bookmarkTargetDomain(state, b);
    const parts = [`★ ${bookmarkNameDomain(state, b)}`];
    if (target.listMissing) parts.push('list deleted');
    else if (target.taskMissing) parts.push('task deleted');
    else if (target.task) parts.push(target.list.name);
    if (b.filter) parts.push(`filter ${b.filter}`);
    return { l: parts.join(' · '), s: b.shortcut || '', fn: () => run(app, state, b.id) };
  });
}

// In a bookmark picker with an empty filter, a digit picks the bookmark on it at once (so "m b 1" works).
function bookmarkPaletteDigitUi(app, state, key) {
  const mode = String(state.cpMode || '');
  if (!mode.startsWith('bookmarks') || !/^[0-9]$/.test(key)) return false;
  const input = document.getElementById('cpi');
  if (input && input.value) return false;
  const item = buildBookmarkPaletteItems(app, state, mode).find(i => i.s === `b${key}`);
  if (!item) return false;
  app.closeCP();
  item.fn();
  return true;
}

function bookmarkChipUi(state, taskId) {
  const marks = bookmarksForTaskDomain(state, taskId);
  if (!marks.length) return '';
  const keys = marks.map(b => b.shortcut).filter(Boolean).join(' ');
  const title = `Bookmark: ${marks.map(b => bookmarkNameDomain(state, b)).join(', ')} - click to edit`;
  return `<span class="tbm" data-id="${taskId}" data-a="bm" title="${esc(title)}">★${keys ? ` ${keys}` : ''}</span>`;
}
