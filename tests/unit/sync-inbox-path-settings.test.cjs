const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id) {
  return { id, value: '', textContent: '', style: {} };
}

function loadSettingsController() {
  const repoSyncSource = fs.readFileSync(path.join(process.cwd(), 'js/infra/repo-sync.js'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/settings-controller.js'), 'utf8');

  const elements = {};
  [
    's-density', 's-guides', 's-branches', 's-focus', 's-measure', 's-style',
    'gist-token', 'gist-id', 'gist-file', 'gist-inbox-file', 's-gist-auto', 's-gist-interval',
    's-sync-provider', 'repo-token', 'repo-owner', 'repo-name', 'repo-branch', 'repo-path',
    'repo-inbox-path', 'gist-sync-fields', 'repo-sync-fields', 'gist-sync-status', 'sync-inbox-path'
  ].forEach((id) => { elements[id] = createElement(id); });

  const sandbox = {
    console,
    Buffer,
    document: { getElementById: (id) => elements[id] || null },
    localStorage: { getItem: () => '', setItem: () => {}, removeItem: () => {} }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${repoSyncSource}\n${settingsSource}\n;globalThis.__settingsExports = { syncSettingsUi };`,
    sandbox,
    { filename: 'settings-controller.js' }
  );

  return { syncSettingsUi: sandbox.__settingsExports.syncSettingsUi, elements };
}

function makeApp(settings) {
  return {
    data: { settings }
  };
}

test('repo sync settings show computed default inbox path when no override is set', () => {
  const { syncSettingsUi, elements } = loadSettingsController();
  const S = makeApp({
    syncProvider: 'repo',
    repoOwner: 'octocat',
    repoName: 'private-backups',
    repoPath: 'backups/monkeygtd-backup.json'
  });

  syncSettingsUi({}, S);

  assert.equal(elements['repo-inbox-path'].value, '');
  assert.equal(elements['sync-inbox-path'].textContent, 'Inbox queue file: backups/monkeygtd-inbox.ndjson');
});

test('repo sync settings show custom inbox path override when configured', () => {
  const { syncSettingsUi, elements } = loadSettingsController();
  const S = makeApp({
    syncProvider: 'repo',
    repoPath: 'backups/monkeygtd-backup.json',
    repoInboxPath: 'queues/custom-inbox.ndjson'
  });

  syncSettingsUi({}, S);

  assert.equal(elements['repo-inbox-path'].value, 'queues/custom-inbox.ndjson');
  assert.equal(elements['sync-inbox-path'].textContent, 'Inbox queue file: queues/custom-inbox.ndjson');
});

test('gist sync settings show inbox filename with sensible default', () => {
  const { syncSettingsUi, elements } = loadSettingsController();
  const S = makeApp({ syncProvider: 'gist' });

  syncSettingsUi({}, S);

  assert.equal(elements['gist-inbox-file'].value, 'monkeygtd-inbox.ndjson');
  assert.equal(elements['sync-inbox-path'].textContent, 'Inbox queue file: monkeygtd-inbox.ndjson');
});
