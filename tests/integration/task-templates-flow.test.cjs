const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Boots the real App/S from js/app.js on top of the real core, domain,
// application and palette/template UI scripts, with only rendering, storage and
// toasts stubbed, so the template flow runs through the actual CQRS wiring.
const SCRIPTS = [
  'js/core/cqrs.js',
  'js/core/traversal.js',
  'js/core/utils.js',
  'js/domain/template-ops.js',
  'js/domain/queries.js',
  'js/application/command-registry.js',
  'js/application/query-registry.js',
  'js/ui/command-palette-commands.js',
  'js/ui/command-palette-controller.js',
  'js/ui/template-controller.js'
];

function bootApp(promptAnswers) {
  const nodes = {
    cpi: { value: '', placeholder: 'Type a command or search', dataset: {}, focus: () => {} },
    cpr: { innerHTML: '' }
  };
  const toasts = [];
  const answers = [...promptAnswers];
  const noOp = () => {};
  const sandbox = {
    console, JSON, Math, Date,
    setTimeout: fn => fn(),
    clearTimeout: noOp,
    prompt: () => answers.shift(),
    document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    DB: { get: () => null, save: noOp },
    renderCurrentPageUi: noOp,
    renderListUi: noOp,
    openOverlay: noOp,
    closeOverlay: noOp,
    showToastUi: (app, msg) => toasts.push(msg)
  };
  vm.createContext(sandbox);

  // Script order must match app.html: every file wired there must exist.
  const html = fs.readFileSync(path.join(process.cwd(), 'app.html'), 'utf8');
  const wired = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
  const positions = SCRIPTS.map(rel => wired.indexOf(rel));
  assert.equal(positions.includes(-1), false, `scripts missing from app.html: ${SCRIPTS.filter((_, i) => positions[i] < 0)}`);
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'scripts are loaded out of dependency order in app.html');

  for (const rel of SCRIPTS) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), sandbox, { filename: rel });
  }
  const appSource = fs.readFileSync(path.join(process.cwd(), 'js/app.js'), 'utf8')
    .replace(/App\.init\(\);\s*$/, 'globalThis.__app = { App, S };');
  vm.runInContext(appSource, sandbox, { filename: 'js/app.js' });

  const { App, S } = sandbox.__app;
  const mkTask = vm.runInContext('mkTask', sandbox);
  const task = o => mkTask({ checklist_id: 'l1', ...o });
  S.data = {
    settings: { showCompleted: true },
    tasks: {
      review: task({ id: 'review', content: 'Weekly review', tasks: ['inbox', 'calendar'] }),
      inbox: task({ id: 'inbox', content: 'Empty inbox', parent_id: 'review', status: 1 }),
      calendar: task({ id: 'calendar', content: 'Check calendar', parent_id: 'review' }),
      week41: task({ id: 'week41', content: 'Week 41' })
    },
    lists: { l1: { id: 'l1', name: 'Home', root_tasks: ['review', 'week41'] } }
  };
  S.listId = 'l1';
  App.initCqrs();
  return { App, S, nodes, toasts };
}

// Array.from builds host-realm arrays so deepEqual can compare them.
const contents = (S, ids) => Array.from(ids, id => S.data.tasks[id].content);

test('mark a task as a template, pick it with the template picker, apply it, then undo', () => {
  const { App, S, nodes, toasts } = bootApp(['Review']);

  S.selId = 'review';
  App.toggleTemplateSelection();
  assert.equal(S.data.tasks.review.is_template, true);
  assert.equal(S.data.tasks.review.template_name, 'Review');

  S.selId = 'week41';
  App.openTemplatePicker();
  assert.equal(S.cpMode, 'templates');
  assert.equal(S.cpItems.length, 1);
  assert.equal(nodes.cpr.innerHTML.includes('Review'), true);
  assert.equal(nodes.cpr.innerHTML.includes('2 tasks · Home'), true);

  App.execCP(0);

  const week41 = S.data.tasks.week41;
  assert.deepEqual(contents(S, week41.tasks), ['Empty inbox', 'Check calendar']);
  assert.deepEqual(Array.from(week41.tasks, id => S.data.tasks[id].status), [0, 0]);
  assert.deepEqual(contents(S, S.data.tasks.review.tasks), ['Empty inbox', 'Check calendar']);
  assert.equal(toasts.at(-1), 'Applied "Review" (2 tasks added)');

  App.undo();
  assert.equal(S.data.tasks.week41.tasks.length, 0);
  assert.equal(S.data.tasks.review.is_template, true);

  S.selId = 'review';
  App.toggleTemplateSelection();
  assert.equal('is_template' in S.data.tasks.review, false);
  S.selId = 'week41';
  App.openTemplatePicker();
  assert.equal(toasts.at(-1), 'No templates yet - select a task with sub-tasks and press mt');
});

test('applying a template to a multi-selection is one undo step', () => {
  const { App, S } = bootApp(['']);

  S.selId = 'review';
  App.toggleTemplateSelection();
  assert.deepEqual(Array.from(App.select('templates.all'), t => t.name), ['Weekly review']);

  const undoDepth = S.undos.length;
  S.selId = 'week41';
  S.msel = new Set(['week41', 'review']);
  App.applyTemplate('review');

  assert.deepEqual(contents(S, S.data.tasks.week41.tasks), ['Empty inbox', 'Check calendar']);
  assert.deepEqual(contents(S, S.data.tasks.review.tasks), ['Empty inbox', 'Check calendar', 'Empty inbox', 'Check calendar']);
  assert.equal(S.undos.length, undoDepth + 1);

  App.undo();
  assert.equal(S.data.tasks.week41.tasks.length, 0);
  assert.equal(S.data.tasks.review.tasks.length, 2);
});
