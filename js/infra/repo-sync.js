'use strict';

function repoIsoToMs(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function repoGetToken(state) {
  const fromSettings = state.data?.settings?.repoToken || '';
  if (fromSettings) return fromSettings;
  try {
    return localStorage.getItem('mgtd3_repo_token') || '';
  } catch {
    return '';
  }
}

function repoGetConfig(state) {
  const s = state.data?.settings || {};
  return {
    token: repoGetToken(state),
    owner: String(s.repoOwner || '').trim(),
    repo: String(s.repoName || '').trim(),
    branch: String(s.repoBranch || 'main').trim() || 'main',
    path: String(s.repoPath || 'monkeygtd-backup.json').trim() || 'monkeygtd-backup.json'
  };
}

function repoSetStatus(message, isError) {
  const el = document.getElementById('gist-sync-status');
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? 'var(--danger)' : 'var(--fg2)';
}

function repoEncodePath(path) {
  return String(path || '')
    .split('/')
    .map(part => encodeURIComponent(part))
    .join('/');
}

function repoContentsUrl(config, path, withRef) {
  const base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${repoEncodePath(path || config.path)}`;
  if (!withRef) return base;
  return `${base}?ref=${encodeURIComponent(config.branch)}`;
}

function repoDecodeBase64(content) {
  const b64 = String(content || '').replace(/\n/g, '');
  if (!b64) return '';

  if (typeof atob === 'function') {
    const bin = atob(b64);
    try {
      return decodeURIComponent(escape(bin));
    } catch {
      return bin;
    }
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }

  return '';
}

function repoEncodeBase64(content) {
  const text = String(content || '');

  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(text)));
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }

  return text;
}

function repoParsePayload(raw) {
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

function repoRememberSyncSummary(state, summary, at) {
  state.data.settings = state.data.settings || {};
  const stamp = String(at || state.data.settings.syncLastAt || new Date().toISOString()).trim();
  const text = String(summary || '').trim();

  state.data.settings.syncLastSummary = text;
  state.data.settings.syncLastAt = stamp;
  state.data.settings.repoLastSyncSummary = text;
  state.data.settings.repoLastSyncAt = stamp;
}

function repoPreserveSyncSettings(state, previousSettings) {
  const current = state.data.settings || {};
  const preservedKeys = [
    'gistToken', 'gistId', 'gistFilename', 'gistInboxFilename', 'gistLastSyncAt', 'gistLastSyncSummary',
    'gistLastLocalSaveAt', 'gistAutoSyncEnabled', 'gistAutoSyncIntervalMin',
    'syncProvider', 'repoToken', 'repoOwner', 'repoName', 'repoBranch', 'repoPath',
    'repoLastSyncAt', 'repoLastSyncSummary', 'syncLastAt', 'syncLastSummary'
  ];

  for (const key of preservedKeys) {
    if ((current[key] === undefined || current[key] === null || current[key] === '') && previousSettings[key] !== undefined) {
      current[key] = previousSettings[key];
    }
  }

  state.data.settings = current;
}

function repoResolveRemoteVsLocal(remoteMs, localMs) {
  if (remoteMs > localMs) return 'pull';
  if (localMs > remoteMs) return 'push';
  return 'noop';
}

async function repoFetchFile(config) {
  const res = await fetch(repoContentsUrl(config, config.path, true), {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${config.token}`
    }
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Repo read failed (${res.status})`);

  const json = await res.json();
  return {
    sha: json.sha || '',
    raw: repoDecodeBase64(json.content || ''),
    name: json.name || config.path
  };
}

async function repoWriteFile(config, content, sha) {
  const body = {
    message: `MonkeyGTD backup ${new Date().toISOString()}`,
    content: repoEncodeBase64(content),
    branch: config.branch
  };
  if (sha) body.sha = sha;

  const res = await fetch(repoContentsUrl(config, config.path, false), {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `token ${config.token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = new Error(`Repo write failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

function repoIsWriteConflict(err) {
  const status = Number(err?.status || 0);
  if (status === 409 || status === 422) return true;
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('409') || msg.includes('422') || msg.includes('sha');
}

function repoGetAutoSyncSettings(state) {
  const s = state?.data?.settings || {};
  const enabled = s.gistAutoSyncEnabled !== false;
  const intervalMin = Math.max(1, Number(s.gistAutoSyncIntervalMin || 5));
  return {
    enabled,
    intervalMs: intervalMin * 60 * 1000
  };
}

function startRepoAutoSyncRemote(app, state, options) {
  const opts = options || {};
  const auto = repoGetAutoSyncSettings(state);
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : auto.intervalMs;

  if (state.repoAutoSyncTimer) {
    clearInterval(state.repoAutoSyncTimer);
    state.repoAutoSyncTimer = null;
  }

  if (opts.enabled === false || !auto.enabled) {
    return false;
  }

  state.repoAutoSyncTimer = setInterval(() => {
    syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
  }, intervalMs);

  return true;
}

async function syncFromRepoRemote(app, state, options) {
  const opts = options || {};
  const config = repoGetConfig(state);
  if (!config.token || !config.owner || !config.repo || !config.path) {
    if (!opts.silent) {
      app.toast('Set repo token/owner/name/path first');
      repoSetStatus('Missing repo configuration', true);
    }
    return false;
  }

  try {
    repoSetStatus('Pulling from GitHub repo...', false);
    const remote = await repoFetchFile(config);
    if (!remote) {
      repoSetStatus('Backup file not found in repo', true);
      if (!opts.silent) app.toast('Repo backup file not found');
      return false;
    }

    const payload = repoParsePayload(remote.raw);
    const remoteMs = repoIsoToMs(payload.exportedAt);
    const localMs = Math.max(
      repoIsoToMs(state.data?.settings?.gistLastLocalSaveAt),
      repoIsoToMs(state.data?.settings?.repoLastSyncAt),
      repoIsoToMs(state.data?.settings?.syncLastAt)
    );

    if (opts.auto && remoteMs <= localMs) {
      repoSetStatus('Repo copy is not newer', false);
      return false;
    }

    const prevSettings = state.data.settings || {};
    state.data = payload.data;
    state.data.settings = state.data.settings || {};
    repoPreserveSyncSettings(state, prevSettings);
    state.data.currentListId = state.data.currentListId || Object.keys(state.data.lists || {})[0] || null;
    state.listId = state.data.currentListId;
    state.selId = null;
    state.editId = null;
    state.hoistId = null;
    state.filter = '';
    state.msel.clear();

    const at = payload.exportedAt || new Date().toISOString();
    repoRememberSyncSummary(state, 'Pulled', at);

    app.save();
    app.render();
    app.syncSettings();
    if (app.syncSB) app.syncSB();

    repoSetStatus(`Pulled ${config.path}`, false);
    if (!opts.silent) app.toast('Repo sync: pulled latest');
    return true;
  } catch (err) {
    const msg = err?.message || 'Repo pull failed';
    repoSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}

async function syncToRepoRemote(app, state, options) {
  const opts = options || {};
  const config = repoGetConfig(state);
  if (!config.token || !config.owner || !config.repo || !config.path) {
    if (!opts.silent) {
      app.toast('Set repo token/owner/name/path first');
      repoSetStatus('Missing repo configuration', true);
    }
    return false;
  }

  try {
    repoSetStatus('Pushing to GitHub repo...', false);

    const backupData = JSON.parse(JSON.stringify(state.data));
    if (backupData.settings) {
      delete backupData.settings.gistToken;
      delete backupData.settings.repoToken;
    }

    const exportedAt = new Date().toISOString();
    const content = JSON.stringify({ version: 1, exportedAt, data: backupData }, null, 2);

    // Repo writes can race when another client updates the file between read and write.
    // Retry once with a fresh SHA so users do not hit transient conflict errors.
    let pushed = false;
    for (let attempt = 0; attempt < 2 && !pushed; attempt++) {
      try {
        const remote = await repoFetchFile(config);
        await repoWriteFile(config, content, remote?.sha || '');
        pushed = true;
      } catch (err) {
        if (attempt === 0 && repoIsWriteConflict(err)) {
          repoSetStatus('Remote updated; retrying push...', false);
          continue;
        }
        throw err;
      }
    }

    state.data.settings = state.data.settings || {};
    repoRememberSyncSummary(state, 'Pushed', exportedAt);
    app.save();
    app.syncSettings();
    if (app.syncSB) app.syncSB();

    repoSetStatus(`Pushed ${config.path}`, false);
    if (!opts.silent) app.toast('Repo sync: pushed');
    return true;
  } catch (err) {
    const msg = err?.message || 'Repo push failed';
    repoSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}

async function checkRepoOnRefreshRemote(app, state) {
  const config = repoGetConfig(state);
  if (!config.token || !config.owner || !config.repo || !config.path) return false;
  return syncRepoBidirectionalRemote(app, state, { silent: true, auto: true });
}

async function syncRepoBidirectionalRemote(app, state, options) {
  const opts = options || {};
  const config = repoGetConfig(state);
  if (!config.token || !config.owner || !config.repo || !config.path) {
    if (!opts.silent) {
      app.toast('Set repo token/owner/name/path first');
      repoSetStatus('Missing repo configuration', true);
    }
    return false;
  }

  try {
    repoSetStatus('Syncing with GitHub repo...', false);

    const remote = await repoFetchFile(config);
    if (!remote) {
      return syncToRepoRemote(app, state, { silent: opts.silent });
    }

    const payload = repoParsePayload(remote.raw);
    const remoteMs = repoIsoToMs(payload.exportedAt);
    const localMs = Math.max(
      repoIsoToMs(state.data?.settings?.gistLastLocalSaveAt),
      repoIsoToMs(state.data?.settings?.repoLastSyncAt),
      repoIsoToMs(state.data?.settings?.syncLastAt)
    );

    const action = repoResolveRemoteVsLocal(remoteMs, localMs);

    if (action === 'pull') {
      return syncFromRepoRemote(app, state, { silent: opts.silent, auto: false });
    }
    if (action === 'push') {
      return syncToRepoRemote(app, state, { silent: opts.silent });
    }

    repoRememberSyncSummary(state, 'In sync', new Date().toISOString());
    app.syncSettings();
    if (app.syncSB) app.syncSB();
    repoSetStatus('Repo and local are in sync', false);
    if (!opts.silent) app.toast('Repo sync: already up to date');
    return true;
  } catch (err) {
    const msg = err?.message || 'Repo sync failed';
    repoSetStatus(msg, true);
    if (!opts.silent) app.toast(msg);
    return false;
  }
}
