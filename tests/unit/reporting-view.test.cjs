const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderContext() {
  const sandbox = {
    console,
    JSON,
    Math,
    Date
  };

  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(process.cwd(), 'js/ui/render-controller.js'), 'utf8');
  vm.runInContext(
    `${source}; globalThis.__exports = { ensureReportFilters, filterReportRows, buildReportLegendUi };`,
    sandbox,
    { filename: 'render-controller.js' }
  );
  return sandbox.__exports;
}

test('ensureReportFilters initializes all filter keys', () => {
  const { ensureReportFilters } = loadRenderContext();
  const state = {};
  const filters = ensureReportFilters(state);

  assert.equal(filters.added, true);
  assert.equal(filters.modified, true);
  assert.equal(filters.completed, true);
  assert.equal(filters.deleted, true);
  assert.equal(filters.untouched, true);
});

test('filterReportRows applies active status filters', () => {
  const { filterReportRows } = loadRenderContext();
  const rows = [
    { id: '1', statusKey: 'added' },
    { id: '2', statusKey: 'deleted' },
    { id: '3', statusKey: 'untouched' }
  ];
  const filters = { added: true, modified: false, completed: false, deleted: false, untouched: true };

  const filtered = filterReportRows(rows, filters);
  const ids = filtered.map(r => r.id);

  assert.equal(ids.includes('1'), true);
  assert.equal(ids.includes('3'), true);
  assert.equal(ids.includes('2'), false);
});

test('buildReportLegendUi renders clickable legend buttons and counts', () => {
  const { buildReportLegendUi } = loadRenderContext();
  const html = buildReportLegendUi(
    { added: true, modified: true, completed: true, deleted: false, untouched: true },
    { added: 3, modified: 2, completed: 1, deleted: 4, untouched: 5 }
  );

  assert.equal(html.includes("App.toggleReportFilter('deleted')"), true);
  assert.equal(html.includes('Deleted (4)'), true);
  assert.equal(html.includes('rp-deleted off'), true);
});
