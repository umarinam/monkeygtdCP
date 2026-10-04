const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Objects built inside the vm sandbox have a different Object prototype, so
// compare their plain-data shape.
const plain = value => JSON.parse(JSON.stringify(value));

function read(rel) {
  return fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
}

function loadScripts(files, exportNames, globals = {}) {
  const sandbox = { console, JSON, Math, Date, setTimeout, clearTimeout, ...globals };
  vm.createContext(sandbox);
  for (const rel of files) vm.runInContext(read(rel), sandbox, { filename: rel });
  vm.runInContext(`globalThis.__exports = { ${exportNames.join(', ')} };`, sandbox);
  return sandbox.__exports;
}

function loadTemplateDomain() {
  return loadScripts(
    ['js/core/utils.js', 'js/domain/template-ops.js'],
    ['mkTask', 'templateNameDomain', 'listTemplatesDomain', 'markTemplateDomain', 'unmarkTemplateDomain', 'applyTemplateDomain']
  );
}

function makeApp() {
  const calls = { pushUndo: 0, save: 0 };
  return {
    calls,
    snap: () => ({}),
    pushUndo: () => { calls.pushUndo += 1; },
    save: () => { calls.save += 1; }
  };
}

// Template "tpl" (list l1) holds: c1 (done, with grandchild g1), c2 (invalidated,
// itself marked as a template), c3 (deleted). "target" lives in list l2.
function makeState(ctx) {
  const t = o => ctx.mkTask({ checklist_id: 'l1', ...o });
  const tasks = {
    tpl: t({ id: 'tpl', content: 'Release checklist', is_template: true, template_name: '', tasks: ['c1', 'c2', 'c3'] }),
    c1: t({ id: 'c1', content: 'Run tests', parent_id: 'tpl', status: 1, completed_at: '2026-01-01T00:00:00.000Z', color: 3, tags: { qa: { isPrivate: false } }, tags_as_text: 'qa', tasks: ['g1'], history: [{ at: 'x', type: 'title', changes: {} }] }),
    g1: t({ id: 'g1', content: 'Unit tests', parent_id: 'c1', overdue_ack_due: '2026-01-01' }),
    c2: t({ id: 'c2', content: 'Tag release', parent_id: 'tpl', status: 2, is_template: true, template_name: 'Tagging' }),
    c3: t({ id: 'c3', content: 'Old step', parent_id: 'tpl', deleted: true }),
    target: ctx.mkTask({ id: 'target', content: 'Ship v2', checklist_id: 'l2', tasks: ['existing'], _collapsed: true }),
    existing: ctx.mkTask({ id: 'existing', content: 'Existing child', checklist_id: 'l2', parent_id: 'target' })
  };
  return {
    listId: 'l2',
    selId: 'target',
    msel: new Set(),
    data: {
      settings: {},
      tasks,
      lists: {
        l1: { id: 'l1', name: 'Templates', root_tasks: ['tpl'] },
        l2: { id: 'l2', name: 'Work', root_tasks: ['target'] }
      }
    }
  };
}

test('templateNameDomain uses the custom name, falling back to the task content', () => {
  const ctx = loadTemplateDomain();
  assert.equal(ctx.templateNameDomain({ content: 'Weekly review', template_name: 'Review' }), 'Review');
  assert.equal(ctx.templateNameDomain({ content: 'Weekly review', template_name: '  ' }), 'Weekly review');
  assert.equal(ctx.templateNameDomain({ content: '' }), 'Untitled template');
});

test('markTemplateDomain flags the task, keeps a blank name dynamic, and logs history', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();
  const task = state.data.tasks.target;

  assert.equal(ctx.markTemplateDomain(app, state, 'target', '   '), true);
  assert.equal(task.is_template, true);
  assert.equal(task.template_name, '');
  assert.equal(ctx.templateNameDomain(task), 'Ship v2');
  task.content = 'Ship v3';
  assert.equal(ctx.templateNameDomain(task), 'Ship v3');
  assert.deepEqual(plain(task.history.at(-1).changes), { from: '', to: 'Ship v2' });
  assert.equal(app.calls.pushUndo, 1);
  assert.equal(app.calls.save, 1);

  ctx.markTemplateDomain(app, state, 'target', ' Shipping ');
  assert.equal(task.template_name, 'Shipping');
  assert.deepEqual(plain(task.history.at(-1).changes), { from: 'Ship v3', to: 'Shipping' });
});

