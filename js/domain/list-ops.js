'use strict';

function confirmListDomain(app, state, name, tags, mkListFn, nowFn) {
  if (state.listMode === 'create') {
    const list = mkListFn({ name, tags });
    state.data.lists[list.id] = list;
    app.save();
    app.closeModal('ov-list');
    app.openList(list.id);
    return;
  }

  const list = state.data.lists[state.listEditId];
  if (!list) return;
  list.name = name;
  list.tags = tags;
  list.updated_at = nowFn();
  app.save();
  app.closeModal('ov-list');
  app.renderHome();
}

function archiveListDomain(app, state, id) {
  const list = state.data.lists[id];
  if (!list) return;
  list.archived = true;
  app.save();
  app.renderHome();
  app.toast('Archived');
}

function unarchiveListDomain(app, state, id) {
  const list = state.data.lists[id];
  if (!list) return;
  list.archived = false;
  app.save();
  app.renderHome();
  app.toast('Unarchived');
}

function deleteListDomain(app, state, id) {
  const list = state.data.lists[id];
  if (!list) return;

  delete state.data.lists[id];
  if (state.listId === id) {
    const remaining = Object.keys(state.data.lists);
    state.listId = remaining[0] || null;
  }

  app.save();
  app.renderHome();
  app.toast('Deleted');
}
