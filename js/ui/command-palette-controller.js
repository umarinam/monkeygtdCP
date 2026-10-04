'use strict';

function openCommandPalette(app, state, mode) {
  const input = document.getElementById('cpi');
  input.value = '';
  if (input.dataset.defaultPlaceholder === undefined) input.dataset.defaultPlaceholder = input.placeholder;
  input.placeholder = mode === 'templates' ? 'Pick a template to apply...' : input.dataset.defaultPlaceholder;
  app.openModal('ov-cp');
  state.cpMode = mode || '';
  state.cpIdx = 0;
  app.updateCP();
  setTimeout(() => document.getElementById('cpi').focus(), 50);
}

function closeCommandPalette(app, state) {
  state.cpMode = '';
  app.closeModal('ov-cp');
}

function commandPaletteItemsForMode(app, state) {
  if (state.cpMode === 'templates') return buildTemplatePaletteItems(app);
  const allCmds = buildCommandPaletteItems(app, state);
  return state.cpMode === 'lists'
    ? allCmds.filter(c => c.l && c.l.startsWith('Go to:'))
    : allCmds;
}

function updateCommandPalette(app, state) {
  const q = document.getElementById('cpi').value.toLowerCase();
  const cmds = commandPaletteItemsForMode(app, state);

  const filtered = q ? cmds.filter(c => c.l.toLowerCase().includes(q) || (c.s || '').toLowerCase().includes(q)) : cmds;
  state.cpItems = filtered;
  const emptyText = state.cpMode === 'templates' ? 'No templates found' : 'No commands found';
  document.getElementById('cpr').innerHTML = filtered.slice(0, 20)
    .map((c, i) => `<div class="cpi${i === state.cpIdx ? ' on' : ''}" onclick="App.execCP(${i})"><span style="flex:1">${esc(c.l)}</span>${c.s ? `<span class="cpsc">${esc(c.s)}</span>` : ''}</div>`)
    .join('') || `<div style="padding:12px;color:var(--muted)">${emptyText}</div>`;
}

function renderCommandPaletteItems(state) {
  document.querySelectorAll('.cpi').forEach((el, i) => el.classList.toggle('on', i === state.cpIdx));
  document.querySelectorAll('.cpi')[state.cpIdx]?.scrollIntoView({ block: 'nearest' });
}

function executeCommandPaletteItem(app, state, index) {
  const item = state.cpItems[index];
  if (!item) return;
  app.closeCP();
  item.fn();
}
