const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModalController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/modal-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    now: () => '2026-06-27T12:00:00.000Z'
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__syncSettingsExports = { buildSyncSettingsExportPayload, parseSyncSettingsImportInput, applySyncSettingsImportUi };`,
    sandbox,
    { filename: 'modal-controller.js' }
  );

  return sandbox.__syncSettingsExports;
}

function makeFakeApp() {
  const calls = [];
  const methodNames = [
    'setSyncProvider', 'setGistToken', 'setGistId', 'setGistFilename', 'setGistInboxFilename',
    'setGistAutoSyncEnabled', 'setGistAutoSyncInterval', 'setRepoToken', 'setRepoOwner',
    'setRepoName', 'setRepoBranch', 'setRepoPath', 'setRepoInboxPath'
  ];
  const app = { calls };
  for (const name of methodNames) {
    app[name] = (v) => calls.push([name, v]);
  }
  return app;
}

test('buildSyncSettingsExportPayload includes every sync setting with sensible defaults when unset', () => {
  const { buildSyncSettingsExportPayload } = loadModalController();
  const payload = buildSyncSettingsExportPayload({ data: { settings: {} } });

  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, '2026-06-27T12:00:00.000Z');
  assert.equal(payload.syncProvider, 'gist');
  assert.equal(payload.gistToken, '');
  assert.equal(payload.gistId, '');
  assert.equal(payload.gistFilename, 'monkeygtd-backup.json');
  assert.equal(payload.gistInboxFilename, 'monkeygtd-inbox.ndjson');
  assert.equal(payload.gistAutoSyncEnabled, false);
  assert.equal(payload.gistAutoSyncIntervalMin, 5);
  assert.equal(payload.repoToken, '');
  assert.equal(payload.repoOwner, '');
  assert.equal(payload.repoName, '');
  assert.equal(payload.repoBranch, 'main');
  assert.equal(payload.repoPath, 'monkeygtd-backup.json');
  assert.equal(payload.repoInboxPath, '');
});

test('buildSyncSettingsExportPayload reflects the device\'s actual configured sync settings', () => {
  const { buildSyncSettingsExportPayload } = loadModalController();
  const payload = buildSyncSettingsExportPayload({
    data: {
      settings: {
        syncProvider: 'repo',
        gistToken: 'ghp_secret',
        gistId: 'gist123',
        repoToken: 'github_pat_secret',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'develop',
        repoPath: 'backups/todo.json',
        repoInboxPath: 'backups/inbox.ndjson',
        gistAutoSyncEnabled: true,
        gistAutoSyncIntervalMin: 15
      }
    }
  });

  assert.equal(payload.syncProvider, 'repo');
  assert.equal(payload.gistToken, 'ghp_secret');
  assert.equal(payload.gistId, 'gist123');
  assert.equal(payload.repoToken, 'github_pat_secret');
  assert.equal(payload.repoOwner, 'octocat');
  assert.equal(payload.repoName, 'private-backups');
  assert.equal(payload.repoBranch, 'develop');
  assert.equal(payload.repoPath, 'backups/todo.json');
  assert.equal(payload.repoInboxPath, 'backups/inbox.ndjson');
  assert.equal(payload.gistAutoSyncEnabled, true);
  assert.equal(payload.gistAutoSyncIntervalMin, 15);
});

test('parseSyncSettingsImportInput rejects empty input, invalid JSON, and non-object shapes', () => {
  const { parseSyncSettingsImportInput } = loadModalController();

  assert.throws(() => parseSyncSettingsImportInput(''), /Paste exported sync settings JSON first/);
  assert.throws(() => parseSyncSettingsImportInput('   '), /Paste exported sync settings JSON first/);
  assert.throws(() => parseSyncSettingsImportInput('{not valid json'), /Invalid JSON/);
  assert.throws(() => parseSyncSettingsImportInput('[1,2,3]'), /Sync settings JSON must be an object/);
  assert.throws(() => parseSyncSettingsImportInput('null'), /Sync settings JSON must be an object/);
  assert.throws(() => parseSyncSettingsImportInput('"just a string"'), /Sync settings JSON must be an object/);
});

test('parseSyncSettingsImportInput returns the parsed object for valid JSON', () => {
  const { parseSyncSettingsImportInput } = loadModalController();
  const parsed = parseSyncSettingsImportInput('{"syncProvider":"repo","repoOwner":"octocat"}');
  assert.deepEqual(parsed, { syncProvider: 'repo', repoOwner: 'octocat' });
});

test('applySyncSettingsImportUi round-trips a full export back through every setter', () => {
  const { buildSyncSettingsExportPayload, applySyncSettingsImportUi } = loadModalController();
  const app = makeFakeApp();

  const payload = buildSyncSettingsExportPayload({
    data: {
      settings: {
        syncProvider: 'repo',
        gistToken: 'ghp_secret',
        gistId: 'gist123',
        gistFilename: 'custom-backup.json',
        gistInboxFilename: 'custom-inbox.ndjson',
        gistAutoSyncEnabled: true,
        gistAutoSyncIntervalMin: 20,
        repoToken: 'github_pat_secret',
        repoOwner: 'octocat',
        repoName: 'private-backups',
        repoBranch: 'develop',
        repoPath: 'backups/todo.json',
        repoInboxPath: 'backups/inbox.ndjson'
      }
    }
  });

  applySyncSettingsImportUi(app, payload);

  assert.deepEqual(app.calls, [
    ['setSyncProvider', 'repo'],
    ['setGistToken', 'ghp_secret'],
    ['setGistId', 'gist123'],
    ['setGistFilename', 'custom-backup.json'],
    ['setGistInboxFilename', 'custom-inbox.ndjson'],
    ['setGistAutoSyncEnabled', true],
    ['setGistAutoSyncInterval', 20],
    ['setRepoToken', 'github_pat_secret'],
    ['setRepoOwner', 'octocat'],
    ['setRepoName', 'private-backups'],
    ['setRepoBranch', 'develop'],
    ['setRepoPath', 'backups/todo.json'],
    ['setRepoInboxPath', 'backups/inbox.ndjson']
  ]);
});

test('applySyncSettingsImportUi only touches fields present in a partial/hand-edited payload', () => {
  const { applySyncSettingsImportUi } = loadModalController();
  const app = makeFakeApp();

  applySyncSettingsImportUi(app, { repoOwner: 'octocat', repoName: 'private-backups' });

  assert.deepEqual(app.calls, [
    ['setRepoOwner', 'octocat'],
    ['setRepoName', 'private-backups']
  ]);
});

test('applySyncSettingsImportUi coerces non-string/missing values safely instead of throwing', () => {
  const { applySyncSettingsImportUi } = loadModalController();
  const app = makeFakeApp();

  applySyncSettingsImportUi(app, { gistToken: null, gistId: 42, gistAutoSyncEnabled: 'yes', gistAutoSyncIntervalMin: '30' });

  assert.deepEqual(app.calls, [
    ['setGistToken', ''],
    ['setGistId', '42'],
    ['setGistAutoSyncEnabled', true],
    ['setGistAutoSyncInterval', '30']
  ]);
});
