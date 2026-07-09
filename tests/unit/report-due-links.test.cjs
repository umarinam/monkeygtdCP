const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderContext(docNodes = {}) {
  const defaultNode = {
    classList: { add: () => {}, remove: () => {}, contains: () => false },
    innerHTML: '',
    textContent: '',
    value: ''
  };

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    document: {
      getElementById: (id) => docNodes[id] || defaultNode,
      querySelectorAll: () => [],
      querySelector: () => null
    },
    requestAnimationFrame: (fn) => fn(),
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  const utilsSource = fs.readFileSync(path.join(process.cwd(), 'js/core/utils.js'), 'utf8');
  const renderSource = fs.readFileSync(path.join(process.cwd(), 'js/ui/render-controller.js'), 'utf8');
  vm.runInContext(utilsSource, sandbox, { filename: 'utils.js' });
  vm.runInContext(
    `${renderSource}\n;globalThis.__exports = { renderReportUi, renderDueUi };`,
    sandbox,
    { filename: 'render-controller.js' }
  );

  return sandbox.__exports;
}

test('renderReportUi renders markdown links as anchors', () => {
  const docNodes = {
    'report-start': { value: '2026-07-01' },
    'report-end': { value: '2026-07-06' },
    'report-legend': { innerHTML: '' },
    'report-c': { innerHTML: '' }
  };
  const { renderReportUi } = loadRenderContext(docNodes);

  const state = {
    listId: 'l1',
    reportStart: '2026-07-01',
    reportEnd: '2026-07-06',
    reportFilters: { added: true, modified: true, completed: true, deleted: true, untouched: true },
    data: {
      lists: {
        l1: { id: 'l1', name: 'Main' }
      }
    }
  };

  const app = {
    select: (name) => {
      if (name === 'report.rows') {
        return [{ id: 't1', content: '[Spec](https://example.com/spec)', statusKey: 'added', depth: 0 }];
      }
      return [];
    }
  };

  renderReportUi(app, state);

  assert.equal(docNodes['report-c'].innerHTML.includes('href="https://example.com/spec"'), true);
  assert.equal(docNodes['report-c'].innerHTML.includes('target="_blank"'), true);
});

test('renderDueUi renders markdown links as anchors', () => {
  const docNodes = {
    'due-c': { innerHTML: '' }
  };
  const { renderDueUi } = loadRenderContext(docNodes);

  const state = {
    data: {
      settings: { relativeDates: false },
      lists: {
        l1: { id: 'l1', name: 'Main' }
      }
    }
  };

  const app = {
    select: (name) => {
      if (name === 'due.sections') {
        return [{
          title: 'Today',
          items: [{
            id: 't1',
            checklist_id: 'l1',
            status: 0,
            content: '[Runbook](https://example.com/runbook)',
            due: '2026-07-06',
            due_asap: false
          }]
        }];
      }
      return [];
    }
  };

  renderDueUi(app, state);

  assert.equal(docNodes['due-c'].innerHTML.includes('href="https://example.com/runbook"'), true);
  assert.equal(docNodes['due-c'].innerHTML.includes('target="_blank"'), true);
});

test('renderDueUi shows priority chip when task has priority', () => {
  const docNodes = {
    'due-c': { innerHTML: '' }
  };
  const { renderDueUi } = loadRenderContext(docNodes);

  const state = {
    data: {
      settings: { relativeDates: false },
      lists: {
        l1: { id: 'l1', name: 'Main' }
      }
    }
  };

  const app = {
    select: (name) => {
      if (name === 'due.sections') {
        return [{
          title: 'Overdue',
          items: [{
            id: 't1',
            checklist_id: 'l1',
            status: 0,
            content: 'Priority task',
            due: '2026-07-06',
            due_asap: false,
            color: 5
          }]
        }];
      }
      return [];
    }
  };

  renderDueUi(app, state);

  assert.equal(docNodes['due-c'].innerHTML.includes('class="dpri priority-5"'), true);
  assert.equal(docNodes['due-c'].innerHTML.includes('P5'), true);
});
