'use strict';

function addTaskDomain(app, state, afterId, asChild, content) {
  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];
  const task = mkTask({ content: content || '', checklist_id: state.listId });

  if (asChild && afterId) {
    const parent = state.data.tasks[afterId];
    task.parent_id = afterId;
    parent.tasks = [...(parent.tasks || []), task.id];
  } else if (afterId) {
    const ref = state.data.tasks[afterId];
    task.parent_id = ref.parent_id;
    const sibs = ref.parent_id
      ? (state.data.tasks[ref.parent_id]?.tasks || [])
      : (list.root_tasks || []);
    sibs.splice(sibs.indexOf(afterId) + 1, 0, task.id);
  } else {
    list.root_tasks = [...(list.root_tasks || []), task.id];
  }

  if (content) {
    const parsed = parseSmart(content);
    task.content = parsed.content;
    if (parsed.tags.length) {
      for (const tg of parsed.tags) task.tags[tg] = { isPrivate: false };
      task.tags_as_text = parsed.tags.join(',');
    }
    if (parsed.due) task.due = parsed.due;
    if (parsed.due_asap) task.due_asap = true;
    if (parsed.color) task.color = parsed.color;
    if (parsed.assignees.length) task.assignees = parsed.assignees;
  }

  state.data.tasks[task.id] = task;
  logTaskHistory(task, 'creation', {
    source: 'manual',
    listId: task.checklist_id,
    parentId: task.parent_id || ''
  });
  app.save();
  return task.id;
}

function addAboveDomain(app, state, refId) {
  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];
  const ref = state.data.tasks[refId];
  const task = mkTask({ content: '', checklist_id: state.listId, parent_id: ref.parent_id });
  const sibs = ref.parent_id
    ? (state.data.tasks[ref.parent_id]?.tasks || [])
    : (list.root_tasks || []);

  sibs.splice(sibs.indexOf(refId), 0, task.id);
  state.data.tasks[task.id] = task;
  app.save();
  return task.id;
}

function deleteTaskDomain(app, state, id) {
  app.pushUndo(app.snap());
  const t = state.data.tasks[id];
  if (!t) return;

  const softDelete = tid => {
    const task = state.data.tasks[tid];
    if (!task) return;
    const wasDeleted = !!task.deleted;
    task.deleted = true;
    task._deleted_at = now();
    if (!wasDeleted) {
      logTaskHistory(task, 'deletion', { action: 'soft-delete' });
    }
    (task.tasks || []).forEach(softDelete);
  };

  const sibs = app.sibList(id);
  if (sibs) {
    const i = sibs.indexOf(id);
    if (i > -1) sibs.splice(i, 1);
  }

  softDelete(id);
  state.data.deletedItems = state.data.deletedItems || [];
  state.data.deletedItems.push({ taskId: id, snapshot: JSON.parse(JSON.stringify(t)), deletedAt: now() });
  if (state.data.deletedItems.length > 100) state.data.deletedItems.shift();

  const vis = app.visible();
  const idx = vis.indexOf(id);
  state.selId = vis[idx + 1] || vis[idx - 1] || null;

  app.save();
  app.render();
}

function saveEditDomain(app, state, id, value) {
  const t = state.data.tasks[id];
  if (!t) return;

  app.pushUndo(app.snap());
  const before = {
    content: t.content,
    tags_as_text: t.tags_as_text || '',
    assignees: JSON.stringify(t.assignees || []),
    due: t.due || '',
    due_asap: !!t.due_asap,
    color: Number(t.color || 0)
  };

  const parsed = parseSmart(value);
  t.content = parsed.content || t.content;
  if (parsed.due) {
    t.due = parsed.due;
    t.due_asap = false;
  }
  if (parsed.due_asap) {
    t.due_asap = true;
    t.due = '';
  }
  if (parsed.color) t.color = parsed.color;
  for (const tg of parsed.tags) t.tags[tg] = { isPrivate: false };
  t.tags_as_text = Object.keys(t.tags).join(',');
  t.assignees = [...new Set([...(t.assignees || []), ...parsed.assignees])];
  t.updated_at = now();

  if (before.content !== t.content) {
    logTaskHistory(t, 'title', { from: before.content, to: t.content });
  }
  if (before.tags_as_text !== (t.tags_as_text || '')) {
    logTaskHistory(t, 'tags', { from: before.tags_as_text, to: t.tags_as_text || '' });
  }
  if (before.assignees !== JSON.stringify(t.assignees || [])) {
    logTaskHistory(t, 'assignment', { from: JSON.parse(before.assignees), to: t.assignees || [] });
  }
  if (before.due !== (t.due || '') || before.due_asap !== !!t.due_asap) {
    logTaskHistory(t, 'scheduling', {
      from: { due: before.due, due_asap: before.due_asap },
      to: { due: t.due || '', due_asap: !!t.due_asap }
    });
  }
  if (before.color !== Number(t.color || 0)) {
    logTaskHistory(t, 'priority', { from: before.color, to: Number(t.color || 0) });
  }

  if (state.data.settings.autoCloseParent && t.parent_id) app.checkAutoClose(t.parent_id);
  app.save();
}

