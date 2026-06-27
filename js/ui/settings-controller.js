'use strict';

/**
 * Settings UI Controller
 * Handles display/sync of settings modal and theme/display preferences
 */

function openSettingsUi(app, S) {
  syncSettingsUi(app, S);
  app.showStorageUsage();
  app.openModal('ov-settings');
}

function syncSettingsUi(app, S) {
  const s = S.data.settings;
  const syncCheckbox = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = !!v;
  };
  syncCheckbox('s-dark', s.darkMode);
  syncCheckbox('s-zen', s.zenMode);
  syncCheckbox('s-showdone', s.showCompleted);
  syncCheckbox('s-mvdown', s.moveCompletedDown);
  syncCheckbox('s-autoclose', s.autoCloseParent);
  syncCheckbox('s-bc', s.showBreadcrumbs);
  syncCheckbox('s-rel', s.relativeDates);
  syncCheckbox('s-hf', s.hideFuture);
  syncCheckbox('s-jsonchip', s.showTaskJsonChip !== false);
  syncCheckbox('s-histchip', s.showTaskHistoryChip !== false);
  const styleEl = document.getElementById('s-style');
  if (styleEl) styleEl.value = s.listStyle || 'none';

  const tokenEl = document.getElementById('gist-token');
  const gistIdEl = document.getElementById('gist-id');
  const gistFileEl = document.getElementById('gist-file');
  const gistAutoEl = document.getElementById('s-gist-auto');
  const gistIntervalEl = document.getElementById('s-gist-interval');
  const token = s.gistToken || localStorage.getItem('mgtd3_gist_token') || '';
  if (tokenEl) tokenEl.value = token;
  if (gistIdEl) gistIdEl.value = s.gistId || '';
  if (gistFileEl) gistFileEl.value = s.gistFilename || 'monkeygtd-backup.json';
  if (gistAutoEl) gistAutoEl.checked = s.gistAutoSyncEnabled !== false;
  if (gistIntervalEl) gistIntervalEl.value = String(Math.max(1, Number(s.gistAutoSyncIntervalMin || 5)));

  const statusEl = document.getElementById('gist-sync-status');
  if (statusEl) {
    const lastSync = s.gistLastSyncAt ? new Date(s.gistLastSyncAt).toLocaleString() : 'never';
    statusEl.textContent = `Last sync: ${lastSync}`;
    statusEl.style.color = 'var(--fg2)';
  }
}

function setDarkModeUi(app, S, v) {
  setDarkModeDomain(app, S, v);
  if (v) {
    document.documentElement.setAttribute('data-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
}

function setZenModeUi(app, S, v) {
  setZenModeDomain(app, S, v);
  if (v) {
    document.body.classList.add('zen');
  } else {
    document.body.classList.remove('zen');
  }
}

function setListStyleUi(app, S, v) {
  setListStyleDomain(app, S, v);
}
