'use strict';

function setSettingDomain(app, state, key, value) {
  state.data.settings[key] = value;
  app.save();
  if (state.page === 'list') app.renderList();
}

function setDarkModeDomain(app, state, value) {
  state.data.settings.darkMode = value;
  app.save();
}

function setZenModeDomain(app, state, value) {
  state.data.settings.zenMode = value;
  app.save();
}

function setListStyleDomain(app, state, value) {
  state.data.settings.listStyle = value;
  const list = state.data.lists[state.listId];
  if (list) list.style = value;
  app.save();
  if (state.page === 'list') app.renderList();
}