test('markTemplateDomain ignores missing and deleted tasks', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();
  assert.equal(ctx.markTemplateDomain(app, state, 'nope', 'x'), false);
  assert.equal(ctx.markTemplateDomain(app, state, 'c3', 'x'), false);
  assert.equal(state.data.tasks.c3.is_template, undefined);
  assert.equal(app.calls.pushUndo, 0);
});

test('unmarkTemplateDomain removes the template fields and logs history', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();
  const tpl = state.data.tasks.tpl;

  assert.equal(ctx.unmarkTemplateDomain(app, state, 'tpl'), true);
  assert.equal('is_template' in tpl, false);
  assert.equal('template_name' in tpl, false);
  assert.deepEqual(plain(tpl.history.at(-1)), { at: tpl.history.at(-1).at, type: 'template', changes: { from: 'Release checklist', to: '' } });
  assert.equal(app.calls.pushUndo, 1);

  assert.equal(ctx.unmarkTemplateDomain(app, state, 'tpl'), false);
  assert.equal(app.calls.pushUndo, 1);
});

test('listTemplatesDomain lists live templates sorted by name with sub-task counts', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  state.data.tasks.gone = ctx.mkTask({ id: 'gone', checklist_id: 'l1', is_template: true, deleted: true });
  state.data.tasks.orphan = ctx.mkTask({ id: 'orphan', checklist_id: 'deleted-list', is_template: true });

  const templates = ctx.listTemplatesDomain(state);

  assert.deepEqual(plain(templates), [
    { id: 'tpl', name: 'Release checklist', listName: 'Templates', count: 3 },
    { id: 'c2', name: 'Tagging', listName: 'Templates', count: 0 }
  ]);
});

test('applyTemplateDomain copies the template sub-tree under the target as fresh open tasks', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();
  const before = JSON.stringify(['tpl', 'c1', 'g1', 'c2', 'c3'].map(id => state.data.tasks[id]));

  const result = ctx.applyTemplateDomain(app, state, 'tpl', ['target']);

  assert.deepEqual(plain(result), { applied: 1, created: 3 });
  assert.equal(app.calls.pushUndo, 1);
  assert.equal(app.calls.save, 1);

  const target = state.data.tasks.target;
  assert.equal(target._collapsed, false);
  assert.equal(target.tasks.length, 3);
  assert.equal(target.tasks[0], 'existing');

  const [runTests, tagRelease] = target.tasks.slice(1).map(id => state.data.tasks[id]);
  assert.equal(runTests.content, 'Run tests');
  assert.equal(tagRelease.content, 'Tag release');
  for (const copy of [runTests, tagRelease]) {
    assert.equal(copy.parent_id, 'target');
    assert.equal(copy.checklist_id, 'l2');
    assert.equal(copy.status, 0);
    assert.equal(copy.completed_at, '');
    assert.equal('is_template' in copy, false);
    assert.equal('template_name' in copy, false);
    assert.equal(copy.history.length, 1);
    assert.equal(copy.history[0].type, 'creation');
    assert.equal(copy.history[0].changes.source, 'template');
    assert.equal(copy.history[0].changes.templateId, 'tpl');
  }
  assert.equal(runTests.color, 3);
  assert.equal(runTests.tags_as_text, 'qa');

  assert.equal(runTests.tasks.length, 1);
  const unitTests = state.data.tasks[runTests.tasks[0]];
  assert.equal(unitTests.content, 'Unit tests');
  assert.equal(unitTests.parent_id, runTests.id);
  assert.equal(unitTests.checklist_id, 'l2');
  assert.equal('overdue_ack_due' in unitTests, false);

  const newIds = [runTests.id, tagRelease.id, unitTests.id];
  assert.equal(newIds.some(id => ['tpl', 'c1', 'g1', 'c2', 'c3'].includes(id)), false);
  assert.equal(Object.values(state.data.tasks).some(t => t.content === 'Old step' && !t.deleted), false);
  assert.equal(JSON.stringify(['tpl', 'c1', 'g1', 'c2', 'c3'].map(id => state.data.tasks[id])), before);
});

test('applyTemplateDomain applied to the template itself copies its branch exactly once', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();

  const result = ctx.applyTemplateDomain(app, state, 'tpl', ['tpl', 'target']);

  assert.deepEqual(plain(result), { applied: 2, created: 6 });
  assert.equal(app.calls.pushUndo, 1);
  const tpl = state.data.tasks.tpl;
  assert.equal(tpl.tasks.length, 5);
  assert.deepEqual(plain(tpl.tasks.slice(3).map(id => state.data.tasks[id].content)), ['Run tests', 'Tag release']);
  assert.deepEqual(plain(state.data.tasks.target.tasks.slice(1).map(id => state.data.tasks[id].content)), ['Run tests', 'Tag release']);
});

