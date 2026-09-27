'use strict';

function restoreSelectedDomain(app, state, taskIds) {
  if (!taskIds || !taskIds.length) {
    app.toast('Select items to restore');
    return;
  }

  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];
  if (!list) return;

  for (const id of taskIds) {
    const item = (state.data.deletedItems || []).find(i => i.taskId === id);
    if (!item) continue;

    const task = { ...item.snapshot, deleted: false, _deleted_at: undefined };
    state.data.tasks[task.id] = task;
    list.root_tasks.unshift(task.id);
    task.parent_id = '';
    task.checklist_id = state.listId;
    logTaskHistory(task, 'deletion', { action: 'restore' });
    logTaskHistory(task, 'creation', {
      source: 'restore',
      listId: task.checklist_id,
      parentId: task.parent_id || ''
    });
  }

  app.save();
  app.closeModal('ov-restore');
  app.render();
  app.toast(`Restored ${taskIds.length} task(s)`);
}

function wipeCompletedDomain(app, state, walkTasksFn, skipChildren) {
  app.pushUndo(app.snap());

  const list = state.data.lists[state.listId];
  if (!list) return;

  walkTasksFn(list.root_tasks || [], state.data.tasks, task => {
    if (task.status !== 0) {
      logTaskHistory(task, 'deletion', { action: 'wipe-completed' });
      task.deleted = true;
      return skipChildren;
    }
  });

  const pruneChildren = ids => ids.filter(id => {
    const task = state.data.tasks[id];
    if (!task || task.deleted) return false;
    task.tasks = pruneChildren(task.tasks || []);
    return true;
  });

  list.root_tasks = pruneChildren(list.root_tasks || []);
  app.save();
  app.render();
  app.toast('Completed tasks wiped');
}

function resetCompletedDomain(app, state, walkTasksFn) {
  app.pushUndo(app.snap());

  const list = state.data.lists[state.listId];
  if (!list) return;

  walkTasksFn(list.root_tasks || [], state.data.tasks, task => {
    if (task.status !== 0) {
      const before = Number(task.status || 0);
      task.status = 0;
      task.completed_at = '';
      if (before !== 0) {
        logTaskHistory(task, 'status', { from: before, to: 0, source: 'reset-completed' });
      }
    }
  });

  app.save();
  app.render();
  app.toast('All tasks re-opened');
}

const OPTIMIZE_HISTORY_LIMIT = 4;

