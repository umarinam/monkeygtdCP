'use strict';

// Bookmarks live in state.data.bookmarks, so they sync with the rest of the data:
// { id, name, listId, taskId, filter, shortcut: '' | 'b0'..'b9', created_at, updated_at }.
// A blank name means "named after the task or list", which then follows renames.
const BOOKMARK_SHORTCUTS = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b0'];

function bookmarkListDomain(state) {
  if (!Array.isArray(state.data.bookmarks)) state.data.bookmarks = [];
  return state.data.bookmarks;
}

function bookmarkByShortcutDomain(state, shortcut) {
  return bookmarkListDomain(state).find(b => b.shortcut === shortcut) || null;
}

// Called for every rendered row, so it reads without creating the bookmarks array.
function bookmarksForTaskDomain(state, taskId) {
  const bookmarks = state.data.bookmarks;
  return Array.isArray(bookmarks) ? bookmarks.filter(b => b.taskId === taskId) : [];
}

// Where a bookmark points now: its task's current list (tasks can move), else the list it was saved in.
function bookmarkTargetDomain(state, b) {
  const t = b.taskId ? state.data.tasks[b.taskId] : null;
  const task = t && !t.deleted ? t : null;
  const listId = task ? task.checklist_id : b.listId;
  const list = state.data.lists[listId] || null;
  return { task, list, listId, taskMissing: !!b.taskId && !task, listMissing: !list };
}

function bookmarkTaskTextDomain(content) {
  const firstLine = String(content || '').split('\n')[0];
  const text = stripLinkTargetsForSmartParsing(firstLine).replace(/\s+/g, ' ').trim();
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function bookmarkNameDomain(state, b) {
  const name = String(b.name || '').trim();
  if (name) return name;
  const t = b.taskId ? state.data.tasks[b.taskId] : null;
  if (t) return bookmarkTaskTextDomain(t.content) || '(untitled task)';
  if (b.taskId) return '(deleted task)';
  const list = state.data.lists[b.listId];
  return list ? list.name : '(deleted list)';
}

// The bookmark a new one would replace: the same task, or the same list with the same filter.
function findBookmarkDomain(state, { taskId, listId, filter }) {
  return bookmarkListDomain(state).find(b => (taskId
    ? b.taskId === taskId
    : !b.taskId && b.listId === listId && (b.filter || '') === (filter || ''))) || null;
}

function saveBookmarkDomain(app, state, input) {
  const bookmarks = bookmarkListDomain(state);
  const taskId = input.taskId || '';
  const task = taskId ? state.data.tasks[taskId] : null;
  if (taskId && (!task || task.deleted)) return { bookmark: null, error: 'That task no longer exists' };
  const listId = task ? task.checklist_id : input.listId;
  if (!state.data.lists[listId]) return { bookmark: null, error: 'That list no longer exists' };

  const filter = String(input.filter || '').trim();
  const shortcut = BOOKMARK_SHORTCUTS.includes(input.shortcut) ? input.shortcut : '';
  const stamp = now();
  let b = (input.id && bookmarks.find(x => x.id === input.id)) || findBookmarkDomain(state, { taskId, listId, filter });
  if (!b) {
    b = { id: uid(), created_at: stamp };
    bookmarks.push(b);
  }
  Object.assign(b, { name: String(input.name || '').trim(), listId, taskId, filter, shortcut, updated_at: stamp });
  if (shortcut) {
    for (const other of bookmarks) if (other !== b && other.shortcut === shortcut) other.shortcut = '';
  }

  app.save();
  return { bookmark: b, error: '' };
}

function removeBookmarksDomain(app, state, ids) {
  const doomed = new Set(ids || []);
  const bookmarks = bookmarkListDomain(state);
  const kept = bookmarks.filter(b => !doomed.has(b.id));
  const removed = bookmarks.length - kept.length;
  if (removed) {
    state.data.bookmarks = kept;
    app.save();
  }
  return removed;
}
