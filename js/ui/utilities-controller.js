'use strict';

/**
 * Utilities UI Controller
 * Handles various utility operations (toggle details, progress, jump to, wipe/reset, extract)
 */

function showProgressUi(app, S, id) {
  const stats = app.select('stats.progress', { id });
  if (!stats) return;
  app.toast(`${stats.done}/${stats.total} done`);
}

function toggleDetailsUi(app) {
  const ds = document.querySelectorAll('[id^="dtl-"]');
  const visible = ds.length && ds[0].style.display !== 'none';
  ds.forEach((el) => (el.style.display = visible ? 'none' : 'block'));
  app.toast(`Details ${visible ? 'hidden' : 'visible'}`);
}

function wipeCompletedUi(app, S) {
  if (!confirm('Delete all completed tasks in this list?')) return;
  app.dispatch('task.wipeCompleted');
}

function wipeCompletedDomainUi(app, S) {
  wipeCompletedDomain(app, S, walkTasks, SKIP_CHILDREN);
}

function resetCompletedUi(app, S) {
  app.dispatch('task.resetCompleted');
}

function resetCompletedDomainUi(app, S) {
  resetCompletedDomain(app, S, walkTasks);
}

function extractBranchUi(app, S) {
  if (!S.selId) return;
  const t0 = S.data.tasks[S.selId];
  if (!t0) return;
  if (!confirm(`Extract "${t0.content.slice(0, 40)}" as a new list?`)) return;
  app.dispatch('task.extractBranch');
}

function extractBranchDomainUi(app, S) {
  extractBranchDomain(app, S, walkTasks, uid, mkList, app.sibList.bind(app));
}

function jumpToUi(app, S, id) {
  const t = S.data.tasks[id];
  if (!t) return;
  S.listId = t.checklist_id;
  S.selId = id;
  app.showPage('list');
  setTimeout(() => app.scrollSel(), 80);
}