// Repo-wide cleanse used by "Optimize repo": drops untitled, completed and
// deleted tasks (hard delete, across every list) and trims per-task history.
// Operates on state.data only, no DOM, so it can run before a remote push.
function optimizeDataDomain(state, options) {
  const opts = options || {};
  const historyLimit = Number.isFinite(opts.historyLimit) ? Math.max(0, opts.historyLimit) : OPTIMIZE_HISTORY_LIMIT;
  const data = state.data;
  data.tasks = data.tasks || {};
  data.lists = data.lists || {};
  const tasks = data.tasks;
  const stats = {
    untitled: 0,
    completed: 0,
    deleted: 0,
    removed: 0,
    historyTrimmedTasks: 0,
    historyEntriesRemoved: 0,
    deletedItemsCleared: (data.deletedItems || []).length
  };

  const doomed = new Set();
  // Only follow child edges the child agrees with (parent_id match), so a stale
  // entry in a deleted task's `tasks` array can never take a live task with it.
  const doom = id => {
    if (doomed.has(id)) return;
    const task = tasks[id];
    if (!task) return;
    doomed.add(id);
    for (const childId of task.tasks || []) {
      if (tasks[childId]?.parent_id === id) doom(childId);
    }
  };

  const siblingsOf = task => {
    const parent = task.parent_id ? tasks[task.parent_id] : null;
    if (parent && (parent.tasks || []).includes(task.id)) return parent.tasks;
    const own = data.lists[task.checklist_id];
    if (own && (own.root_tasks || []).includes(task.id)) return own.root_tasks;
    const other = Object.values(data.lists).find(l => (l.root_tasks || []).includes(task.id));
    return other ? other.root_tasks : null;
  };

  // Untitled tasks go, but their titled children move up into the vacated slot.
  for (const task of Object.values(tasks)) {
    if (task.deleted || doomed.has(task.id) || String(task.content || '').trim()) continue;
    const children = (task.tasks || []).filter(cid => tasks[cid] && !tasks[cid].deleted && !doomed.has(cid) && tasks[cid].parent_id === task.id);
    if (children.length) {
      const sibs = siblingsOf(task);
      if (sibs) sibs.splice(sibs.indexOf(task.id), 1, ...children);
      for (const cid of children) tasks[cid].parent_id = task.parent_id || '';
      task.tasks = (task.tasks || []).filter(cid => !children.includes(cid));
    }
    stats.untitled++;
    doom(task.id);
  }

  // Completed (and invalidated) tasks go with their subtree, matching "Wipe completed".
  for (const task of Object.values(tasks)) {
    if (task.deleted || doomed.has(task.id) || Number(task.status || 0) === 0) continue;
    stats.completed++;
    doom(task.id);
  }

  for (const task of Object.values(tasks)) {
    if (!task.deleted || doomed.has(task.id)) continue;
    stats.deleted++;
    doom(task.id);
  }

  for (const id of doomed) delete tasks[id];
  stats.removed = doomed.size;

  const alive = id => !!tasks[id];
  for (const task of Object.values(tasks)) {
    if (Array.isArray(task.tasks)) task.tasks = task.tasks.filter(alive);
  }
  for (const list of Object.values(data.lists)) {
    if (Array.isArray(list.root_tasks)) list.root_tasks = list.root_tasks.filter(alive);
  }
  data.deletedItems = [];

  for (const task of Object.values(tasks)) {
    if (!Array.isArray(task.history) || task.history.length <= historyLimit) continue;
    stats.historyTrimmedTasks++;
    stats.historyEntriesRemoved += task.history.length - historyLimit;
    task.history = historyLimit ? task.history.slice(-historyLimit) : [];
  }

  if (state.selId && !alive(state.selId)) state.selId = null;
  if (state.editId && !alive(state.editId)) state.editId = null;
  if (state.hoistId && !alive(state.hoistId)) state.hoistId = null;
  if (state.msel && typeof state.msel.delete === 'function') {
    for (const id of Array.from(state.msel)) if (!alive(id)) state.msel.delete(id);
  }

  return stats;
}

function extractBranchDomain(app, state, walkTasksFn, uidFn, mkListFn, sibListFn) {
  const task = state.data.tasks[state.selId];
  if (!task) return;

  app.pushUndo(app.snap());

  const listId = uidFn();
  const list = mkListFn({
    id: listId,
    name: task.content.slice(0, 50),
    root_tasks: [...(task.tasks || [])]
  });
  state.data.lists[listId] = list;

  walkTasksFn(task.tasks || [], state.data.tasks, t => {
    const before = { checklist_id: t.checklist_id || '', parent_id: t.parent_id || '' };
    t.checklist_id = listId;
    logTaskHistory(t, 'structure', {
      action: 'extract-branch-rehome',
      from: before,
      to: { checklist_id: t.checklist_id || '', parent_id: t.parent_id || '' }
    });
  });

  const siblings = sibListFn(state.selId);
  if (siblings) {
    const idx = siblings.indexOf(state.selId);
    if (idx > -1) siblings.splice(idx, 1);
  }

  task.deleted = true;
  task.tasks = [];
  logTaskHistory(task, 'deletion', { action: 'extract-branch-source-removed', targetListId: listId });

  app.save();
  app.render();
  app.toast(`Extracted as "${list.name}"`);
  app.openList(listId);
}
