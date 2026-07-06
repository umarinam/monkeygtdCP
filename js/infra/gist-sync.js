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
    filename: (s.gistFilename || 'monkeygtd-backup.json').trim() || 'monkeygtd-backup.json',
    inboxFilename: (s.gistInboxFilename || 'monkeygtd-inbox.ndjson').trim() || 'monkeygtd-inbox.ndjson'
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

function gistPickExactFile(meta, filename) {
  if (!meta?.files) return null;
  return meta.files[filename] || null;
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
  const preservedKeys = ['gistToken', 'gistId', 'gistFilename', 'gistInboxFilename', 'gistLastSyncAt', 'gistLastSyncSummary', 'gistLastLocalSaveAt'];
  for (const key of preservedKeys) {
    if (!current[key] && previousSettings[key]) {
      current[key] = previousSettings[key];
    }
  }
  state.data.settings = current;
}

function gistRememberSyncSummary(state, summary, at) {
  state.data.settings = state.data.settings || {};
  state.data.settings.gistLastSyncSummary = String(summary || '').trim();
  state.data.settings.gistLastSyncAt = String(at || state.data.settings.gistLastSyncAt || new Date().toISOString()).trim();
}

function gistResolveRemoteVsLocal(remoteMs, localMs) {
  if (remoteMs > localMs) return 'pull';
  if (localMs > remoteMs) return 'push';
  return 'noop';
}

function gistRequestId(raw, idx) {
  const base = String(raw || '').trim();
  if (!base) return `req-${idx}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash) + base.charCodeAt(i);
    hash |= 0;
  }
  return `req-${idx}-${Math.abs(hash)}`;
}

function gistParseInboxLines(raw) {
  const lines = String(raw || '').split(/\r?\n/);
  const items = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const req = JSON.parse(line);
      items.push({ ok: true, line, req, idx: i });
    } catch {
      items.push({ ok: false, line, idx: i });
    }
  }
  return items;
}

function gistBuildTaskRecord(parent, content) {
  const text = String(content || '').trim();
  if (!text) return null;

  const fallbackId = `gq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const base = (typeof mkTask === 'function')
    ? mkTask({ content: text, checklist_id: parent.checklist_id || '', parent_id: parent.id })
    : {
      id: fallbackId,
      content: text,
      status: 0,
      checklist_id: parent.checklist_id || '',
      parent_id: parent.id,
      tasks: [],
      tags: {},
      tags_as_text: '',
      color: 0,
      due: '',
      due_asap: false,
      assignees: [],
      notes: [],
      comments_count: 0,
      history: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      completed_at: '',
      deleted: false,
      _collapsed: false
    };

  if (typeof parseSmart === 'function') {
    const parsed = parseSmart(text);
    base.content = parsed.content || base.content;
    if (parsed.tags?.length) {
      for (const tg of parsed.tags) base.tags[tg] = { isPrivate: false };
      base.tags_as_text = parsed.tags.join(',');
    }
    if (parsed.due) base.due = parsed.due;
    if (parsed.due_asap) base.due_asap = true;
    if (parsed.color) base.color = parsed.color;
    if (parsed.assignees?.length) base.assignees = parsed.assignees;
  }

  return base;
}

function gistApplyInboxRequest(state, req) {
  if (!req || req.action !== 'addChild') return { applied: false, reason: 'unsupported-action' };
  const parentId = String(req.parentTaskId || '').trim();
  if (!parentId) return { applied: false, reason: 'missing-parent' };

  const parent = state.data?.tasks?.[parentId];
  if (!parent || parent.deleted) return { applied: false, reason: 'parent-not-found' };

  const task = gistBuildTaskRecord(parent, req.content);
  if (!task) return { applied: false, reason: 'empty-content' };

  state.data.tasks = state.data.tasks || {};
  state.data.tasks[task.id] = task;
  parent.tasks = [...(parent.tasks || []), task.id];

  if (typeof logTaskHistory === 'function') {
    logTaskHistory(task, 'creation', {
      source: 'gist-inbox',
      listId: task.checklist_id || '',
      parentId: parent.id,
      requestId: String(req.id || '').trim()
    });
  }

  return { applied: true, taskId: task.id };
}

