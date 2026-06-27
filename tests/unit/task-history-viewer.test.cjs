const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadHistoryViewer(deps = {}) {
  const utilsSource = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const modalSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/modal-controller.js'), 'utf8');

  const taskHistoryList = { innerHTML: '' };
  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    document: deps.document || {
      getElementById: (id) => (id === 'task-history-list' ? taskHistoryList : null)
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(utilsSource, sandbox, { filename: 'js/core/utils.js' });
  vm.runInContext(modalSource, sandbox, { filename: 'js/ui/modal-controller.js' });
  vm.runInContext('globalThis.__exports = { openTaskHistoryUi, renderTaskHistoryUi };', sandbox, { filename: 'exports.js' });

  return { ...sandbox.__exports, taskHistoryList };
}

test('openTaskHistoryUi renders reverse-chronological task history entries', () => {
  const { openTaskHistoryUi, taskHistoryList } = loadHistoryViewer();

  const state = {
    selId: 't1',
    data: {
      tasks: {
        t1: {
          id: 't1',
          history: [
            { at: '2026-06-27T10:00:00.000Z', type: 'title', changes: { from: 'Old', to: 'New' } },
            { at: '2026-06-27T11:00:00.000Z', type: 'tags', changes: { from: '', to: 'alpha' } }
          ]
        }
      }
    }
  };

  const calls = { openModal: 0 };
  const app = {
    toast: () => {},
    openModal: () => { calls.openModal += 1; }
  };

  openTaskHistoryUi(app, state, 't1');

  assert.equal(calls.openModal, 1);
  assert.equal(taskHistoryList.innerHTML.includes('task-history-row'), true);
  assert.equal(taskHistoryList.innerHTML.indexOf('Tags') < taskHistoryList.innerHTML.indexOf('Title'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Tags: (none) -&gt; alpha'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Title:'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Old'), true);
  assert.equal(taskHistoryList.innerHTML.includes('New'), true);
});

test('renderTaskHistoryUi formats newly tracked event categories with friendly summaries', () => {
  const { renderTaskHistoryUi, taskHistoryList } = loadHistoryViewer();

  const state = {
    data: {
      tasks: {
        t2: {
          id: 't2',
          history: [
            { at: '2026-06-27T12:00:00.000Z', type: 'status', changes: { from: 0, to: 1 } },
            { at: '2026-06-27T12:01:00.000Z', type: 'notes', changes: { action: 'add-note', fromCount: 0, toCount: 1 } },
            { at: '2026-06-27T12:02:00.000Z', type: 'creation', changes: { source: 'paste', listId: 'l1', parentId: '' } },
            { at: '2026-06-27T12:03:00.000Z', type: 'structure', changes: { action: 'move-to-task', from: { parent_id: '' }, to: { parent_id: 'p1' } } },
            { at: '2026-06-27T12:04:00.000Z', type: 'deletion', changes: { action: 'soft-delete' } }
          ]
        }
      }
    }
  };

  renderTaskHistoryUi(state, 't2');

  assert.equal(taskHistoryList.innerHTML.includes('Status: open -&gt; done'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Notes add-note: 0 -&gt; 1'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Created via paste'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Structure: move-to-task'), true);
  assert.equal(taskHistoryList.innerHTML.includes('Deletion event: soft-delete'), true);
});