test('applyTemplateDomain is a no-op for empty templates, non-templates, and missing targets', () => {
  const ctx = loadTemplateDomain();
  const state = makeState(ctx);
  const app = makeApp();

  assert.deepEqual(plain(ctx.applyTemplateDomain(app, state, 'c2', ['target'])), { applied: 0, created: 0 });
  assert.deepEqual(plain(ctx.applyTemplateDomain(app, state, 'c1', ['target'])), { applied: 0, created: 0 });
  assert.deepEqual(plain(ctx.applyTemplateDomain(app, state, 'tpl', ['nope', 'c3'])), { applied: 0, created: 0 });
  assert.equal(app.calls.pushUndo, 0);
  assert.equal(app.calls.save, 0);
  assert.deepEqual(plain(state.data.tasks.target.tasks), ['existing']);
});

function loadTemplateUi(promptAnswer) {
  return loadScripts(
    ['js/core/utils.js', 'js/domain/template-ops.js', 'js/ui/template-controller.js'],
    ['mkTask', 'toggleTemplateSelectionUi', 'renameTemplateSelectionUi', 'openTemplatePickerUi', 'applyTemplateSelectionUi'],
    { prompt: () => promptAnswer }
  );
}

function makeUiApp(overrides = {}) {
  const calls = [];
  return {
    calls,
    dispatch: (name, payload) => { calls.push(['dispatch', name, plain(payload)]); return overrides.dispatchResult; },
    select: name => { calls.push(['select', name]); return overrides.templates || []; },
    selectedIds: () => overrides.selectedIds || [],
    openCP: mode => calls.push(['openCP', mode]),
    render: () => calls.push(['render']),
    toast: msg => calls.push(['toast', msg])
  };
}

test('toggleTemplateSelectionUi marks the selected task with the prompted name', () => {
  const ctx = loadTemplateUi('Packing');
  const state = makeState(ctx);
  const app = makeUiApp();

  ctx.toggleTemplateSelectionUi(app, state);

  assert.deepEqual(app.calls[0], ['dispatch', 'task.markTemplate', { id: 'target', name: 'Packing' }]);
  assert.equal(app.calls.some(c => c[0] === 'render'), true);
});

test('toggleTemplateSelectionUi does nothing when the name prompt is cancelled', () => {
  const ctx = loadTemplateUi(null);
  const state = makeState(ctx);
  const app = makeUiApp();

  ctx.toggleTemplateSelectionUi(app, state);

  assert.deepEqual(app.calls, []);
});

test('toggleTemplateSelectionUi unmarks a template without prompting', () => {
  const ctx = loadTemplateUi('should not be used');
  const state = makeState(ctx);
  state.selId = 'tpl';
  const app = makeUiApp();

  ctx.toggleTemplateSelectionUi(app, state);

  assert.deepEqual(app.calls[0], ['dispatch', 'task.unmarkTemplate', { id: 'tpl' }]);
  assert.equal(app.calls.some(c => c[0] === 'toast' && c[1].includes('no longer a template')), true);
});

test('toggleTemplateSelectionUi asks for a selection when none exists', () => {
  const ctx = loadTemplateUi('x');
  const state = makeState(ctx);
  state.selId = null;
  const app = makeUiApp();

  ctx.toggleTemplateSelectionUi(app, state);

  assert.deepEqual(app.calls, [['toast', 'Select a task to mark as a template']]);
});

test('renameTemplateSelectionUi re-dispatches markTemplate only for templates with a changed name', () => {
  const ctx = loadTemplateUi('Tag it');
  const state = makeState(ctx);
  const app = makeUiApp();

  state.selId = 'c2';
  ctx.renameTemplateSelectionUi(app, state);
  assert.deepEqual(app.calls[0], ['dispatch', 'task.markTemplate', { id: 'c2', name: 'Tag it' }]);

  const unchanged = loadTemplateUi('Tagging');
  const app2 = makeUiApp();
  unchanged.renameTemplateSelectionUi(app2, { ...state, data: state.data });
  assert.equal(app2.calls.some(c => c[0] === 'dispatch'), false);

  const app3 = makeUiApp();
  state.selId = 'target';
  ctx.renameTemplateSelectionUi(app3, state);
  assert.deepEqual(app3.calls, [['toast', 'Select a template to rename']]);
});

