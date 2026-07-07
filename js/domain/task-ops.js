'use strict';

function assignTaskInternal(app, state, payload) {
  const t = state.data.tasks[payload.taskId];
  if (!t) return false;

  if (!payload.skipUndo) app.pushUndo(app.snap());
  const before = [...(t.assignees || [])];
  t.assignees = [...new Set([...(t.assignees || []), payload.name])];
  t.updated_at = now();
  if (JSON.stringify(before) !== JSON.stringify(t.assignees || [])) {
    logTaskHistory(t, 'assignment', { from: before, to: t.assignees || [] });
  }

  if (!payload.noSave) app.save();
  if (!payload.noRender) app.render();
  if (!payload.silentToast) app.toast(`Assigned to @${payload.name}`);
  return true;
}

function assignTaskDomain(app, state, internal, payload) {
  if (!internal) {
    const ids = (typeof app.selectedIds === 'function')
      ? app.selectedIds()
      : (state.msel && state.msel.size ? [...state.msel] : (state.selId ? [state.selId] : []));
    if (!ids.length) return;
    const name = prompt('Assign to (username):');
    if (!name || !name.trim()) return;
    const trimmedName = name.trim();

    if (ids.length === 1) {
      app.dispatch('task.assign', { taskId: ids[0], name: trimmedName });
      return;
    }

    if (typeof app.withUndoBatch === 'function') {
      app.withUndoBatch(() => {
        ids.forEach(taskId => assignTaskInternal(app, state, {
          taskId,
          name: trimmedName,
          skipUndo: true,
          noSave: true,
          noRender: true,
          silentToast: true
        }));
      });
      if (state.msel && typeof state.msel.clear === 'function') state.msel.clear();
      app.save();
      app.render();
      app.toast(`Assigned @${trimmedName} to ${ids.length} task(s)`);
      return;
    }

    ids.forEach(taskId => app.dispatch('task.assign', { taskId, name: trimmedName }));
    return;
  }

  assignTaskInternal(app, state, {
    taskId: payload.taskId,
    name: payload.name,
    skipUndo: !!payload.skipUndo,
    noSave: !!payload.noSave,
    noRender: !!payload.noRender,
    silentToast: !!payload.silentToast
  });
}

function applySortDomain(app, state, internal, payload) {
  if (!internal) {
    const f = state.sortField;
    const rev = document.getElementById('sort-rev').checked;
    const sh = document.getElementById('sort-shallow').checked;
    app.dispatch('task.sort', { field: f, reverse: rev, shallow: sh });
    return;
  }

  app.pushUndo(app.snap());
  const f = payload.field;
  const rev = payload.reverse;
  const sh = payload.shallow;
  const list = state.data.lists[state.listId];
  if (!list) return;

  const cmp = (a, b) => {
    const ta = state.data.tasks[a];
    const tb = state.data.tasks[b];
    if (!ta || !tb) return 0;

    let r = 0;
    if (f === 'alpha') r = ta.content.localeCompare(tb.content);
    else if (f === 'due') r = cmpDate(ta.due || (ta.due_asap ? '0000-00-00' : ''), tb.due || (tb.due_asap ? '0000-00-00' : ''));
    else if (f === 'created') r = (tb.created_at || '') < (ta.created_at || '') ? -1 : 1;
    else if (f === 'updated') r = (tb.updated_at || '') < (ta.updated_at || '') ? -1 : 1;
    else if (f === 'priority') r = (tb.color || 0) - (ta.color || 0);

    return rev ? -r : r;
  };

  const sort = ids => {
    ids.sort(cmp);
    if (!sh) {
      for (const id of ids) {
        const t = state.data.tasks[id];
        if (t && t.tasks && t.tasks.length) sort(t.tasks);
      }
    }
  };

  const roots = state.hoistId ? (state.data.tasks[state.hoistId]?.tasks || []) : (list.root_tasks || []);
  sort(roots);
  app.save();
  app.closeModal('ov-sort');
  app.renderList();
  app.toast('Sorted');
}