async function gistPatchSingleFile(config, filename, content) {
  const res = await fetch(`https://api.github.com/gists/${encodeURIComponent(config.gistId)}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `token ${config.token}`
    },
    body: JSON.stringify({
      files: {
        [filename]: { content }
      }
    })
  });

  if (!res.ok) {
    throw new Error(`Gist queue write failed (${res.status})`);
  }
}

async function gistProcessInboxRemote(state, config, meta) {
  const file = gistPickExactFile(meta, config.inboxFilename);
  if (!file) return { applied: 0, failed: 0, queueUpdated: false, label: config.inboxFilename };

  const raw = await gistReadFileContent(file);
  const parsed = gistParseInboxLines(raw);
  if (!parsed.length) return { applied: 0, failed: 0, queueUpdated: false, label: file.filename || config.inboxFilename };

  const settings = state.data.settings = state.data.settings || {};
  const processed = Array.isArray(settings.gistProcessedInboxIds) ? settings.gistProcessedInboxIds : [];
  const processedSet = new Set(processed);
  const keepLines = [];
  let applied = 0;
  let failed = 0;

  for (const item of parsed) {
    const rid = item.ok ? (String(item.req.id || '').trim() || gistRequestId(item.line, item.idx)) : gistRequestId(item.line, item.idx);
    if (processedSet.has(rid)) {
      continue;
    }

    if (!item.ok) {
      failed++;
      continue;
    }

    const result = gistApplyInboxRequest(state, item.req);
    if (result.applied) {
      processedSet.add(rid);
      applied++;
      continue;
    }

    keepLines.push(item.line);
    failed++;
  }

  settings.gistProcessedInboxIds = Array.from(processedSet).slice(-500);

  const normalizedExisting = parsed.filter(p => p.ok).map(p => p.line).join('\n');
  const nextRaw = keepLines.join('\n');
  const queueUpdated = normalizedExisting !== nextRaw;
  if (queueUpdated) {
    await gistPatchSingleFile(config, config.inboxFilename, nextRaw);
  }

  return {
    applied,
    failed,
    queueUpdated,
    label: file.filename || config.inboxFilename
  };
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

    const remoteDataMs = gistIsoToMs(payload.exportedAt);
    const remoteMetaMs = gistIsoToMs(meta.updated_at);
    const remoteAt = remoteDataMs >= remoteMetaMs ? (payload.exportedAt || '') : (meta.updated_at || '');
    const remoteMs = Math.max(remoteDataMs, remoteMetaMs);
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

    const inbox = await gistProcessInboxRemote(state, config, meta);
    gistRememberSyncSummary(state, inbox.applied > 0 ? `Pulled + inbox imported ${inbox.applied}` : 'Pulled', remoteAt || new Date().toISOString());

    app.save();
    app.render();
    app.syncSettings();
    if (app.syncSB) app.syncSB();

    const label = file?.filename || config.filename;
    const inboxLabel = inbox.applied > 0 ? ` + ${inbox.applied} queued` : '';
    gistSetStatus(`Pulled ${label}${inboxLabel}`, false);
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
    gistRememberSyncSummary(state, 'Pushed', exportedAt);
    app.save();
    app.syncSettings();
    if (app.syncSB) app.syncSB();

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

    const inbox = await gistProcessInboxRemote(state, config, meta);
    if (inbox.applied > 0) {
      gistRememberSyncSummary(state, `Inbox imported ${inbox.applied}`, new Date().toISOString());
      app.save();
      app.render();
      app.syncSettings();
      if (app.syncSB) app.syncSB();
      if (!opts.silent) app.toast(`Gist inbox: added ${inbox.applied} task(s)`);
    }

    const remoteDataMs = gistIsoToMs(payload.exportedAt);
    const remoteMetaMs = gistIsoToMs(meta.updated_at);
    const remoteAt = remoteDataMs >= remoteMetaMs ? (payload.exportedAt || '') : (meta.updated_at || '');
    const remoteMs = Math.max(remoteDataMs, remoteMetaMs);
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

    gistRememberSyncSummary(state, inbox.applied > 0 ? `Inbox imported ${inbox.applied}` : 'In sync', new Date().toISOString());
    app.syncSettings();
    if (app.syncSB) app.syncSB();
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