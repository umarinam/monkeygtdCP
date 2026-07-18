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
  const syncSelect = (id, v, fallback) => {
    const el = document.getElementById(id);
    if (el) el.value = String(v || fallback);
  };
  syncCheckbox('s-dark', s.darkMode);
  syncCheckbox('s-zen', s.zenMode);
  syncCheckbox('s-showdone', s.showCompleted);
  syncCheckbox('s-mvdown', s.moveCompletedDown);
  syncCheckbox('s-autoclose', s.autoCloseParent);
  syncCheckbox('s-close-children', s.closeChildrenOnParentDone === true);
  syncCheckbox('s-bc', s.showBreadcrumbs);
  syncCheckbox('s-rel', s.relativeDates);
  syncCheckbox('s-hf', s.hideFuture);
  syncCheckbox('s-copy-visible', s.copyOnlyVisibleSubtasks !== false);
  syncCheckbox('s-copy-status', s.copyStatusPrefix === true);
  syncCheckbox('s-jsonchip', s.showTaskJsonChip !== false);
  syncCheckbox('s-histchip', s.showTaskHistoryChip !== false);
  syncCheckbox('s-parent-emphasis', s.emphasizeParentTasks !== false);
  syncSelect('s-density', s.taskDensity, 'comfortable');
  syncSelect('s-guides', s.indentGuideStyle, 'subtle');
  syncSelect('s-branches', s.branchSpacing, 'relaxed');
  syncSelect('s-focus', s.focusMode, 'off');
  syncSelect('s-measure', s.contentWidth, 'measure');
  const styleEl = document.getElementById('s-style');
  if (styleEl) styleEl.value = s.listStyle || 'none';

  const tokenEl = document.getElementById('gist-token');
  const gistIdEl = document.getElementById('gist-id');
  const gistFileEl = document.getElementById('gist-file');
  const gistAutoEl = document.getElementById('s-gist-auto');
  const gistIntervalEl = document.getElementById('s-gist-interval');
  const providerEl = document.getElementById('s-sync-provider');
  const repoTokenEl = document.getElementById('repo-token');
  const repoOwnerEl = document.getElementById('repo-owner');
  const repoNameEl = document.getElementById('repo-name');
  const repoBranchEl = document.getElementById('repo-branch');
  const repoPathEl = document.getElementById('repo-path');
  const gistFieldsEl = document.getElementById('gist-sync-fields');
  const repoFieldsEl = document.getElementById('repo-sync-fields');
  const token = s.gistToken || localStorage.getItem('mgtd3_gist_token') || '';
  const repoToken = s.repoToken || localStorage.getItem('mgtd3_repo_token') || '';
  const provider = String(s.syncProvider || 'gist').trim() === 'repo' ? 'repo' : 'gist';

  if (providerEl) providerEl.value = provider;
  if (tokenEl) tokenEl.value = token;
  if (gistIdEl) gistIdEl.value = s.gistId || '';
  if (gistFileEl) gistFileEl.value = s.gistFilename || 'monkeygtd-backup.json';
  if (gistAutoEl) gistAutoEl.checked = s.gistAutoSyncEnabled !== false;
  if (gistIntervalEl) gistIntervalEl.value = String(Math.max(1, Number(s.gistAutoSyncIntervalMin || 5)));
  if (repoTokenEl) repoTokenEl.value = repoToken;
  if (repoOwnerEl) repoOwnerEl.value = s.repoOwner || '';
  if (repoNameEl) repoNameEl.value = s.repoName || '';
  if (repoBranchEl) repoBranchEl.value = s.repoBranch || 'main';
  if (repoPathEl) repoPathEl.value = s.repoPath || 'monkeygtd-backup.json';
  if (gistFieldsEl) gistFieldsEl.style.display = provider === 'gist' ? '' : 'none';
  if (repoFieldsEl) repoFieldsEl.style.display = provider === 'repo' ? '' : 'none';

  const statusEl = document.getElementById('gist-sync-status');
  if (statusEl) {
    const at = s.syncLastAt || s.repoLastSyncAt || s.gistLastSyncAt || '';
    const summary = s.syncLastSummary || s.repoLastSyncSummary || s.gistLastSyncSummary || '';
    const lastSync = at ? new Date(at).toLocaleString() : 'never';
    const providerLabel = provider === 'repo' ? 'Repo' : 'Gist';
    statusEl.textContent = summary
      ? `${providerLabel}: ${summary} @ ${lastSync}`
      : `${providerLabel}: Last sync ${lastSync}`;
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
