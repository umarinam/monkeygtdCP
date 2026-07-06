const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadAddFileLinkUi(overrides = {}) {
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
  vm.runInContext('globalThis.__exports = { mkTask, addFileLinkUi };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

test('addFileLinkUi prefixes raw file path with start protocol', () => {
  const { mkTask, addFileLinkUi } = loadAddFileLinkUi({
    prompt: () => 'D:/Docs/spec.docx'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Spec' });
  const state = {
    selId: 't1',
    data: { tasks: { t1: t } }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {}
  };

  addFileLinkUi(app, state);

  assert.equal(t.content.includes('[fa:file](start:D:/Docs/spec.docx)'), true);
  assert.equal(t.history.some(h => h.type === 'title' && h.changes.source === 'file-link'), true);
});

test('addFileLinkUi preserves existing start protocol from markdown link input', () => {
  const { mkTask, addFileLinkUi } = loadAddFileLinkUi({
    prompt: () => '[Spec](start:D:/Docs/spec.docx)'
  });

  const t = mkTask({ id: 't1', checklist_id: 'l1', content: 'Spec' });
  const state = {
    selId: 't1',
    data: { tasks: { t1: t } }
  };

  const app = {
    pushUndo: () => {},
    snap: () => ({}),
    save: () => {},
    render: () => {},
    toast: () => {}
  };

  addFileLinkUi(app, state);

  assert.equal(t.content.includes('[fa:file](start:D:/Docs/spec.docx)'), true);
  assert.equal(t.content.includes('start:start:'), false);
});
