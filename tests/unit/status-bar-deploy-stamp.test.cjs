const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadChromeController(deployMeta = null) {
  const sourcePath = path.join(process.cwd(), 'js/ui/chrome-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const nodes = {
    'sb-list': { textContent: '' },
    'sb-mode': { textContent: '' },
    'sb-sel': { textContent: '' },
    'sb-cnt': { textContent: '' },
    'sb-filt': { textContent: '', style: { display: '' } },
    'sb-sync': { textContent: '' }
  };

  const sandbox = {
    console,
    __MGTD_STANDALONE_DEPLOY: deployMeta || undefined,
    document: {
      getElementById: (id) => nodes[id]
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__exports={syncStatusBarUi};`, sandbox, {
    filename: 'chrome-controller.js'
  });

  return { syncStatusBarUi: sandbox.__exports.syncStatusBarUi, nodes };
}

test('syncStatusBarUi shows standalone deploy stamp in sb-sync', () => {
  const { syncStatusBarUi, nodes } = loadChromeController({
    deployedAt: '2026-07-07T10:20:30.000Z',
    commit: 'abc1234'
  });

  const state = {
    editId: null,
    listId: 'l1',
    selId: null,
    filter: '',
    data: {
      settings: {},
      lists: {
        l1: { id: 'l1', name: 'Main', root_tasks: [] }
      },
      tasks: {}
    }
  };

  syncStatusBarUi(state);

  assert.equal(nodes['sb-sync'].textContent.includes('uu deploy 2026-07-07 10:20:30 UTC'), true);
  assert.equal(nodes['sb-sync'].textContent.includes('abc1234'), true);
});
