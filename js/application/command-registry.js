'use strict';

function registerAppCommands(app) {
  app.commandBus.register('task.add', ({afterId, asChild, content}) => app.addTask(afterId, asChild, content));
  app.commandBus.register('task.addAbove', ({refId}) => app.addAbove(refId));
  app.commandBus.register('task.delete', ({id}) => app.deleteTask(id));
  app.commandBus.register('task.toggleStatus', ({id}) => app.toggleStatus(id));
  app.commandBus.register('task.invalidate', ({id}) => app.invalidate(id));
  app.commandBus.register('task.edit', ({id, value}) => app.saveEdit(id, value));
  app.commandBus.register('task.setDueQuick', ({taskId, preset}) => app.setDueQ(preset, true, taskId));
  app.commandBus.register('task.clearDue', ({taskId, removeRepeat}) => app.clearDue(taskId, true, removeRepeat));
  app.commandBus.register('task.addTag', ({taskId, tag}) => app.addTagFromInput(true, {taskId, tag}));
  app.commandBus.register('task.removeTag', ({taskId, tag}) => app.rmTag(tag, true, taskId));
  app.commandBus.register('task.clearTags', ({taskId}) => app.clearTags(taskId, true));
  app.commandBus.register('task.moveToList', ({listId}) => app.moveToList(listId, true));
  app.commandBus.register('task.moveToTask', ({taskId}) => app.moveToTask(taskId, true));
  app.commandBus.register('task.import', payload => app.doImport(true, payload));
  app.commandBus.register('task.addNote', payload => app.addNote(true, payload));
  app.commandBus.register('task.deleteNote', payload => app.delNote(payload.taskId, payload.noteId, true));
  app.commandBus.register('task.clearNotes', ({taskId}) => app.clearNotes(taskId, true));
  app.commandBus.register('task.assign', payload => app.assignTask(true, payload));
  app.commandBus.register('task.sort', payload => app.applySort(true, payload));
  app.commandBus.register('task.restoreSelected', () => app.restoreSel(true));
  app.commandBus.register('task.wipeCompleted', () => app.wipeCompleted(true));
  app.commandBus.register('task.resetCompleted', () => app.resetCompleted(true));
  app.commandBus.register('task.extractBranch', () => app.extractBranch(true));
}
