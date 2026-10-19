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

// Copy and cut write Markdown that other apps understand and importTextDomain reads back:
// "- [ ]" / "- [x]", ~~invalidated~~, two spaces per level, and each note line as "  > ".
function taskMarkdownFromSnapshotDomain(snapshot, tasksById, depth) {
  const pad = '  '.repeat(depth);
  const box = snapshot.status === 1 ? '[x]' : '[ ]';
  const text = String(snapshot.content || '').replace(/\r\n?|\n/g, `\n${pad}  `);
  const lines = [`${pad}- ${box} ${snapshot.status === 2 ? `~~${text}~~` : text}`];
  for (const note of (snapshot.notes || [])) {
    for (const line of String(note?.content || '').split(/\r\n?|\n/)) {
      if (line.trim()) lines.push(`${pad}  > ${line}`);
    }
  }
  for (const childId of (snapshot.tasks || [])) {
    const child = tasksById[childId];
    if (child) lines.push(taskMarkdownFromSnapshotDomain(child, tasksById, depth + 1));
  }
  return lines.join('\n');
}

// Snapshots the selected branches for an in-app paste and puts them on the system clipboard.
function rememberClipboardDomain(state, ids) {
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
  state.clipboardIndex = copiedTasks;

  navigator.clipboard?.writeText(
    state.clipboard.map(t => taskMarkdownFromSnapshotDomain(t, copiedTasks, 0)).join('\n')
  ).catch(() => {});
}

function clipboardRootIdsDomain(app, state) {
  return selectedMoveIds(app, state).filter(id => state.data.tasks[id] && !state.data.tasks[id].deleted);
}

function copyDomain(app, state) {
  const ids = clipboardRootIdsDomain(app, state);
  if (!ids.length) return;

  const hadCut = !!state.cutIds;
  rememberClipboardDomain(state, ids);
  state.cutIds = null;
  app.toast(`Copied ${ids.length} task(s)`);
  if (hadCut) app.render();
}

// Cut only marks the branches (drawn dimmed); the paste that follows moves them.
function cutDomain(app, state) {
  const ids = clipboardRootIdsDomain(app, state);
  if (!ids.length) return;

  rememberClipboardDomain(state, ids);
  state.cutIds = ids;
  app.toast(`Cut ${ids.length} task(s) - select where they go and press Ctrl+V`);
  app.render();
}

function clearCutDomain(app, state) {
  if (!state.cutIds) return false;
  state.cutIds = null;
  state.clipboard = null;
  state.clipboardIndex = null;
  app.render();
  return true;
}

function materializePastedChildrenDomain(state, index, snapshot, parentTask) {
  const childIds = [];
  for (const childId of (snapshot.tasks || [])) {
    const childSnapshot = index[childId];
    if (!childSnapshot) continue;
    const childNt = {
      ...childSnapshot,
      id: uid(),
      created_at: now(),
      updated_at: now(),
      parent_id: parentTask.id,
      checklist_id: parentTask.checklist_id
    };
    childNt.tasks = materializePastedChildrenDomain(state, index, childSnapshot, childNt);
    state.data.tasks[childNt.id] = childNt;
    childIds.push(childNt.id);
    logTaskHistory(childNt, 'creation', {
      source: 'paste',
      listId: childNt.checklist_id,
      parentId: childNt.parent_id || ''
    });
  }
  return childIds;
}

// Moves the cut branches themselves, so their ids, and with them permalinks, history, bookmarks
// and logged time, stay the same. They go below the selected task, else to the end of the list.
function pasteCutDomain(app, state) {
  const tasks = state.data.tasks;
  const live = state.cutIds.filter(id => tasks[id] && !tasks[id].deleted);
  const ids = live.filter(id => !live.some(other => other !== id && isAncestorOf(state, other, id)));
  if (!ids.length) {
    clearCutDomain(app, state);
    app.toast('Nothing to paste');
    return;
  }

  const ref = state.selId ? tasks[state.selId] : null;
  if (ref && ids.some(id => id === ref.id || isAncestorOf(state, id, ref.id))) {
    app.toast('Select a place outside the cut tasks, then paste');
    return;
  }

  const listId = ref ? ref.checklist_id : state.listId;
  const list = state.data.lists[listId];
  if (!list) return;

  app.pushUndo(app.snap());

  const from = {};
  for (const id of ids) {
    from[id] = { parent_id: tasks[id].parent_id || '', checklist_id: tasks[id].checklist_id || '' };
    const s = sibListDomain(state, id);
    const i = s ? s.indexOf(id) : -1;
    if (i > -1) s.splice(i, 1);
  }

  const refSibs = ref ? sibListDomain(state, ref.id) : null;
  const dest = refSibs || list.root_tasks;
  const parentId = refSibs ? (ref.parent_id || '') : '';
  let at = refSibs ? refSibs.indexOf(ref.id) + 1 : dest.length;

  for (const id of ids) {
    const t = tasks[id];
    t.parent_id = parentId;
    t.checklist_id = listId;
    setChecklistOnSubtree(state, id, listId);
    dest.splice(at++, 0, id);
    logTaskHistory(t, 'structure', {
      action: 'cut-paste',
      afterTaskId: refSibs ? ref.id : '',
      from: from[id],
      to: { parent_id: parentId, checklist_id: listId }
    });
  }

  state.cutIds = null;
  state.clipboard = null;
  state.clipboardIndex = null;
  state.selId = ids[0];
  state.msel = new Set(ids.length > 1 ? ids : []);

  app.save();
  app.render();
  app.toast(`Moved ${ids.length} task(s)`);
}

// After a copy, paste adds new copies (fresh ids) below the selected task, in clipboard order.
function pasteDomain(app, state) {
  if (state.cutIds) {
    pasteCutDomain(app, state);
    return;
  }
  if (!state.clipboard || !state.clipboard.length) return;

  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];
  const index = state.clipboardIndex || {};
  const ref = state.selId ? state.data.tasks[state.selId] : null;
  const sibs = ref ? app.sibList(state.selId) : null;
  let at = sibs ? sibs.indexOf(state.selId) + 1 : -1;

  for (const src of state.clipboard) {
    const nt = { ...src, id: uid(), created_at: now(), updated_at: now() };
    if (sibs) {
      sibs.splice(at++, 0, nt.id);
      nt.parent_id = ref.parent_id;
    } else {
      list.root_tasks.push(nt.id);
      nt.parent_id = '';
    }
    nt.checklist_id = state.listId;
    nt.tasks = materializePastedChildrenDomain(state, index, src, nt);
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

function duplicateChildrenDomain(app, state, srcParentId, newParentTask) {
  const srcParent = state.data.tasks[srcParentId];
  const childIds = [];
  for (const childId of (srcParent?.tasks || [])) {
    const childSrc = state.data.tasks[childId];
    if (!childSrc) continue;
    const childNt = {
      ...JSON.parse(JSON.stringify(childSrc)),
      id: uid(),
      created_at: now(),
      updated_at: now(),
      parent_id: newParentTask.id,
      checklist_id: newParentTask.checklist_id
    };
    childNt.tasks = duplicateChildrenDomain(app, state, childId, childNt);
    state.data.tasks[childNt.id] = childNt;
    childIds.push(childNt.id);
    logTaskHistory(childNt, 'creation', {
      source: 'duplicate',
      listId: childNt.checklist_id,
      parentId: childNt.parent_id || ''
    });
  }
  return childIds;
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
  nt.tasks = duplicateChildrenDomain(app, state, id, nt);
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
