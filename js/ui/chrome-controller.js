'use strict';

function formatDeployStamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return raw;
  return new Date(parsed).toISOString().replace('T', ' ').replace('.000Z', ' UTC');
}

function syncStatusBarUi(state) {
  const list = state.data.lists[state.listId];
  document.getElementById('sb-list').textContent = list ? list.name : '';
  document.getElementById('sb-mode').textContent = state.editId ? 'EDIT' : 'CMD';

  if (state.selId) {
    const t = state.data.tasks[state.selId];
    document.getElementById('sb-sel').textContent = t
      ? (t.content.slice(0, 35) + (t.content.length > 35 ? '...' : ''))
      : '';
  } else {
    document.getElementById('sb-sel').textContent = '';
  }

  if (list) document.getElementById('sb-cnt').textContent = `${(list.root_tasks || []).length} root task(s)`;
  const sf = document.getElementById('sb-filt');
  if (state.filter) {
    sf.style.display = '';
    sf.textContent = `x filter: ${state.filter.slice(0, 20)}`;
  } else {
    sf.style.display = 'none';
  }

  const ss = document.getElementById('sb-sync');
  if (ss) {
    const settings = state.data?.settings || {};
    const at = String(settings.gistLastSyncAt || '').trim();
    const status = String(settings.gistLastSyncSummary || '').trim();
    let gistText = '';
    if (at || status) {
      let when = at;
      const parsed = Date.parse(at);
      if (Number.isFinite(parsed)) {
        when = new Date(parsed).toLocaleString();
      }
      gistText = status ? `${status} ${when ? `@ ${when}` : ''}`.trim() : when;
    }

    const deployMeta = globalThis.__MGTD_STANDALONE_DEPLOY || {};
    const deployAt = formatDeployStamp(deployMeta.deployedAt || '');
    const deployCommit = String(deployMeta.commit || '').trim();
    const deployText = deployAt
      ? `uu deploy ${deployAt}${deployCommit ? ` · ${deployCommit}` : ''}`
      : '';

    if (!gistText && !deployText) {
      ss.textContent = '';
    } else if (gistText && deployText) {
      ss.textContent = `${gistText} | ${deployText}`;
    } else {
      ss.textContent = gistText || deployText;
    }
  }
}

function showToastUi(app, msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(app._tt);
  app._tt = setTimeout(() => el.classList.remove('on'), 2200);
}