test('openTemplatePickerUi opens the palette in templates mode when templates exist', () => {
  const ctx = loadTemplateUi('');
  const state = makeState(ctx);
  const app = makeUiApp({ selectedIds: ['target'], templates: [{ id: 'tpl' }] });

  ctx.openTemplatePickerUi(app, state);

  assert.deepEqual(app.calls.at(-1), ['openCP', 'templates']);
});

test('openTemplatePickerUi explains how to create a template when none exist', () => {
  const ctx = loadTemplateUi('');
  const state = makeState(ctx);
  const app = makeUiApp({ selectedIds: ['target'], templates: [] });

  ctx.openTemplatePickerUi(app, state);

  assert.equal(app.calls.some(c => c[0] === 'openCP'), false);
  assert.equal(app.calls.some(c => c[0] === 'toast' && c[1].includes('press mt')), true);
});

test('openTemplatePickerUi needs a selected task', () => {
  const ctx = loadTemplateUi('');
  const state = makeState(ctx);
  const app = makeUiApp({ selectedIds: [], templates: [{ id: 'tpl' }] });

  ctx.openTemplatePickerUi(app, state);

  assert.deepEqual(app.calls, [['toast', 'Select a task to apply a template to']]);
});

test('applyTemplateSelectionUi applies the template to every selected task', () => {
  const ctx = loadTemplateUi('');
  const state = makeState(ctx);
  const app = makeUiApp({ selectedIds: ['target', 'existing'], dispatchResult: { applied: 2, created: 6 } });

  ctx.applyTemplateSelectionUi(app, state, 'tpl');

  assert.deepEqual(app.calls[0], ['dispatch', 'task.applyTemplate', { templateId: 'tpl', targetIds: ['target', 'existing'] }]);
  assert.equal(app.calls.some(c => c[0] === 'render'), true);
  assert.deepEqual(app.calls.at(-1), ['toast', 'Applied "Release checklist" to 2 tasks (6 tasks added)']);
});

test('applyTemplateSelectionUi reports an empty template instead of rendering', () => {
  const ctx = loadTemplateUi('');
  const state = makeState(ctx);
  const app = makeUiApp({ selectedIds: ['target'], dispatchResult: { applied: 0, created: 0 } });

  ctx.applyTemplateSelectionUi(app, state, 'c2');

  assert.equal(app.calls.some(c => c[0] === 'render'), false);
  assert.deepEqual(app.calls.at(-1), ['toast', 'Template "Tagging" has no sub-tasks to add']);
});

function makeFakeDocument() {
  const nodes = {
    cpi: { value: '', placeholder: 'Type a command or search', dataset: {}, focus: () => {} },
    cpr: { innerHTML: '' }
  };
  return { nodes, document: { getElementById: id => nodes[id], querySelectorAll: () => [] } };
}

test('command palette templates mode lists only templates and applies the picked one', () => {
  const { nodes, document } = makeFakeDocument();
  const ctx = loadScripts(
    ['js/core/utils.js', 'js/ui/command-palette-commands.js', 'js/ui/command-palette-controller.js'],
    ['openCommandPalette', 'updateCommandPalette', 'executeCommandPaletteItem'],
    { document, setTimeout: fn => fn() }
  );
  const applied = [];
  const state = { cpMode: '', cpIdx: 0, cpItems: [] };
  const app = {
    openModal: () => {},
    closeCP: () => {},
    updateCP: () => ctx.updateCommandPalette(app, state),
    select: name => {
      if (name === 'templates.all') return [
        { id: 'tpl', name: 'Release checklist', listName: 'Templates', count: 3 },
        { id: 'one', name: 'Solo', listName: '', count: 1 }
      ];
      throw new Error(`unexpected query ${name}`);
    },
    applyTemplate: id => applied.push(id)
  };

  ctx.openCommandPalette(app, state, 'templates');

  assert.equal(state.cpMode, 'templates');
  assert.equal(nodes.cpi.placeholder, 'Pick a template to apply...');
  assert.deepEqual(state.cpItems.map(c => c.l), ['Release checklist', 'Solo']);
  assert.deepEqual(state.cpItems.map(c => c.s), ['3 tasks · Templates', '1 task']);
  assert.equal(nodes.cpr.innerHTML.includes('Release checklist'), true);

  nodes.cpi.value = 'solo';
  ctx.updateCommandPalette(app, state);
  assert.deepEqual(state.cpItems.map(c => c.l), ['Solo']);
  ctx.executeCommandPaletteItem(app, state, 0);
  assert.deepEqual(applied, ['one']);

  nodes.cpi.value = 'zzz';
  ctx.updateCommandPalette(app, state);
  assert.equal(nodes.cpr.innerHTML.includes('No templates found'), true);
});