function advanceRecurringTaskDomain(state, task) {
  if (!task || !task.repeating_due) return;

  const before = { due: task.due || '', due_asap: !!task.due_asap };

  const r = task.repeating_due;
  const interval = Math.max(1, parseInt(r.interval || 1, 10) || 1);
  const base = (r.repeatFrom === 'completion')
    ? new Date(todayS() + 'T00:00:00')
    : new Date((task.due || r.startDate || todayS()) + 'T00:00:00');

  let next = new Date(base.getTime());
  if (r.freq === 'daily') {
    next.setDate(next.getDate() + interval);
  } else if (r.freq === 'weekly') {
    const weekdays = (Array.isArray(r.weekdays) && r.weekdays.length)
      ? r.weekdays.map(Number)
      : [base.getDay()];
    let probe = new Date(base.getTime());
    probe.setDate(probe.getDate() + 1);
    let hops = 0;
    while (hops < 400) {
      if (weekdays.includes(probe.getDay())) {
        next = probe;
        break;
      }
      probe.setDate(probe.getDate() + 1);
      hops++;
    }
    if (interval > 1) next.setDate(next.getDate() + 7 * (interval - 1));
  } else if (r.freq === 'monthly') {
    next.setMonth(next.getMonth() + interval);
  } else if (r.freq === 'yearly') {
    next.setFullYear(next.getFullYear() + interval);
  }

  task.due = dateStr(next);
  task.due_asap = false;
  task.update_line = 'repeated';
  if (before.due !== (task.due || '') || before.due_asap !== !!task.due_asap) {
    logTaskHistory(task, 'scheduling', {
      from: before,
      to: { due: task.due || '', due_asap: !!task.due_asap },
      source: 'recurring'
    });
  }
}

function closeDescendantsOnParentDoneDomain(state, taskId) {
  const stamp = now();
  const markDone = (id) => {
    const task = state.data.tasks[id];
    if (!task || task.deleted) return;
    const was = Number(task.status || 0);
    if (was !== 1) {
      task.status = 1;
      task.completed_at = stamp;
      task.updated_at = stamp;
      logTaskHistory(task, 'status', { from: was, to: 1, source: 'parent-close' });
    }
    for (const childId of (task.tasks || [])) markDone(childId);
  };

  const parent = state.data.tasks[taskId];
  if (!parent) return;
  for (const childId of (parent.tasks || [])) markDone(childId);
}

function toggleStatusDomain(app, state, id) {
  app.pushUndo(app.snap());
  const t = state.data.tasks[id];
  if (!t) return;

  const before = Number(t.status || 0);

  if (t.status === 0) {
    t.status = 1;
    t.completed_at = now();
    if (t.repeating_due && !t.repeating_due.paused) {
      advanceRecurringTaskDomain(state, t);
      t.status = 0;
    }
  } else {
    t.status = 0;
    t.completed_at = '';
  }

  t.updated_at = now();
  if (before !== Number(t.status || 0)) {
    logTaskHistory(t, 'status', { from: before, to: Number(t.status || 0) });
    if (state.data.settings.closeChildrenOnParentDone && Number(t.status || 0) === 1) {
      closeDescendantsOnParentDoneDomain(state, t.id);
    }
  }
  if (state.data.settings.autoCloseParent && t.parent_id) app.checkAutoClose(t.parent_id);
  app.save();
  app.render();
}

function invalidateDomain(app, state, id) {
  app.pushUndo(app.snap());
  const t = state.data.tasks[id];
  if (!t) return;

  const before = Number(t.status || 0);

  t.status = t.status === 2 ? 0 : 2;
  t.updated_at = now();
  if (t.status === 2) t.completed_at = now();

  if (before !== Number(t.status || 0)) {
    logTaskHistory(t, 'status', { from: before, to: Number(t.status || 0) });
  }

  app.save();
  app.render();
}

function checkAutoCloseDomain(app, state, parentId) {
  const p = state.data.tasks[parentId];
  if (!p) return;

  const allDone = (p.tasks || []).every(cid => {
    const c = state.data.tasks[cid];
    return c && (c.status === 1 || c.status === 2);
  });

  if (allDone && p.tasks.length > 0) {
    p.status = 1;
    p.completed_at = now();
  } else {
    p.status = 0;
    p.completed_at = '';
  }

  if (p.parent_id) checkAutoCloseDomain(app, state, p.parent_id);
}

function toggleCollapseDomain(app, state, id) {
  const t = state.data.tasks[id];
  if (!t) return;
  t._collapsed = !t._collapsed;
  app.save();
  app.renderList();
}
