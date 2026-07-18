const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadApp() {
  const sourcePath = path.join(process.cwd(), 'js/app.js');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/App\.init\(\);\s*$/, 'globalThis.__app = { App, S };');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    document: {
      getElementById: () => ({ checked: false, value: '', classList: { add: () => {}, remove: () => {} } }),
      documentElement: { setAttribute: () => {}, removeAttribute: () => {} },
      body: { classList: { add: () => {}, remove: () => {} } }
    },
    confirm: () => true,
    prompt: () => '',
    setTimeout,
    clearTimeout,
    console
  };

  const noOp = () => {};
  [
    'createCommandBus', 'createQueryService', 'registerAppCommands', 'registerAppReadModel',
    'walkTasks', 'SKIP_CHILDREN', 'todayS', 'tomorrowS', 'cmpDate', 'esc', 'DB', 'seedData',
    'dateStr', 'now', 'renderCurrentPageUi', 'renderHomeUi', 'renderListUi', 'renderDueUi',
    'renderReportUi', 'renderKanbanUi', 'renderTagsUi', 'openListUi', 'bindGlobalUi',
    'runAppSmokeChecks', 'openSettingsUi', 'syncSettingsUi', 'setSettingDomain',
    'setDarkModeUi', 'setZenModeUi', 'setListStyleUi', 'closeOverlay', 'openOverlay',
    'closeAllOverlays', 'clearSearchUi', 'syncStatusBarUi', 'showToastUi', 'moveUpDomain',
    'moveDownDomain', 'indentDomain', 'unindentDomain', 'addTaskDomain', 'addAboveDomain',
    'deleteTaskDomain', 'saveEditDomain', 'toggleStatusDomain', 'advanceRecurringTaskDomain',
    'invalidateDomain', 'checkAutoCloseDomain', 'toggleCollapseDomain', 'sibListDomain',
    'moveBeforeDomain', 'extractBranchUi', 'extractBranchDomainUi', 'confirmListDomain',
    'archiveListDomain', 'unarchiveListDomain', 'deleteListDomain', 'jumpToUi', 'runAppSmokeChecks',
    'syncFromGistRemote', 'syncToGistRemote', 'syncGistBidirectionalRemote', 'checkGistOnRefreshRemote',
    'startGistAutoSyncRemote', 'openCommandPalette', 'closeCommandPalette', 'updateCommandPalette',
    'renderCommandPaletteItems', 'executeCommandPaletteItem', 'openOverlay', 'closeOverlay',
    'closeAllOverlays', 'clearSearchUi', 'syncStatusBarUi', 'showToastUi', 'openSettingsUi',
    'syncSettingsUi', 'setSettingDomain', 'setDarkModeUi', 'setZenModeUi', 'setListStyleUi'
  ].forEach((name) => { sandbox[name] = sandbox[name] || noOp; });

  sandbox.DB = { get: () => null, save: noOp };
  sandbox.seedData = () => ({
    currentListId: 'l1',
    lists: { l1: { id: 'l1', root_tasks: ['a', 'b', 'c'] } },
    tasks: {
      a: { id: 'a', checklist_id: 'l1', parent_id: '', deleted: false, tasks: [], _collapsed: false },
      b: { id: 'b', checklist_id: 'l1', parent_id: '', deleted: false, tasks: [], _collapsed: false },
      c: { id: 'c', checklist_id: 'l1', parent_id: '', deleted: false, tasks: [], _collapsed: false }
    },
    settings: {}
  });
  sandbox.todayS = () => '2026-07-10';
  sandbox.tomorrowS = () => '2026-07-11';
  sandbox.cmpDate = () => 0;
  sandbox.now = () => '2026-07-10T00:00:00.000Z';
  sandbox.renderCurrentPageUi = noOp;
  sandbox.renderListUi = noOp;
  sandbox.renderHomeUi = noOp;
  sandbox.renderDueUi = noOp;
  sandbox.renderReportUi = noOp;
  sandbox.renderKanbanUi = noOp;
  sandbox.renderTagsUi = noOp;
  sandbox.openListUi = noOp;
  sandbox.bindGlobalUi = noOp;
  sandbox.addTaskDomain = noOp;
  sandbox.addAboveDomain = noOp;
  sandbox.deleteTaskDomain = noOp;
  sandbox.saveEditDomain = noOp;
  sandbox.toggleStatusDomain = noOp;
  sandbox.advanceRecurringTaskDomain = noOp;
  sandbox.invalidateDomain = noOp;
  sandbox.checkAutoCloseDomain = noOp;
  sandbox.toggleCollapseDomain = noOp;
  sandbox.moveUpDomain = noOp;
  sandbox.moveDownDomain = noOp;
  sandbox.indentDomain = noOp;
  sandbox.unindentDomain = noOp;
  sandbox.moveBeforeDomain = noOp;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'app.js' });
  return { ...sandbox.__app, sandbox };
}

