'use strict';

function sibListDomain(state, id) {
  const t = state.data.tasks[id];
  if (!t) return null;
  return t.parent_id
    ? (state.data.tasks[t.parent_id]?.tasks || null)
    : (state.data.lists[t.checklist_id]?.root_tasks || null);
}

function moveUpDomain(app, state, id) {
  app.pushUndo(app.snap());
  const s = sibListDomain(state, id);
  if (!s) return;
  const i = s.indexOf(id);
  if (i > 0) {
    const t = state.data.tasks[id];
    const fromIndex = i;
    [s[i - 1], s[i]] = [s[i], s[i - 1]];
    if (t) logTaskHistory(t, 'structure', { action: 'move-up', fromIndex, toIndex: i - 1 });
    app.save();
    app.renderList();
  }
}

function moveDownDomain(app, state, id) {
  app.pushUndo(app.snap());
  const s = sibListDomain(state, id);
  if (!s) return;
  const i = s.indexOf(id);
  if (i < s.length - 1) {
    const t = state.data.tasks[id];
    const fromIndex = i;
    [s[i], s[i + 1]] = [s[i + 1], s[i]];
    if (t) logTaskHistory(t, 'structure', { action: 'move-down', fromIndex, toIndex: i + 1 });
    app.save();
    app.renderList();
  }
}

function moveBeforeDomain(app, state, srcId, tgtId) {
  const src = state.data.tasks[srcId];
  const tgt = state.data.tasks[tgtId];
  if (!src || !tgt) return;

  const before = {
    parent_id: src.parent_id || '',
    checklist_id: src.checklist_id || ''
  };

  const ss = sibListDomain(state, srcId);
  if (ss) {
    const i = ss.indexOf(srcId);
    if (i > -1) ss.splice(i, 1);
  }

  const ts = sibListDomain(state, tgtId);
  if (ts) {
    const i = ts.indexOf(tgtId);
    ts.splice(i, 0, srcId);
    src.parent_id = tgt.parent_id;
    src.checklist_id = tgt.checklist_id;
    logTaskHistory(src, 'structure', {
      action: 'move-before',
      targetTaskId: tgtId,
      from: before,
      to: { parent_id: src.parent_id || '', checklist_id: src.checklist_id || '' }
    });
  }

  app.save();
  app.renderList();
}

function indentDomain(app, state, id) {
  app.pushUndo(app.snap());
  const t = state.data.tasks[id];
  if (!t) return;

  const sibs = sibListDomain(state, id);
  if (!sibs) return;
  const i = sibs.indexOf(id);
  if (i <= 0) return;

  const npId = sibs[i - 1];
  const np = state.data.tasks[npId];
  if (!np) return;

  sibs.splice(i, 1);
  np.tasks = [...(np.tasks || []), id];
  const beforeParent = t.parent_id || '';
  t.parent_id = npId;
  np._collapsed = false;

  logTaskHistory(t, 'structure', {
    action: 'indent',
    from: { parent_id: beforeParent },
    to: { parent_id: t.parent_id || '' }
  });

  app.save();
  app.renderList();
}

function unindentDomain(app, state, id) {
  app.pushUndo(app.snap());
  const t = state.data.tasks[id];
  if (!t || !t.parent_id) return;

  const p = state.data.tasks[t.parent_id];
  if (!p) return;

  p.tasks = (p.tasks || []).filter(x => x !== id);
  const gps = sibListDomain(state, p.id);
  if (gps) {
    const beforeParent = t.parent_id || '';
    gps.splice(gps.indexOf(p.id) + 1, 0, id);
    t.parent_id = p.parent_id || '';
    logTaskHistory(t, 'structure', {
      action: 'unindent',
      from: { parent_id: beforeParent },
      to: { parent_id: t.parent_id || '' }
    });
  }

  app.save();
  app.renderList();
}

function moveToListDomain(app, state, listId) {
  app.pushUndo(app.snap());

  const ids = state.msel.size ? [...state.msel] : [state.selId];
  const targetList = state.data.lists[listId];
  if (!targetList) return;

  for (const id of ids) {
    const t = state.data.tasks[id];
    if (!t) continue;

    const before = { parent_id: t.parent_id || '', checklist_id: t.checklist_id || '' };

    const s = sibListDomain(state, id);
    if (s) {
      const i = s.indexOf(id);
      if (i > -1) s.splice(i, 1);
    }

    t.parent_id = '';
    t.checklist_id = listId;
    targetList.root_tasks.push(id);
    logTaskHistory(t, 'structure', {
      action: 'move-to-list',
      from: before,
      to: { parent_id: '', checklist_id: t.checklist_id || '' }
    });
  }

  app.save();
  app.closeModal('ov-move');
  app.render();
  app.toast(`Moved to "${targetList.name}"`);
}

function moveToTaskDomain(app, state, targetTaskId) {
  app.pushUndo(app.snap());

  const ids = state.msel.size ? [...state.msel] : [state.selId];
  const targetTask = state.data.tasks[targetTaskId];
  if (!targetTask) return;

  for (const id of ids) {
    if (id === targetTaskId) continue;

    const s = sibListDomain(state, id);
    if (s) {
      const i = s.indexOf(id);
      if (i > -1) s.splice(i, 1);
    }

    const task = state.data.tasks[id];
    if (!task) continue;
    const before = { parent_id: task.parent_id || '', checklist_id: task.checklist_id || '' };
    task.parent_id = targetTaskId;
    task.checklist_id = targetTask.checklist_id;
    targetTask.tasks = [...(targetTask.tasks || []), id];
    targetTask._collapsed = false;
    logTaskHistory(task, 'structure', {
      action: 'move-to-task',
      targetTaskId,
      from: before,
      to: { parent_id: task.parent_id || '', checklist_id: task.checklist_id || '' }
    });
  }

  app.save();
  app.closeModal('ov-move');
  app.render();
  app.toast('Moved');
}
