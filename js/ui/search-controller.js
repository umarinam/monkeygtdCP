'use strict';

function applySearchInputUi(app, state, value) {
  state.filter = String(value || '').trim();
  const srch = document.getElementById('search');
  if (srch) srch.classList.toggle('has-v', !!state.filter);
  if (state.page === 'list') app.renderList();
  else if (state.page === 'due') app.renderDue();
  app.syncSB();
}

function clearSearchUi(app, state) {
  state.filter = '';
  const srch = document.getElementById('search');
  if (srch) {
    srch.value = '';
    srch.classList.remove('has-v');
  }
  if (state.page === 'list') app.renderList();
  else if (state.page === 'due') app.renderDue();
  app.syncSB();
}
