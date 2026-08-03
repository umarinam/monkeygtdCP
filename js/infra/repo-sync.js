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

function repoDefaultInboxPath(backupPath) {
  const path = String(backupPath || '').trim() || 'monkeygtd-backup.json';
  const idx = path.lastIndexOf('/');
  if (idx === -1) return 'monkeygtd-inbox.ndjson';
  return `${path.slice(0, idx)}/monkeygtd-inbox.ndjson`;
}

function repoGetConfig(state) {
  const s = state.data?.settings || {};
  const path = String(s.repoPath || 'monkeygtd-backup.json').trim() || 'monkeygtd-backup.json';
  return {
    token: repoGetToken(state),
    owner: String(s.repoOwner || '').trim(),
    repo: String(s.repoName || '').trim(),
    branch: String(s.repoBranch || 'main').trim() || 'main',
    path,
    inboxPath: String(s.repoInboxPath || '').trim() || repoDefaultInboxPath(path)
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
  const text = String(raw || '').trim();
  if (!text) {
    throw new Error('Remote backup file is empty. Push local data to repair it.');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Remote backup file has invalid JSON. Push local data to repair it.');
  }

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
    'syncProvider', 'repoToken', 'repoOwner', 'repoName', 'repoBranch', 'repoPath', 'repoInboxPath',
    'repoLastSyncAt', 'repoLastSyncSummary', 'syncLastAt', 'syncLastSummary', 'repoProcessedInboxIds'
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

async function repoFetchFile(config, pathOverride) {
  const path = pathOverride || config.path;
  const res = await fetch(repoContentsUrl(config, path, true), {
    method: 'GET',
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `token ${config.token}`
    }
  });

  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Repo read failed (${res.status})`);

  const json = await res.json();
  if (Array.isArray(json)) {
    throw new Error(`Repo path points to a directory: ${path}`);
  }

  let raw = repoDecodeBase64(json.content || '');
  if (!raw && json.git_url) {
    const blobRes = await fetch(String(json.git_url), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${config.token}`
      }
    });
    if (blobRes.ok) {
      const blobJson = await blobRes.json();
      raw = repoDecodeBase64(blobJson?.content || '');
    }
  }

  if (!raw) {
    const rawRes = await fetch(repoContentsUrl(config, path, true), {
      method: 'GET',
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github.raw',
        Authorization: `token ${config.token}`
      }
    });
    if (rawRes.ok) {
      raw = await rawRes.text();
    }
  }

  if (!raw && json.download_url) {
    const downloadRes = await fetch(String(json.download_url), {
      method: 'GET',
      cache: 'no-store'
    });
    if (downloadRes.ok) {
      raw = await downloadRes.text();
    }
  }

  return {
    sha: json.sha || '',
    raw,
    name: json.name || path
  };
}

