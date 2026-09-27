'use strict';

// "Restore Older Version" modal for the GitHub Repo sync provider: lists the
// backup file's commit history and restores the picked version.

function repoVersionsInitialState() {
  return { versions: [], page: 1, hasMore: false, until: '', loading: false, restoring: false, requestId: 0, error: '' };
}

function repoVersionsSetStatus(message, isError) {
  const el = document.getElementById('repo-versions-status');
  if (!el) return;
  el.textContent = message || '';
  el.style.color = isError ? 'var(--danger)' : 'var(--muted)';
}

function repoVersionsUntilIso(dateValue) {
  // <input type="date"> gives YYYY-MM-DD; include that whole local day.
  const text = String(dateValue || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const end = new Date(`${text}T23:59:59.999`);
  return Number.isFinite(end.getTime()) ? end.toISOString() : '';
}

function repoVersionWhen(version) {
  const ms = Date.parse(version?.date || '');
  return Number.isFinite(ms) ? new Date(ms).toLocaleString() : 'Unknown date';
}

function countRepoBackupData(data) {
  const lists = Object.keys(data?.lists || {}).length;
  const tasks = Object.values(data?.tasks || {}).filter(t => t && !t.deleted).length;
  return { lists, tasks };
}

function describeRepoBackupCounts(counts) {
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `${plural(counts.lists, 'list')}, ${plural(counts.tasks, 'task')}`;
}

function renderRepoVersionRow(version, isLatest) {
  const short = version.sha.slice(0, 7);
  // Pushes from this app all say "MonkeyGTD backup <timestamp>", which just
  // repeats the date - only show messages from commits made some other way.
  const message = /^MonkeyGTD backup\b/.test(version.message) ? '' : version.message;
  const meta = [short, version.author, message].filter(Boolean).map(esc).join(' &middot; ');
  const badge = isLatest ? ' <span class="repo-ver-badge">Latest</span>' : '';
  return `<div class="repo-ver-row">`
    + `<div class="repo-ver-main"><div class="repo-ver-when">${esc(repoVersionWhen(version))}${badge}</div>`
    + `<div class="repo-ver-meta">${meta}</div></div>`
    + `<button class="btn btn-sm" data-sha="${esc(version.sha)}" onclick="App.restoreRepoVersion(this.dataset.sha)">Restore</button>`
    + `</div>`;
}

function renderRepoVersionsUi(state) {
  const rv = state.repoVersions || repoVersionsInitialState();
  const versions = rv.versions || [];
  const listEl = document.getElementById('repo-versions-list');
  if (listEl) {
    // Only the head of the unfiltered history is the repo's current copy.
    listEl.innerHTML = versions.length
      ? versions.map((v, i) => renderRepoVersionRow(v, i === 0 && !rv.until)).join('')
      : (rv.loading || rv.error ? '' : '<div style="color:var(--muted);padding:12px">No versions found for this backup file.</div>');
  }
  const moreEl = document.getElementById('repo-versions-more');
  if (moreEl) moreEl.style.display = rv.hasMore && !rv.loading ? '' : 'none';
}

async function loadRepoVersionsUi(app, state, options) {
  const opts = options || {};
  const rv = state.repoVersions;
  if (!rv) return false;
  if (opts.append && (rv.loading || !rv.hasMore)) return false;

  // A newer load (date filter changed, modal reopened) supersedes this one.
  const requestId = rv.requestId + 1;
  rv.requestId = requestId;
  const isStale = () => state.repoVersions !== rv || rv.requestId !== requestId;

  const page = opts.append ? rv.page + 1 : 1;
  rv.loading = true;
  renderRepoVersionsUi(state);
  repoVersionsSetStatus('Loading versions...', false);

  try {
    const result = await listRepoVersionsRemote(state, { page, until: rv.until });
    if (isStale()) return false;
    rv.versions = opts.append ? rv.versions.concat(result.versions) : result.versions;
    rv.page = page;
    rv.hasMore = result.hasMore;
    rv.error = '';
    repoVersionsSetStatus('', false);
    return true;
  } catch (err) {
    if (isStale()) return false;
    rv.error = err?.message || 'Could not load versions';
    repoVersionsSetStatus(rv.error, true);
    return false;
  } finally {
    if (!isStale()) {
      rv.loading = false;
      renderRepoVersionsUi(state);
    }
  }
}

function openRepoVersionsUi(app, state) {
  app.closeModal('ov-settings');
  state.repoVersions = repoVersionsInitialState();
  const untilEl = document.getElementById('repo-versions-until');
  if (untilEl) untilEl.value = '';
  repoVersionsSetStatus('', false);
  renderRepoVersionsUi(state);
  app.openModal('ov-repo-versions');
  return loadRepoVersionsUi(app, state);
}

function loadMoreRepoVersionsUi(app, state) {
  return loadRepoVersionsUi(app, state, { append: true });
}

function setRepoVersionsUntilUi(app, state, dateValue) {
  const rv = state.repoVersions;
  if (!rv) return false;
  rv.until = repoVersionsUntilIso(dateValue);
  rv.versions = [];
  rv.hasMore = false;
  rv.error = '';
  return loadRepoVersionsUi(app, state);
}

async function restoreRepoVersionUi(app, state, commitSha) {
  const rv = state.repoVersions || (state.repoVersions = repoVersionsInitialState());
  if (rv.restoring) return false;
  rv.restoring = true;

  try {
    repoVersionsSetStatus('Loading version...', false);
    let version;
    try {
      version = await fetchRepoVersionRemote(state, commitSha);
    } catch (err) {
      repoVersionsSetStatus(err?.message || 'Could not load version', true);
      return false;
    }

    const listed = (rv.versions || []).find(v => v.sha === version.sha);
    const when = listed
      ? repoVersionWhen(listed)
      : (version.exportedAt ? new Date(version.exportedAt).toLocaleString() : version.sha.slice(0, 7));
    const incoming = countRepoBackupData(version.data);
    const current = countRepoBackupData(state.data);
    const ok = confirm(
      `Restore the version from ${when} (${describeRepoBackupCounts(incoming)})?\n\n`
      + `This replaces your current data (${describeRepoBackupCounts(current)}) and pushes the restored copy `
      + `to the repo as its latest version. You can undo this with Ctrl+Z.`
    );
    if (!ok) {
      repoVersionsSetStatus('', false);
      return false;
    }

    repoVersionsSetStatus('Restoring...', false);
    const result = await restoreRepoVersionRemote(app, state, version, { silent: false });
    if (result.restored) app.closeModal('ov-repo-versions');
    return result.restored;
  } finally {
    rv.restoring = false;
  }
}
