'use strict';

function assignTaskDomain(app, state, internal, payload) {
  if (!internal) {
    if (!state.selId) return;
    const name = prompt('Assign to (username):');
    if (!name || !name.trim()) return;
    app.dispatch('task.assign', { taskId: state.selId, name: name.trim() });
    return;
  }

  const t = state.data.tasks[payload.taskId];
  if (!t) return;

  app.pushUndo(app.snap());
  const before = [...(t.assignees || [])];
  t.assignees = [...new Set([...(t.assignees || []), payload.name])];
  t.updated_at = now();
  if (JSON.stringify(before) !== JSON.stringify(t.assignees || [])) {
    logTaskHistory(t, 'assignment', { from: before, to: t.assignees || [] });
  }
  app.save();
  app.render();
  app.toast(`Assigned to @${payload.name}`);
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
