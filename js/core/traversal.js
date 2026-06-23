'use strict';

const SKIP_CHILDREN = Symbol('skip-children');

function walkTasks(startIds, tasksById, visit, depth = 0) {
  for (const id of startIds || []) {
    const task = tasksById[id];
    if (!task || task.deleted) continue;

    const result = visit(task, depth);
    if (result === SKIP_CHILDREN) continue;

    if (task.tasks && task.tasks.length) {
      walkTasks(task.tasks, tasksById, visit, depth + 1);
    }
  }
}