async function repoWriteFile(config, content, sha, pathOverride) {
  const path = pathOverride || config.path;
  const body = {
    message: `MonkeyGTD backup ${new Date().toISOString()}`,
    content: repoEncodeBase64(content),
    branch: config.branch
  };
  if (sha) body.sha = sha;

  const res = await fetch(repoContentsUrl(config, path, false), {
    method: 'PUT',
    headers: {
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      Authorization: `token ${config.token}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = String(body?.message || '').trim();
    } catch {}

    const suffix = detail ? `: ${detail}` : '';
    const err = new Error(`Repo write failed (${res.status})${suffix}`);
    err.status = res.status;
    err.detail = detail;
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

function repoRequestId(raw, idx) {
  const base = String(raw || '').trim();
  if (!base) return `req-${idx}`;
  let hash = 0;
  for (let i = 0; i < base.length; i++) {
    hash = ((hash << 5) - hash) + base.charCodeAt(i);
    hash |= 0;
  }
  return `req-${idx}-${Math.abs(hash)}`;
}

function repoParseInboxLines(raw) {
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

function repoBuildTaskRecord(parent, content, options) {
  const opts = options || {};
  const checklistId = opts.checklistId || parent?.checklist_id || '';
  const parentId = typeof opts.parentId === 'string' ? opts.parentId : (parent?.id || '');
  const text = String(content || '').trim();
  if (!text) return null;

  const fallbackId = `rq_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const base = (typeof mkTask === 'function')
    ? mkTask({ content: text, checklist_id: checklistId, parent_id: parentId })
    : {
      id: fallbackId,
      content: text,
      status: 0,
      checklist_id: checklistId,
      parent_id: parentId,
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

function repoResolveInboxListId(state, req) {
  const lists = state.data?.lists || {};
  const listIds = Object.keys(lists);
  if (!listIds.length) return '';

  const requested = String(req?.listId || '').trim();
  if (requested && lists[requested]) return requested;

  const inboxByName = Object.values(lists).find(l => String(l?.name || '').trim().toLowerCase() === 'inbox');
  if (inboxByName?.id) return inboxByName.id;

  const currentListId = String(state.data?.currentListId || '').trim();
  if (currentListId && lists[currentListId]) return currentListId;

  return listIds[0] || '';
}

function repoApplyDueFromRequest(task, req) {
  const due = String(req?.due || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(due)) {
    task.due = due;
    task.due_asap = false;
  }
  if (req?.due_asap === true && !task.due) {
    task.due_asap = true;
  }
}

function repoApplyInboxRequest(state, req) {
  if (!req) return { applied: false, reason: 'unsupported-action' };
  const action = String(req.action || '').trim();

  let task = null;
  let parentId = '';
  let listId = '';

  if (action === 'addChild') {
    parentId = String(req.parentTaskId || '').trim();
    if (!parentId) return { applied: false, reason: 'missing-parent' };

    const parent = state.data?.tasks?.[parentId];
    if (!parent || parent.deleted) return { applied: false, reason: 'parent-not-found' };

    task = repoBuildTaskRecord(parent, req.content, {
      checklistId: parent.checklist_id || '',
      parentId: parent.id
    });
    if (!task) return { applied: false, reason: 'empty-content' };

    state.data.tasks = state.data.tasks || {};
    state.data.tasks[task.id] = task;
    parent.tasks = [...(parent.tasks || []), task.id];
    listId = task.checklist_id || '';
  } else if (action === 'addInbox') {
    listId = repoResolveInboxListId(state, req);
    if (!listId) return { applied: false, reason: 'missing-list' };

    const content = String(req.content || '').trim();
    task = repoBuildTaskRecord(null, content, {
      checklistId: listId,
      parentId: ''
    });
    if (!task) return { applied: false, reason: 'empty-content' };

    state.data.tasks = state.data.tasks || {};
    state.data.tasks[task.id] = task;

    const list = state.data.lists[listId];
    list.root_tasks = [...(list.root_tasks || []), task.id];
  } else {
    return { applied: false, reason: 'unsupported-action' };
  }

  repoApplyDueFromRequest(task, req);

  if (typeof logTaskHistory === 'function') {
    logTaskHistory(task, 'creation', {
      source: 'repo-inbox',
      listId: task.checklist_id || listId,
      parentId,
      requestId: String(req.id || '').trim()
    });
  }

  return { applied: true, taskId: task.id };
}

async function repoProcessInboxRemote(state, config) {
  const file = await repoFetchFile(config, config.inboxPath);
  if (!file) return { applied: 0, failed: 0, queueUpdated: false, label: config.inboxPath };

  const parsed = repoParseInboxLines(file.raw);
  if (!parsed.length) return { applied: 0, failed: 0, queueUpdated: false, label: file.name || config.inboxPath };

  const settings = state.data.settings = state.data.settings || {};
  const processed = Array.isArray(settings.repoProcessedInboxIds) ? settings.repoProcessedInboxIds : [];
  const processedSet = new Set(processed);
  const keepLines = [];
  let applied = 0;
  let failed = 0;

  for (const item of parsed) {
    const rid = item.ok ? (String(item.req.id || '').trim() || repoRequestId(item.line, item.idx)) : repoRequestId(item.line, item.idx);
    if (processedSet.has(rid)) {
      continue;
    }

    if (!item.ok) {
      failed++;
      continue;
    }

    const result = repoApplyInboxRequest(state, item.req);
    if (result.applied) {
      processedSet.add(rid);
      applied++;
      continue;
    }

    keepLines.push(item.line);
    failed++;
  }

  settings.repoProcessedInboxIds = Array.from(processedSet).slice(-500);

  const normalizedExisting = parsed.filter(p => p.ok).map(p => p.line).join('\n');
  const nextRaw = keepLines.join('\n');
  const queueUpdated = normalizedExisting !== nextRaw;
  if (queueUpdated) {
    await repoWriteFile(config, nextRaw, file.sha, config.inboxPath);
  }

  return {
    applied,
    failed,
    queueUpdated,
    label: file.name || config.inboxPath
  };
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
    const prevHoistId = state.hoistId;
    const prevSelId = state.selId;
    const prevFilter = state.filter;
    const prevMsel = new Set(state.msel);
    
    state.data = payload.data;
    state.data.settings = state.data.settings || {};
    repoPreserveSyncSettings(state, prevSettings);
    state.data.currentListId = state.data.currentListId || Object.keys(state.data.lists || {})[0] || null;
    state.listId = state.data.currentListId;
    state.editId = null;
    
    state.hoistId = (prevHoistId && state.data.tasks[prevHoistId] && !state.data.tasks[prevHoistId].deleted) ? prevHoistId : null;
    state.selId = (prevSelId && state.data.tasks[prevSelId] && !state.data.tasks[prevSelId].deleted) ? prevSelId : null;
    state.filter = prevFilter;
    state.msel = new Set(Array.from(prevMsel).filter(id => state.data.tasks[id] && !state.data.tasks[id].deleted));

    const at = payload.exportedAt || new Date().toISOString();
    const inbox = await repoProcessInboxRemote(state, config);
    repoRememberSyncSummary(state, inbox.applied > 0 ? `Pulled + inbox imported ${inbox.applied}` : 'Pulled', at);

    app.save();
    app.render();
    app.syncSettings();
    if (app.syncSB) app.syncSB();

    const inboxLabel = inbox.applied > 0 ? ` + ${inbox.applied} queued` : '';
    repoSetStatus(`Pulled ${config.path}${inboxLabel}`, false);
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
    const maxAttempts = 4;
    for (let attempt = 0; attempt < maxAttempts && !pushed; attempt++) {
      try {
        const remote = await repoFetchFile(config);
        await repoWriteFile(config, content, remote?.sha || '');
        pushed = true;
      } catch (err) {
        if (repoIsWriteConflict(err) && attempt < (maxAttempts - 1)) {
          repoSetStatus(`Remote updated; retrying push (${attempt + 2}/${maxAttempts})...`, false);
          continue;
        }
        if (repoIsWriteConflict(err)) {
          throw new Error('Repo write conflict after multiple retries. Remote changed repeatedly; run Sync now again.');
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

    const inbox = await repoProcessInboxRemote(state, config);
    if (inbox.applied > 0) {
      repoRememberSyncSummary(state, `Inbox imported ${inbox.applied}`, new Date().toISOString());
      app.save();
      app.render();
      app.syncSettings();
      if (app.syncSB) app.syncSB();
      if (!opts.silent) app.toast(`Repo inbox: added ${inbox.applied} task(s)`);
    }

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

    state.data.settings = state.data.settings || {};
    const summary = inbox.applied > 0 ? `Inbox imported ${inbox.applied}` : 'In sync';
    state.data.settings.syncLastSummary = summary;
    state.data.settings.repoLastSyncSummary = summary;
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
