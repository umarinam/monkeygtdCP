'use strict';

function taskTextDomain(state, t, d) {
  let s = '  '.repeat(d) + t.content;
  for (const c of (t.tasks || [])) {
    const ct = state.data.tasks[c];
    if (ct) s += '\n' + taskTextDomain(state, ct, d + 1);
  }
  return s;
}

function copyDomain(app, state) {
  const ids = state.msel.size ? [...state.msel] : (state.selId ? [state.selId] : []);
  if (!ids.length) return;

  state.clipboard = ids.map(id => JSON.parse(JSON.stringify(state.data.tasks[id])));
  navigator.clipboard?.writeText(
    ids.map(id => {
      const t = state.data.tasks[id];
      return t ? taskTextDomain(state, t, 0) : '';
    }).join('\n')
  ).catch(() => {});

  app.toast(`Copied ${ids.length} task(s)`);
}

function cutDomain(app, state) {
  copyDomain(app, state);
  const ids = state.msel.size ? [...state.msel] : (state.selId ? [state.selId] : []);
  for (const id of ids) app.deleteTask(id);
  app.render();
}

function pasteDomain(app, state) {
  if (!state.clipboard || !state.clipboard.length) return;

  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];

  for (const src of state.clipboard) {
    const nt = { ...src, id: uid(), created_at: now(), updated_at: now() };
    if (state.selId) {
      const ref = state.data.tasks[state.selId];
      const sibs = app.sibList(state.selId);
      if (sibs) {
        sibs.splice(sibs.indexOf(state.selId) + 1, 0, nt.id);
        nt.parent_id = ref.parent_id;
        nt.checklist_id = state.listId;
      }
    } else {
      list.root_tasks.push(nt.id);
      nt.parent_id = '';
      nt.checklist_id = state.listId;
    }
    state.data.tasks[nt.id] = nt;
    logTaskHistory(nt, 'creation', {
      source: 'paste',
      listId: nt.checklist_id,
      parentId: nt.parent_id || ''
    });
  }

  app.save();
  app.render();
}

function dupDomain(app, state, id) {
  if (!id) return;
  const src = state.data.tasks[id];
  if (!src) return;

  app.pushUndo(app.snap());
  const nt = {
    ...JSON.parse(JSON.stringify(src)),
    id: uid(),
    created_at: now(),
    updated_at: now()
  };
  const sibs = app.sibList(id);
  if (sibs) sibs.splice(sibs.indexOf(id) + 1, 0, nt.id);
  state.data.tasks[nt.id] = nt;
  logTaskHistory(nt, 'creation', {
    source: 'duplicate',
    listId: nt.checklist_id,
    parentId: nt.parent_id || ''
  });
  state.selId = nt.id;
  app.save();
  app.render();
  app.toast('Duplicated');
}

function copyWithUrlDomain(app, state) {
  if (!state.selId) return;
  const t = state.data.tasks[state.selId];
  if (!t) return;
  navigator.clipboard?.writeText(`[${t.content}](#task-${t.id})`).catch(() => {});
  app.toast('Copied with URL');
}

function copyPermalinkDomain(app, state) {
  if (!state.selId) return;
  const t = state.data.tasks[state.selId];
  if (!t) return;
  navigator.clipboard?.writeText(`#task-${t.id}`).catch(() => {});
  app.toast('Permalink copied');
}
