'use strict';

function taskTextDomain(state, t, d) {
  let s = '  '.repeat(d) + t.content;
  for (const c of (t.tasks || [])) {
    const ct = state.data.tasks[c];
    if (ct) s += '\n' + taskTextDomain(state, ct, d + 1);
  }
  return s;
}

function canCopyChildTask(state, task) {
  if (!task || task.deleted) return false;
  if (state.data?.settings?.showCompleted === false && task.status !== 0) return false;
  if (state.data?.settings?.hideFuture) {
    if (task.due_asap) return true;
    if (!task.due) return true;
    const dueClass = getDueCls(task);
    return ['overdue', 'tod', 'tom', ''].includes(dueClass);
  }
  return true;
}

function cloneVisibleBranchDomain(state, taskId, includeChildren) {
  const src = state.data.tasks[taskId];
  if (!src) return null;

  const onlyVisibleSubtasks = state.data?.settings?.copyOnlyVisibleSubtasks !== false;

  if (!onlyVisibleSubtasks) {
    const fullClone = JSON.parse(JSON.stringify(src));
    if (!includeChildren) fullClone.tasks = [];
    return fullClone;
  }

  const clone = JSON.parse(JSON.stringify(src));
  const shouldIncludeChildren = includeChildren && !src._collapsed;
  if (!shouldIncludeChildren) {
    clone.tasks = [];
    return clone;
  }

  const visibleChildIds = [];
  for (const childId of (src.tasks || [])) {
    const child = state.data.tasks[childId];
    if (!canCopyChildTask(state, child)) continue;
    visibleChildIds.push(childId);
  }
  clone.tasks = visibleChildIds;
  return clone;
}

function taskCopyPrefixDomain(state, task) {
  if (state.data?.settings?.copyStatusPrefix !== true) return '';
  return task?.status === 1 ? '[X] ' : '[ ] ';
}

function taskTextFromSnapshotDomain(state, snapshot, tasksById, depth) {
  let out = '  '.repeat(depth) + taskCopyPrefixDomain(state, snapshot) + (snapshot.content || '');
  for (const childId of (snapshot.tasks || [])) {
    const child = tasksById[childId];
    if (!child) continue;
    out += '\n' + taskTextFromSnapshotDomain(state, child, tasksById, depth + 1);
  }
  return out;
}

function copyDomain(app, state) {
  const ids = state.msel.size ? [...state.msel] : (state.selId ? [state.selId] : []);
  if (!ids.length) return;

  const copiedTasks = {};
  const copyOne = (taskId, includeChildren) => {
    const cloned = cloneVisibleBranchDomain(state, taskId, includeChildren);
    if (!cloned) return null;
    copiedTasks[cloned.id] = cloned;
    for (const childId of (cloned.tasks || [])) {
      copyOne(childId, true);
    }
    return cloned;
  };

  state.clipboard = ids.map(id => copyOne(id, true)).filter(Boolean);

  navigator.clipboard?.writeText(
    state.clipboard.map(t => taskTextFromSnapshotDomain(state, t, copiedTasks, 0)).join('\n')
  ).catch(() => {});

  app.toast(`Copied ${ids.length} task(s)`);
}

function cutDomain(app, state) {
  copyDomain(app, state);
  const ids = state.msel.size ? [...state.msel] : (state.selId ? [state.selId] : []);
  for (const id of ids) app.deleteTask(id);
  app.render();
}

function pasteDomain(app, state) {
  if (!state.clipboard || !state.clipboard.length) return;

  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];

  for (const src of state.clipboard) {
    const nt = { ...src, id: uid(), created_at: now(), updated_at: now() };
    if (state.selId) {
      const ref = state.data.tasks[state.selId];
      const sibs = app.sibList(state.selId);
      if (sibs) {
        sibs.splice(sibs.indexOf(state.selId) + 1, 0, nt.id);
        nt.parent_id = ref.parent_id;
        nt.checklist_id = state.listId;
      }
    } else {
      list.root_tasks.push(nt.id);
      nt.parent_id = '';
      nt.checklist_id = state.listId;
    }
    state.data.tasks[nt.id] = nt;
    logTaskHistory(nt, 'creation', {
      source: 'paste',
      listId: nt.checklist_id,
      parentId: nt.parent_id || ''
    });
  }

  app.save();
  app.render();
}

function dupDomain(app, state, id) {
  if (!id) return;
  const src = state.data.tasks[id];
  if (!src) return;

  app.pushUndo(app.snap());
  const nt = {
    ...JSON.parse(JSON.stringify(src)),
    id: uid(),
    created_at: now(),
    updated_at: now()
  };
  const sibs = app.sibList(id);
  if (sibs) sibs.splice(sibs.indexOf(id) + 1, 0, nt.id);
  state.data.tasks[nt.id] = nt;
  logTaskHistory(nt, 'creation', {
    source: 'duplicate',
    listId: nt.checklist_id,
    parentId: nt.parent_id || ''
  });
  state.selId = nt.id;
  app.save();
  app.render();
  app.toast('Duplicated');
}

function copyWithUrlDomain(app, state) {
  if (!state.selId) return;
  const t = state.data.tasks[state.selId];
  if (!t) return;
  navigator.clipboard?.writeText(`[${t.content}](#task-${t.id})`).catch(() => {});
  app.toast('Copied with URL');
}

function copyPermalinkDomain(app, state) {
  if (!state.selId) return;
  const t = state.data.tasks[state.selId];
  if (!t) return;
  navigator.clipboard?.writeText(`#task-${t.id}`).catch(() => {});
  app.toast('Permalink copied');
}
