const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createElement(id) {
  return { id, value: '', innerHTML: '', textContent: '', style: {} };
}

function loadSettingsController(buildCommandPaletteItems) {
  const repoSyncSource = fs.readFileSync(path.join(process.cwd(), 'js/infra/repo-sync.js'), 'utf8');
  const settingsSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/settings-controller.js'), 'utf8');

  const elements = {};
  ['s-density', 's-guides', 's-branches', 's-focus', 's-measure', 's-style', 's-capslock-action'].forEach((id) => {
    elements[id] = createElement(id);
  });

  const sandbox = {
    console,
    Buffer,
    esc: (v) => String(v || ''),
    buildCommandPaletteItems,
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
  return { data: { settings } };
}

test('syncSettingsUi populates the CapsLock action select from command palette items, excluding "Go to:" entries', () => {
  const fakeItems = (app, state) => [
    { l: 'Quick add task', s: '+ button', fn: () => {} },
    { l: 'Toggle Focus Treatment', s: 'ft', fn: () => {} },
    { l: 'Go to: My Tasks', fn: () => {} }
  ];
  const { syncSettingsUi, elements } = loadSettingsController(fakeItems);
  const S = makeApp({ capsLockAction: 'Toggle Focus Treatment' });

  syncSettingsUi({ select: () => {} }, S);

  const html = elements['s-capslock-action'].innerHTML;
  assert.equal(html.includes('Off'), true);
  assert.equal(html.includes('Quick add task'), true);
  assert.equal(html.includes('Toggle Focus Treatment'), true);
  assert.equal(html.includes('Go to: My Tasks'), false);
  assert.equal(elements['s-capslock-action'].value, 'Toggle Focus Treatment');
});

test('syncSettingsUi defaults the CapsLock action select to Off when unset', () => {
  const fakeItems = () => [{ l: 'Quick add task', s: '+ button', fn: () => {} }];
  const { syncSettingsUi, elements } = loadSettingsController(fakeItems);
  const S = makeApp({});

  syncSettingsUi({ select: () => {} }, S);

  assert.equal(elements['s-capslock-action'].value, '');
});

test('syncSettingsUi does not throw when app has no select() (matches pre-existing call sites)', () => {
  const { syncSettingsUi, elements } = loadSettingsController(undefined);
  const S = makeApp({});

  assert.doesNotThrow(() => syncSettingsUi({}, S));
  // buildCommandPaletteItems was never loaded into this sandbox, so the
  // select is left untouched rather than throwing.
  assert.equal(elements['s-capslock-action'].innerHTML, '');
});
