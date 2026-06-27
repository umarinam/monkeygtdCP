'use strict';

function gistIsoToMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function gistGetToken(state) {
  const fromSettings = state.data?.settings?.gistToken || '';
  if (fromSettings) return fromSettings;
  try {
    return localStorage.getItem('mgtd3_gist_token') || '';
  } catch {
    return '';
  }
}

function gistGetConfig(state) {
  const s = state.data?.settings || {};
  return {
    token: gistGetToken(state),
    gistId: (s.gistId || '').trim(),
    filename: (s.gistFilename || 'monkeygtd-backup.json').trim() || 'monkeygtd-backup.json'
  };
}

function gistSetStatus(message, isError) {
  const el = document.getElementById('gist-sync-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
}

async function gistFetchMeta(config) {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(config.gistId)}`, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${config.token}`
    }
  });
  if (!res.ok) {
    throw new Error(`Gist read failed (${res.status})`);
  }
  return res.json();
}

function gistPickFile(meta, filename) {
  if (!meta?.files) return null;
  if (meta.files[filename]) return meta.files[filename];
  const firstJson = Object.values(meta.files).find(f => (f.filename || '').toLowerCase().endsWith('.json'));
  return firstJson || Object.values(meta.files)[0] || null;
}

async function gistReadFileContent(file) {
  if (!file) throw new Error('No file found in gist');
  if (!file.truncated) return file.content || '';
  if (!file.raw_url) throw new Error('Gist file content unavailable');
  const res = await fetch(file.raw_url, { method: 'GET' });
  if (!res.ok) throw new Error(`Gist file download failed (${res.status})`);
  return res.text();
}

function gistParsePayload(raw) {
  const parsed = JSON.parse(raw);
  if (parsed && parsed.data && parsed.version) {
    return {
      data: parsed.data,
      exportedAt: parsed.exportedAt || ''
    };
  }
  return {
    data: parsed,
    exportedAt: ''
  };
}

function gistPreserveSyncSettings(state, previousSettings) {
  const current = state.data.settings || {};
  const preservedKeys = ['gistToken', 'gistId', 'gistFilename', 'gistLastSyncAt', 'gistLastLocalSaveAt'];
  for (const key of preservedKeys) {
    if (!current[key] && previousSettings[key]) {
      current[key] = previousSettings[key];
    }
  }
  state.data.settings = current;
}

function gistResolveRemoteVsLocal(remoteMs, localMs) {
  if (remoteMs > localMs) return 'pull';
  if (localMs > remoteMs) return 'push';
  return 'noop';
}

function gistGetAutoSyncSettings(state) {
  const s = state?.data?.settings || {};
  const enabled = s.gistAutoSyncEnabled !== false;
  const intervalMin = Math.max(1, Number(s.gistAutoSyncIntervalMin || 5));
  return {
    enabled,
    intervalMs: intervalMin * 60 * 1000
  };
}

function startGistAutoSyncRemote(app, state, options) {
  const opts = options || {};
  const auto = gistGetAutoSyncSettings(state);
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : auto.intervalMs;

  if (state.gistAutoSyncTimer) {
    clearInterval(state.gistAutoSyncTimer);
    state.gistAutoSyncTimer = null;
  }

  if (opts.enabled === false || !auto.enabled) {
    return false;
  }

  state.gistAutoSyncTimer = setInterval(() => {
    syncGistBidirectionalRemote(app, state, { silent: true, auto: true });
  }, intervalMs);

  return true;
}

