'use strict';

/**
 * Navigation UI Controller
 * Handles task selection, expansion/collapse, and focus (hoist) operations
 */

function navDownUi(app, S) {
  const v = app.visible();
  if (!v.length) return;
  const i = v.indexOf(S.selId);
  S.selId = v[i < v.length - 1 ? i + 1 : 0];
  S.msel.clear();
  app.renderList();
}

function navUpUi(app, S) {
  const v = app.visible();
  if (!v.length) return;
  const i = v.indexOf(S.selId);
  S.selId = v[i > 0 ? i - 1 : v.length - 1];
  S.msel.clear();
  app.renderList();
}

function extUpUi(app, S) {
  const v = app.visible();
  const i = v.indexOf(S.selId);
  if (i <= 0) return;
  S.msel.add(S.selId);
  S.selId = v[i - 1];
  S.msel.add(S.selId);
  app.renderList();
}

function extDownUi(app, S) {
  const v = app.visible();
  const i = v.indexOf(S.selId);
  if (i >= v.length - 1) return;
  S.msel.add(S.selId);
  S.selId = v[i + 1];
  S.msel.add(S.selId);
  app.renderList();
}

function expandAllUi(app, S) {
  const l = S.data.lists[S.listId];
  if (!l) return;
  const walk = (ids) => {
    for (const id of ids) {
      const t = S.data.tasks[id];
      if (t) {
        t._collapsed = false;
        walk(t.tasks || []);
      }
    }
  };
  walk(l.root_tasks || []);
  app.renderList();
  app.toast('All expanded');
}

function collapseAllUi(app, S) {
  const l = S.data.lists[S.listId];
  if (!l) return;
  const walk = (ids) => {
    for (const id of ids) {
      const t = S.data.tasks[id];
      if (t) {
        t._collapsed = true;
        walk(t.tasks || []);
      }
    }
  };
  walk(l.root_tasks || []);
  app.renderList();
  app.toast('All collapsed');
}

function toggleExpandCollapseUi(app, S) {
  const l = S.data.lists[S.listId];
  if (!l) return;
  const allCollapsed = (l.root_tasks || []).every(
    (id) => S.data.tasks[id]?._collapsed
  );
  if (allCollapsed) {
    expandAllUi(app, S);
  } else {
    collapseAllUi(app, S);
  }
}

function hoistTaskUi(app, S, id) {
  S.hoistId = id;
  S.selId = null;
  app.renderList();
  app.toast('Focused');
}

function unHoistUi(app, S) {
  S.hoistId = null;
  app.renderList();
}
