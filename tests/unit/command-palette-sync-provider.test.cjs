const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCommandPaletteModule() {
  const sourcePath = path.join(process.cwd(), 'js/ui/command-palette-commands.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__exports = { buildCommandPaletteItems };`,
    sandbox,
    { filename: 'command-palette-commands.js' }
  );

  return sandbox.__exports;
}

test('Sync now command uses provider-aware app.syncNow', () => {
  const { buildCommandPaletteItems } = loadCommandPaletteModule();

  let syncNowCalls = 0;
  let syncGistNowCalls = 0;

  const app = {
    syncNow: () => { syncNowCalls += 1; },
    syncGistNow: () => { syncGistNowCalls += 1; },
    select: () => []
  };

  const state = {
    data: { settings: {} },
    msel: new Set()
  };

  const items = buildCommandPaletteItems(app, state);
  const syncItem = items.find((item) => item.l === 'Sync now');

  assert.ok(syncItem, 'Expected Sync now command in command palette');
  syncItem.fn();

  assert.equal(syncNowCalls, 1);
  assert.equal(syncGistNowCalls, 0);
});