async function syncFromGistRemote(app, state, options) {
  const opts = options || {};
  const config = gistGetConfig(state);
  if (!config.token || !config.gistId) {
    if (!opts.silent) {
      app.toast('Set Gist token and Gist ID first');
      gistSetStatus('Missing token or gist ID', true);
    }
    return false;
  }

  try {
    gistSetStatus('Checking Gist...', false);
    const meta = await gistFetchMeta(config);
    const file = gistPickFile(meta, config.filename);
    const raw = await gistReadFileContent(file);
    const payload = gistParsePayload(raw);

    const remoteAt = payload.exportedAt || meta.updated_at || '';
    const remoteMs = gistIsoToMs(remoteAt);
    const localMs = Math.max(
      gistIsoToMs(state.data?.settings?.gistLastLocalSaveAt),
      gistIsoToMs(state.data?.settings?.gistLastSyncAt)
    );

    if (opts.auto && remoteMs <= localMs) {
      gistSetStatus('Gist copy is not newer', false);
      return false;
    }

    const prevSettings = state.data.settings || {};
    state.data = payload.data;
    state.data.settings = state.data.settings || {};
    gistPreserveSyncSettings(state, prevSettings);
    state.data.currentListId = state.data.currentListId || Object.keys(state.data.lists || {})[0] || null;
    state.listId = state.data.currentListId;
    state.selId = null;
    state.editId = null;
    state.hoistId = null;
    state.filter = '';
    state.msel.clear();
    state.data.settings.gistLastSyncAt = remoteAt || new Date().toISOString();

    app.save();
    app.render();
    app.syncSettings();

    const label = file?.filename || config.filename;
    gistSetStatus(`Pulled ${label}`, false);
    if (!opts.silent) app.toast('Gist sync: pulled latest');
    return true;
  } catch (err) {
    const msg = err?.message || 'Gist pull failed';
    gistSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}

async function syncToGistRemote(app, state, options) {
  const opts = options || {};
  const config = gistGetConfig(state);
  if (!config.token || !config.gistId) {
    if (!opts.silent) {
      app.toast('Set Gist token and Gist ID first');
      gistSetStatus('Missing token or gist ID', true);
    }
    return false;
  }

  try {
    gistSetStatus('Pushing to Gist...', false);

    const backupData = JSON.parse(JSON.stringify(state.data));
    if (backupData.settings) {
      delete backupData.settings.gistToken;
    }
    const exportedAt = new Date().toISOString();
    const content = JSON.stringify({ version: 1, exportedAt, data: backupData }, null, 2);

    const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(config.gistId)}`, {
      method: 'PATCH',
      headers: {
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        Authorization: `token ${config.token}`
      },
      body: JSON.stringify({
        files: {
          [config.filename]: { content }
        }
      })
    });

    if (!res.ok) {
      throw new Error(`Gist write failed (${res.status})`);
    }

    state.data.settings = state.data.settings || {};
    state.data.settings.gistLastSyncAt = exportedAt;
    app.save();
    app.syncSettings();

    gistSetStatus(`Pushed ${config.filename}`, false);
    if (!opts.silent) app.toast('Gist sync: pushed');
    return true;
  } catch (err) {
    const msg = err?.message || 'Gist push failed';
    gistSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}

async function checkGistOnRefreshRemote(app, state) {
  const config = gistGetConfig(state);
  if (!config.token || !config.gistId) return false;
  return syncGistBidirectionalRemote(app, state, { silent: true, auto: true });
}

async function syncGistBidirectionalRemote(app, state, options) {
  const opts = options || {};
  const config = gistGetConfig(state);
  if (!config.token || !config.gistId) {
    if (!opts.silent) {
      app.toast('Set Gist token and Gist ID first');
      gistSetStatus('Missing token or gist ID', true);
    }
    return false;
  }

  try {
    gistSetStatus('Syncing with Gist...', false);
    const meta = await gistFetchMeta(config);
    const file = gistPickFile(meta, config.filename);
    const raw = await gistReadFileContent(file);
    const payload = gistParsePayload(raw);

    const remoteAt = payload.exportedAt || meta.updated_at || '';
    const remoteMs = gistIsoToMs(remoteAt);
    const localMs = Math.max(
      gistIsoToMs(state.data?.settings?.gistLastLocalSaveAt),
      gistIsoToMs(state.data?.settings?.gistLastSyncAt)
    );

    const action = gistResolveRemoteVsLocal(remoteMs, localMs);

    if (action === 'pull') {
      return syncFromGistRemote(app, state, { silent: opts.silent, auto: false });
    }
    if (action === 'push') {
      return syncToGistRemote(app, state, { silent: opts.silent });
    }

    gistSetStatus('Gist and local are in sync', false);
    if (!opts.silent) app.toast('Gist sync: already up to date');
    return true;
  } catch (err) {
    const msg = err?.message || 'Gist sync failed';
    gistSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}