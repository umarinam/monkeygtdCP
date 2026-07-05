const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAddEmailLinkUi(overrides = {}) {
  const utilsSource = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const utilitiesSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/utilities-controller.js'), 'utf8');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    prompt: () => '',
    ...overrides
  };

  vm.createContext(sandbox);
  vm.runInContext(utilsSource, sandbox, { filename: 'js/core/utils.js' });
  vm.runInContext(utilitiesSource, sandbox, { filename: 'js/ui/utilities-controller.js' });
  vm.runInContext('globalThis.__exports = { mkTask, addEmailLinkUi };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

test('addEmailLinkUi converts raw email to mailto envelope token', () => {
  const { mkTask, addEmailLinkUi } = loadAddEmailLinkUi({
    prompt: () => 'alice@example.com'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Follow up' });
  const state = {
    selId: 't1',
    data: {
      tasks: { t1: t }
    }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {}
  };

  addEmailLinkUi(app, state);

  assert.equal(t.content.includes('[fa:envelope](mailto:alice@example.com)'), true);
  assert.equal(t.history.some(h => h.type === 'title' && h.changes.source === 'email-link'), true);
});

test('addEmailLinkUi normalizes pasted markdown link input', () => {
  const { mkTask, addEmailLinkUi } = loadAddEmailLinkUi({
    prompt: () => '[Mail](mailto:bob@example.com)'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Task' });
  const state = {
    selId: 't1',
    data: {
      tasks: { t1: t }
    }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {}
  };

  addEmailLinkUi(app, state);
  assert.equal(t.content.includes('[fa:envelope](mailto:bob@example.com)'), true);
});