test('command palette restores its default placeholder outside templates mode', () => {
  const { nodes, document } = makeFakeDocument();
  const ctx = loadScripts(
    ['js/core/utils.js', 'js/ui/command-palette-commands.js', 'js/ui/command-palette-controller.js'],
    ['openCommandPalette'],
    { document, setTimeout: fn => fn() }
  );
  const state = { cpMode: '', cpIdx: 0, cpItems: [] };
  const app = { openModal: () => {}, updateCP: () => {} };

  ctx.openCommandPalette(app, state, 'templates');
  ctx.openCommandPalette(app, state, 'lists');

  assert.equal(nodes.cpi.placeholder, 'Type a command or search');
});

test('mt and at two-key shortcuts trigger the template actions', () => {
  const { handleTwoKeySequence } = loadScripts(
    ['js/ui/keyboard-controller.js'],
    ['handleTwoKeySequence'],
    { document: { getElementById: () => ({ classList: { contains: () => true } }) } }
  );
  const calls = [];
  const app = {
    showKH: () => {},
    clearKH: () => {},
    toggleTemplateSelection: () => calls.push('mt'),
    openTemplatePicker: () => calls.push('at')
  };
  const state = { selId: 'target', kbuf: '', kbtimer: null, msel: new Set(), data: { settings: {} } };
  const press = key => handleTwoKeySequence(app, state, { key, ctrlKey: false, altKey: false, metaKey: false, preventDefault: () => {} });

  press('m'); press('t');
  press('a'); press('t');

  assert.deepEqual(calls, ['mt', 'at']);
});

test('template actions are discoverable in the command palette and shortcuts help', () => {
  const palette = read('js/ui/command-palette-commands.js');
  assert.equal(palette.includes("{ l: 'Mark/unmark as template', s: 'mt'"), true);
  assert.equal(palette.includes("{ l: 'Apply template...', s: 'at'"), true);
  assert.equal(palette.includes("{ l: 'Rename template...'"), true);

  const help = read('js/ui/utilities-controller.js');
  assert.equal(help.includes("['mt', 'Mark / unmark task as template']"), true);
  assert.equal(help.includes("['at', 'Apply template to selected task(s)']"), true);
});

test('buildTaskItemUi shows a clickable template chip only on template tasks', () => {
  const { buildTaskItemUi } = loadScripts(
    ['js/ui/render-controller.js'],
    ['buildTaskItemUi'],
    { md: s => s, esc: s => String(s), getDueCls: () => '', fmtDue: () => '' }
  );
  const task = o => ({ status: 0, color: 0, tasks: [], tags_as_text: '', assignees: [], comments_count: 0, due: '', due_asap: false, repeating_due: null, created_at: '', updated_at: '', ...o });
  const state = {
    data: {
      settings: {},
      tasks: {
        plain: task({ id: 'plain', content: 'Plain' }),
        unnamed: task({ id: 'unnamed', content: 'Weekly review', is_template: true, template_name: '' }),
        named: task({ id: 'named', content: 'Weekly review', is_template: true, template_name: 'Review' })
      },
      lists: { l1: { id: 'l1', style: 'none', root_tasks: ['plain', 'unnamed', 'named'] } }
    },
    selId: null, msel: new Set(), editId: null, filter: '', showNotes: false
  };
  const render = id => buildTaskItemUi({ sibIdx: () => 1 }, state, id, 0, state.data.lists.l1);

  assert.equal(render('plain').includes('data-a="tpl"'), false);
  assert.match(render('unnamed'), /class="ttpl" data-id="unnamed" data-a="tpl"[^>]*>📋 template<\/span>/);
  assert.match(render('named'), /data-a="tpl"[^>]*>📋 template: Review<\/span>/);
});

test('task history describes template changes', () => {
  const { formatHistoryTypeLabel, formatHistorySummary } = loadScripts(
    ['js/ui/modal-controller.js'],
    ['formatHistoryTypeLabel', 'formatHistorySummary']
  );
  assert.equal(formatHistoryTypeLabel('template'), 'Template');
  assert.equal(formatHistorySummary('template', { from: '', to: 'Review' }), 'Template: (not a template) -> "Review"');
  assert.equal(formatHistorySummary('template', { from: 'Review', to: '' }), 'Template: "Review" -> (not a template)');
});
