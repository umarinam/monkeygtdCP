'use strict';

function runAppSmokeChecks(app, state) {
  const results = [];
  const backup = {
    data: JSON.parse(JSON.stringify(state.data)),
    listId: state.listId,
    selId: state.selId,
    page: state.page,
    hoistId: state.hoistId,
    filter: state.filter,
    msel: new Set(state.msel),
    undos: state.undos.slice(),
    redos: state.redos.slice(),
    undoBatchDepth: Number(state.undoBatchDepth || 0)
  };

  const record = (name, pass, detail) => {
    results.push({ name, pass: !!pass, detail: detail || '' });
  };

  try {
    try {
      const items = buildCommandPaletteItems(app, state);
      const hasExport = items.some(i => i.l === 'Export');
      record('command-palette-build', items.length > 0 && hasExport, `items=${items.length}`);
    } catch (err) {
      record('command-palette-build', false, err.message);
    }

    try {
      const id = app.addTask(state.selId || '', false, 'smoke task');
      const added = !!state.data.tasks[id];
      app.saveEdit(id, 'smoke task updated');
      const edited = state.data.tasks[id]?.content === 'smoke task updated';
      app.deleteTask(id);
      const deleted = state.data.tasks[id]?.deleted === true;
      record('task-add-edit-delete', added && edited && deleted, `id=${id}`);
    } catch (err) {
      record('task-add-edit-delete', false, err.message);
    }

    try {
      const list = state.data.lists[state.listId];
      const before = (list?.root_tasks || []).length;
      app.doImport(true, {
        fmt: 'json',
        pos: 'bottom',
        raw: JSON.stringify({ tasks: [{ content: 'smoke imported task' }] })
      });
      const after = (state.data.lists[state.listId]?.root_tasks || []).length;
      record('import-json', after === before + 1, `before=${before}, after=${after}`);
    } catch (err) {
      record('import-json', false, err.message);
    }

    try {
      const listName = `Smoke List ${Date.now()}`;
      confirmListDomain(app, state, listName, [], mkList, now);
      const created = Object.values(state.data.lists).find(l => l.name === listName);
      if (!created) throw new Error('create failed');
      archiveListDomain(app, state, created.id);
      if (!state.data.lists[created.id]?.archived) throw new Error('archive failed');
      deleteListDomain(app, state, created.id);
      const removed = !state.data.lists[created.id];
      record('list-create-archive-delete', removed, `name=${listName}`);
    } catch (err) {
      record('list-create-archive-delete', false, err.message);
    }
  } finally {
    state.data = backup.data;
    state.listId = backup.listId;
    state.selId = backup.selId;
    state.page = backup.page;
    state.hoistId = backup.hoistId;
    state.filter = backup.filter;
    state.msel = backup.msel;
    state.undos = backup.undos;
    state.redos = backup.redos;
    state.undoBatchDepth = backup.undoBatchDepth;
    app.save();
    app.render();
  }

  return results;
}
