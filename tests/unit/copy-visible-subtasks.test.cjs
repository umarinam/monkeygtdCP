const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadClipboardOps(overrides = {}) {
  const utils = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const treeOps = fs.readFileSync(path.join(process.cwd(), 'js/domain/tree-ops.js'), 'utf8');
  const source = fs.readFileSync(path.join(process.cwd(), 'js/domain/clipboard-ops.js'), 'utf8');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    navigator: overrides.navigator || { clipboard: { writeText: () => Promise.resolve() } }
  };

  vm.createContext(sandbox);
  vm.runInContext(utils, sandbox, { filename: 'utils.js' });
  vm.runInContext(treeOps, sandbox, { filename: 'tree-ops.js' });
  vm.runInContext(source, sandbox, { filename: 'clipboard-ops.js' });
  vm.runInContext('globalThis.__exports = { copyDomain };', sandbox, { filename: 'exports.js' });
  return sandbox.__exports;
}

test('copyDomain excludes completed subtasks when hide completed is enabled', async () => {
  let copiedText = '';
  const { copyDomain } = loadClipboardOps({
    navigator: {
      clipboard: {
        writeText: (txt) => {
          copiedText = String(txt || '');
          return Promise.resolve();
        }
      }
    }
  });

  const state = {
    selId: 'p1',
    msel: new Set(),
    clipboard: null,
    data: {
      settings: { showCompleted: false },
      tasks: {
        p1: { id: 'p1', content: 'Parent', status: 0, deleted: false, _collapsed: false, tasks: ['c1', 'c2'] },
        c1: { id: 'c1', content: 'Open Child', status: 0, deleted: false, _collapsed: false, tasks: [] },
        c2: { id: 'c2', content: 'Done Child', status: 1, deleted: false, _collapsed: false, tasks: [] }
      }
    }
  };

  const app = { toast: () => {} };
  copyDomain(app, state);

  assert.equal(Array.isArray(state.clipboard), true);
  assert.equal(state.clipboard.length, 1);
  assert.equal(JSON.stringify(state.clipboard[0].tasks), JSON.stringify(['c1']));
  assert.equal(copiedText.includes('Open Child'), true);
  assert.equal(copiedText.includes('Done Child'), false);
});

test('copyDomain includes hidden completed subtasks when visible-only copy is disabled', async () => {
  let copiedText = '';
  const { copyDomain } = loadClipboardOps({
    navigator: {
      clipboard: {
        writeText: (txt) => {
          copiedText = String(txt || '');
          return Promise.resolve();
        }
      }
    }
  });

  const state = {
    selId: 'p1',
    msel: new Set(),
    clipboard: null,
    data: {
      settings: { showCompleted: false, copyOnlyVisibleSubtasks: false },
      tasks: {
        p1: { id: 'p1', content: 'Parent', status: 0, deleted: false, _collapsed: false, tasks: ['c1', 'c2'] },
        c1: { id: 'c1', content: 'Open Child', status: 0, deleted: false, _collapsed: false, tasks: [] },
        c2: { id: 'c2', content: 'Done Child', status: 1, deleted: false, _collapsed: false, tasks: [] }
      }
    }
  };

  const app = { toast: () => {} };
  copyDomain(app, state);

  assert.equal(Array.isArray(state.clipboard), true);
  assert.equal(state.clipboard.length, 1);
  assert.equal(JSON.stringify(state.clipboard[0].tasks), JSON.stringify(['c1', 'c2']));
  assert.equal(copiedText.includes('Open Child'), true);
  assert.equal(copiedText.includes('Done Child'), true);
});

// Copy always writes Markdown checkboxes now, so the old copyStatusPrefix setting no longer
// changes anything: with it off (the old default) the status markers are still there.
for (const copyStatusPrefix of [true, false]) {
  test(`copyDomain writes Markdown checkboxes (copyStatusPrefix ${copyStatusPrefix})`, async () => {
    let copiedText = '';
    const { copyDomain } = loadClipboardOps({
      navigator: {
        clipboard: {
          writeText: (txt) => {
            copiedText = String(txt || '');
            return Promise.resolve();
          }
        }
      }
    });

    const state = {
      selId: 'p1',
      msel: new Set(),
      clipboard: null,
      data: {
        settings: { showCompleted: true, copyStatusPrefix },
        tasks: {
          p1: { id: 'p1', content: 'Parent', status: 0, deleted: false, _collapsed: false, tasks: ['c1', 'c2'] },
          c1: { id: 'c1', content: 'Open Child', status: 0, deleted: false, _collapsed: false, tasks: [] },
          c2: { id: 'c2', content: 'Done Child', status: 1, deleted: false, _collapsed: false, tasks: [] }
        }
      }
    };

    const app = { toast: () => {} };
    copyDomain(app, state);

    assert.equal(copiedText, '- [ ] Parent\n  - [ ] Open Child\n  - [x] Done Child');
  });
}
