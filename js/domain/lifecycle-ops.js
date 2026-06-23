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
      task.status = 0;
      task.completed_at = '';
    }
  });

  app.save();
  app.render();
  app.toast('All tasks re-opened');
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
    t.checklist_id = listId;
  });

  const siblings = sibListFn(state.selId);
  if (siblings) {
    const idx = siblings.indexOf(state.selId);
    if (idx > -1) siblings.splice(idx, 1);
  }

  task.deleted = true;
  task.tasks = [];

  app.save();
  app.render();
  app.toast(`Extracted as "${list.name}"`);
  app.openList(listId);
}