test('moveUpSelection preserves multi-select after batch move', () => {
  const { App, S, sandbox } = loadApp();
  const calls = { moveUp: [], save: 0, renderList: 0, toast: '' };

  S.msel = new Set(['a', 'b', 'c']);
  S.selId = 'a';

  App.selectedRootIds = () => ['a', 'b', 'c'];
  App.withUndoBatch = (fn) => fn();
  sandbox.moveUpDomain = (app, state, id) => { calls.moveUp.push(id); };
  App.save = () => { calls.save += 1; };
  App.renderList = () => { calls.renderList += 1; };
  App.toast = (msg) => { calls.toast = msg; };

  App.moveUpSelection();

  assert.deepEqual(calls.moveUp, ['a', 'b', 'c']);
  assert.deepEqual(Array.from(S.msel), ['a', 'b', 'c']);
  assert.equal(calls.save, 1);
  assert.equal(calls.renderList, 1);
  assert.equal(calls.toast, 'Moved up 3 task(s)');
});

test('indentSelection applies multi-select top-down to preserve sibling order', () => {
  const { App, S, sandbox } = loadApp();
  const calls = { indent: [], save: 0, renderList: 0, toast: '' };

  S.msel = new Set(['a', 'b', 'c']);
  S.selId = 'a';

  App.selectedRootIds = () => ['a', 'b', 'c'];
  App.withUndoBatch = (fn) => fn();
  sandbox.indentDomain = (app, state, id) => { calls.indent.push(id); };
  App.save = () => { calls.save += 1; };
  App.renderList = () => { calls.renderList += 1; };
  App.toast = (msg) => { calls.toast = msg; };

  App.indentSelection();

  assert.deepEqual(calls.indent, ['a', 'b', 'c']);
  assert.deepEqual(Array.from(S.msel), ['a', 'b', 'c']);
  assert.equal(calls.save, 1);
  assert.equal(calls.renderList, 1);
  assert.equal(calls.toast, 'Indented 3 task(s)');
});

test('unindentSelection applies multi-select bottom-up to preserve order', () => {
  const { App, S, sandbox } = loadApp();
  const calls = { unindent: [], save: 0, renderList: 0, toast: '' };

  S.msel = new Set(['a', 'b', 'c']);
  S.selId = 'a';

  App.selectedRootIds = () => ['a', 'b', 'c'];
  App.withUndoBatch = (fn) => fn();
  sandbox.unindentDomain = (app, state, id) => { calls.unindent.push(id); };
  App.save = () => { calls.save += 1; };
  App.renderList = () => { calls.renderList += 1; };
  App.toast = (msg) => { calls.toast = msg; };

  App.unindentSelection();

  assert.deepEqual(calls.unindent, ['c', 'b', 'a']);
  assert.deepEqual(Array.from(S.msel), ['a', 'b', 'c']);
  assert.equal(calls.save, 1);
  assert.equal(calls.renderList, 1);
  assert.equal(calls.toast, 'Un-indented 3 task(s)');
});

test('unindent then indent does not chain into hierarchy order', () => {
  const { App, S, sandbox } = loadApp();
  const calls = { unindent: [], indent: [] };

  S.msel = new Set(['a', 'b', 'c']);
  S.selId = 'a';

  App.selectedRootIds = () => ['a', 'b', 'c'];
  App.withUndoBatch = (fn) => fn();
  App.save = () => {};
  App.renderList = () => {};
  App.toast = () => {};

  sandbox.unindentDomain = (app, state, id) => { calls.unindent.push(id); };
  sandbox.indentDomain = (app, state, id) => { calls.indent.push(id); };

  App.unindentSelection();
  App.indentSelection();

  assert.deepEqual(calls.unindent, ['c', 'b', 'a']);
  assert.deepEqual(calls.indent, ['a', 'b', 'c']);
});