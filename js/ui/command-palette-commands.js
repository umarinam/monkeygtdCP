'use strict';

function buildCommandPaletteItems(app, state) {
  return [
    { l: 'Edit task', s: 'ee / F2', fn: () => { if (state.selId) app.startEdit(state.selId); } },
    { l: 'Add task below', s: 'Enter', fn: () => { if (state.selId) { const nid = app.dispatch('task.add', { afterId: state.selId, asChild: false, content: '' }); state.selId = nid; app.renderList(); app.startEdit(nid); } } },
    { l: 'Add child task', s: 'Shift+Enter', fn: () => { if (state.selId) { const nid = app.dispatch('task.add', { afterId: state.selId, asChild: true, content: '' }); state.selId = nid; app.renderList(); app.startEdit(nid); } } },
    { l: 'Delete task', s: 'Del', fn: () => { if (state.selId) app.dispatch('task.delete', { id: state.selId }); } },
    { l: 'Mark completed', s: 'Space', fn: () => { if (state.selId) app.dispatch('task.toggleStatus', { id: state.selId }); } },
    { l: 'Mark invalidated', s: 'Shift+Space', fn: () => { if (state.selId) app.dispatch('task.invalidate', { id: state.selId }); } },
    { l: 'Due today', s: 'td', fn: () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'today' }); } },
    { l: 'Due tomorrow', s: 'tm', fn: () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'tomorrow' }); } },
    { l: 'Due ASAP', s: 'as', fn: () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'asap' }); } },
    { l: 'Set due date...', s: 'dd', fn: () => app.openDueModal() },
    { l: 'Repeating due settings', s: 'dr', fn: () => { if (state.selId) app.openRepeatModal(); } },
    { l: 'Clear due date', s: 'cd', fn: () => { if (state.selId) app.dispatch('task.clearDue', { taskId: state.selId, removeRepeat: false }); } },
    { l: 'Add tags', s: 'tt', fn: () => { if (state.selId) app.openTagsModal(state.selId); } },
    { l: 'Clear tags', s: 'ct', fn: () => { if (state.selId) app.dispatch('task.clearTags', { taskId: state.selId }); } },
    { l: 'Add note', s: 'nn', fn: () => { if (state.selId) app.openNotesModal(state.selId); } },
    { l: 'Edit task JSON', s: 'tj', fn: () => { if (state.selId) app.openTaskJson(state.selId); } },
    { l: 'View task history', s: 'th', fn: () => { if (state.selId) app.openTaskHistory(state.selId); } },
    { l: 'Clear notes', s: 'cn', fn: () => { if (state.selId) app.dispatch('task.clearNotes', { taskId: state.selId }); } },
    { l: 'Show/hide all notes', s: 'sn', fn: () => { state.showNotes = !state.showNotes; app.render(); } },
    { l: 'Assign task', s: 'ae', fn: () => app.assignTask() },
    { l: 'Clear assignees', s: 'ca', fn: () => {
      if (!state.selId) return;
      app.pushUndo(app.snap());
      const t = state.data.tasks[state.selId];
      if (!t) return;
      const before = [...(t.assignees || [])];
      t.assignees = [];
      if (before.length) {
        logTaskHistory(t, 'assignment', { from: before, to: [] });
      }
      app.save();
      app.render();
    } },
    { l: 'Indent', s: 'Tab', fn: () => { if (state.selId) app.indent(state.selId); } },
    { l: 'Un-indent', s: 'Shift+Tab', fn: () => { if (state.selId) app.unindent(state.selId); } },
    { l: 'Move task up', s: 'Ctrl+Up', fn: () => { if (state.selId) app.moveUp(state.selId); } },
    { l: 'Move task down', s: 'Ctrl+Down', fn: () => { if (state.selId) app.moveDown(state.selId); } },
    { l: 'Hoist / Focus', s: 'Shift+Right', fn: () => { if (state.selId) app.hoistTask(state.selId); } },
    { l: 'Un-focus', s: 'Shift+Left', fn: () => app.unHoist() },
    { l: 'Expand all', s: 'Ctrl+Shift+Right', fn: () => app.expandAll() },
    { l: 'Collapse all', s: 'Ctrl+Shift+Left', fn: () => app.collapseAll() },
    { l: 'Move to list', s: 'mm', fn: () => app.openMoveDlg() },
    { l: 'Sort', s: 'ss', fn: () => app.openSortDlg() },
    { l: 'Wipe completed', s: 'wipe', fn: () => app.wipeCompleted() },
    { l: 'Reset completed', s: 'reset', fn: () => app.resetCompleted() },
    { l: 'Word count', s: 'wc', fn: () => app.showWC() },
    { l: 'Run smoke checks', s: 'sm', fn: () => app.runSmokeChecks() },
    { l: 'Export', s: 'ex', fn: () => app.openExport() },
    { l: 'Import', s: 'im', fn: () => app.openImport() },
    { l: 'Restore deleted', s: 'rd', fn: () => app.showRestoreDeleted() },
    { l: 'Extract branch as new list', s: 'xx', fn: () => app.extractBranch() },
    { l: 'Undo', s: 'Ctrl+Z / uu', fn: () => app.undo() },
    { l: 'Sync now', s: 'sg', fn: () => app.syncGistNow() },
    { l: 'Pull from Gist', s: 'sp', fn: () => app.syncFromGist() },
    { l: 'Push to Gist', s: 'sh', fn: () => app.syncToGist() },
    { l: 'Hide/show completed', s: 'hc', fn: () => { state.data.settings.showCompleted = !state.data.settings.showCompleted; app.save(); app.render(); } },
    { l: 'Hide/show future due', s: 'hf', fn: () => { state.data.settings.hideFuture = !state.data.settings.hideFuture; app.save(); app.render(); app.syncSettings(); } },
    { l: 'Toggle details', s: 'sd', fn: () => app.toggleDetails() },
    { l: 'Show branch progress', s: 'pc', fn: () => { if (state.selId) app.showProgress(state.selId); } },
    { l: 'Expand/collapse all', s: 'ec', fn: () => app.toggleEC() },
    { l: 'Toggle multi-select for task', s: 'st', fn: () => {
      if (!state.selId) return;
      state.msel.has(state.selId) ? state.msel.delete(state.selId) : state.msel.add(state.selId);
      app.renderList();
    } },
    { l: 'Open first URL in task', s: 'gg', fn: () => {
      if (!state.selId) return;
      const t = state.data.tasks[state.selId];
      const m = (t && t.content ? t.content.match(/https?:\/\/\S+/) : null);
      if (m) window.open(m[0], '_blank');
    } },
    { l: 'Open lists picker', s: 'll', fn: () => app.openCP('lists') },
    { l: 'Copy task permalink', s: 'tc / lc', fn: () => app.copyPermalink() },
    { l: 'Toggle relative dates', s: 'df', fn: () => { state.data.settings.relativeDates = !state.data.settings.relativeDates; app.save(); app.render(); } },
    { l: 'Zen mode', s: 'om', fn: () => app.setZen(!state.data.settings.zenMode) },
    { l: 'Settings', s: 'oo', fn: () => app.openSettings() },
    { l: 'Keyboard shortcuts', s: '?', fn: () => app.showShortcuts() },
    { l: 'Lists home', s: 'gh', fn: () => app.showPage('home') },
    { l: 'Due page', s: 'gd', fn: () => app.showPage('due') },
    { l: 'Reporting page', s: 'gr', fn: () => app.showPage('report') },
    { l: 'Kanban page', s: 'gk', fn: () => app.showPage('kanban') },
    { l: 'Tags page', s: 'gt', fn: () => app.showPage('tags') },
    { l: 'New list', fn: () => { app.showPage('home'); app.createList(); } },
    ...app.select('cp.listTargets').map(l => ({ l: `Go to: ${l.name}`, fn: () => app.openList(l.id) }))
  ];
}
