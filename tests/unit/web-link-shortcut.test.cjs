const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAddWebLinkUi(overrides = {}) {
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
  vm.runInContext('globalThis.__exports = { mkTask, addWebLinkUi, addLabeledWebLinkUi };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

test('addWebLinkUi normalizes bare domain to https link token', () => {
  const { mkTask, addWebLinkUi } = loadAddWebLinkUi({
    prompt: () => 'example.com/docs'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Reference' });
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

  addWebLinkUi(app, state);

  assert.equal(t.content.includes('[fa:link](https://example.com/docs)'), true);
  assert.equal(t.history.some(h => h.type === 'title' && h.changes.source === 'web-link'), true);
});

test('addWebLinkUi keeps existing https markdown link target', () => {
  const { mkTask, addWebLinkUi } = loadAddWebLinkUi({
    prompt: () => '[Site](https://example.com/path)'
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

  addWebLinkUi(app, state);
  assert.equal(t.content.includes('[fa:link](https://example.com/path)'), true);
});

test('addLabeledWebLinkUi prompts for label and url then appends markdown link', () => {
  const prompts = ['Docs', 'example.com/docs'];
  const { mkTask, addLabeledWebLinkUi } = loadAddWebLinkUi({
    prompt: () => prompts.shift()
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

  addLabeledWebLinkUi(app, state);

  assert.equal(t.content.includes('[Docs](https://example.com/docs)'), true);
  assert.equal(t.history.some(h => h.type === 'title' && h.changes.source === 'web-link-labeled'), true);
});
