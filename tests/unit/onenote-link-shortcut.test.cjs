const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAddOneNoteLinkUi(overrides = {}) {
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
  vm.runInContext('globalThis.__exports = { mkTask, addOneNoteLinkUi };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

test('addOneNoteLinkUi appends OneNote icon link and logs history', () => {
  const { mkTask, addOneNoteLinkUi } = loadAddOneNoteLinkUi({
    prompt: () => 'onenote:https://example.com/note'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Project notes' });
  const state = {
    selId: 't1',
    data: {
      tasks: { t1: t }
    }
  };

  const calls = { save: 0, render: 0, toast: [] };
  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => { calls.save += 1; },
    render: () => { calls.render += 1; },
    toast: (msg) => { calls.toast.push(msg); }
  };

  addOneNoteLinkUi(app, state);

  assert.equal(t.content.includes('[fa:onenote](onenote:https://example.com/note)'), true);
  assert.equal(t.history.some(h => h.type === 'title' && h.changes.source === 'onenote-link'), true);
  assert.equal(calls.save, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.toast.includes('OneNote link added'), true);
});

test('addOneNoteLinkUi does nothing when prompt is canceled', () => {
  const { mkTask, addOneNoteLinkUi } = loadAddOneNoteLinkUi({
    prompt: () => null
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
    save: () => { throw new Error('save should not be called'); },
    render: () => { throw new Error('render should not be called'); },
    toast: () => {}
  };

  addOneNoteLinkUi(app, state);
  assert.equal(t.content, 'Task');
});

test('addOneNoteLinkUi normalizes pasted markdown link input', () => {
  const { mkTask, addOneNoteLinkUi } = loadAddOneNoteLinkUi({
    prompt: () => '[My Note](onenote:https://example.com/page?id=123)'
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

  addOneNoteLinkUi(app, state);
  assert.equal(t.content.includes('[fa:onenote](onenote:https://example.com/page?id=123)'), true);
});
