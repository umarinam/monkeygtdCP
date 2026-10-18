const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadContext() {
  const sandbox = { console, JSON, Math, Date };
  vm.createContext(sandbox);
  for (const rel of ['js/core/utils.js', 'js/core/traversal.js', 'js/domain/import-export.js']) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), sandbox, { filename: rel });
  }
  vm.runInContext(
    'globalThis.__exports = { mkTask, walkTasks, SKIP_CHILDREN, importTextDomain, exportMarkdownDomain, exportTextDomain };',
    sandbox
  );
  return sandbox.__exports;
}

function importText(ctx, text) {
  const state = { data: { tasks: {}, lists: {} } };
  const list = { id: 'l1', root_tasks: [] };
  let n = 0;
  const ids = ctx.importTextDomain(state, text, list, () => `t${++n}`, ctx.mkTask);
  return { state, ids };
}

// The imported tree as plain objects (built in this realm so deepEqual works), checking parent links.
function outline(state, ids, parentId = '') {
  return Array.from(ids, id => {
    const t = state.data.tasks[id];
    assert.equal(t.parent_id, parentId, `parent of "${t.content}"`);
    const node = { content: t.content };
    if (t.status) node.status = t.status;
    if (t.notes.length) node.notes = Array.from(t.notes, note => note.content);
    if (t.tasks.length) node.children = outline(state, t.tasks, t.id);
    return node;
  });
}

function sampleState(ctx) {
  const note = { id: 'n1', author: 'me', content: 'remember the docs', created_at: '', updated_at: '' };
  const tasks = {
    p: ctx.mkTask({ id: 'p', content: 'Project', tasks: ['m'] }),
    m: ctx.mkTask({ id: 'm', content: 'Milestone', parent_id: 'p', tasks: ['a', 'b'] }),
    a: ctx.mkTask({ id: 'a', content: 'Write spec', parent_id: 'm', status: 1, tasks: ['s'], notes: [note], comments_count: 1 }),
    s: ctx.mkTask({ id: 's', content: 'Old approach', parent_id: 'a', status: 2, tasks: ['d'] }),
    d: ctx.mkTask({ id: 'd', content: 'Deep detail', parent_id: 's' }),
    b: ctx.mkTask({ id: 'b', content: 'Ship it #release', parent_id: 'm' }),
    q: ctx.mkTask({ id: 'q', content: 'Second project' })
  };
  return { data: { tasks, lists: {} } };
}

const SAMPLE_OUTLINE = [
  {
    content: 'Project',
    children: [{
      content: 'Milestone',
      children: [
        {
          content: 'Write spec',
          status: 1,
          notes: ['remember the docs'],
          children: [{ content: 'Old approach', status: 2, children: [{ content: 'Deep detail' }] }]
        },
        { content: 'Ship it #release' }
      ]
    }]
  },
  { content: 'Second project' }
];

test('nested bullets lose their marker at every depth', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    '- Parent',
    '  - Child',
    '    - Grandchild',
    '  - Second child'
  ].join('\n'));

  assert.deepEqual(outline(state, ids), [{
    content: 'Parent',
    children: [
      { content: 'Child', children: [{ content: 'Grandchild' }] },
      { content: 'Second child' }
    ]
  }]);
});

test('checkbox and strike-through markers set the status', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    '- [x] Shipped',
    '- [X] Also shipped',
    '- [ ] Still open',
    '- [~] Dropped',
    '- ~~Struck out~~',
    '[x] No bullet',
    '- [] Checkbox list style'
  ].join('\n'));

  assert.deepEqual(outline(state, ids), [
    { content: 'Shipped', status: 1 },
    { content: 'Also shipped', status: 1 },
    { content: 'Still open' },
    { content: 'Dropped', status: 2 },
    { content: 'Struck out', status: 2 },
    { content: 'No bullet', status: 1 },
    { content: '[] Checkbox list style' }
  ]);
});

test('quote lines become notes on the item above, not items', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    '- Task one',
    '  > first note',
    '  > second note',
    '- Task two',
    '    - Child',
    '      > child note'
  ].join('\n'));

  assert.deepEqual(outline(state, ids), [
    { content: 'Task one', notes: ['first note', 'second note'] },
    { content: 'Task two', children: [{ content: 'Child', notes: ['child note'] }] }
  ]);
  assert.equal(Object.keys(state.data.tasks).length, 3);

  const first = state.data.tasks[ids[0]];
  assert.equal(first.comments_count, 2);
  assert.equal(first.notes[0].author, 'me');
  assert.equal(typeof first.notes[0].id, 'string');
  assert.notEqual(first.notes[0].id, first.notes[1].id);
});

test('numbered and other bullet styles are stripped, emphasis is kept', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    '1. First',
    '2) Second',
    '+ Third',
    '• Fourth',
    '* Fifth',
    '*Emphasis* stays'
  ].join('\n'));

  assert.deepEqual(
    outline(state, ids).map(node => node.content),
    ['First', 'Second', 'Third', 'Fourth', 'Fifth', '*Emphasis* stays']
  );
});

test('indentation nests relative to earlier lines, with tabs, 4 spaces and CRLF', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    'A',
    '\tB',
    '\t\tC',
    '\tD',
    'E',
    '    F',
    '        G',
    '   H'
  ].join('\r\n'));

  assert.deepEqual(outline(state, ids), [
    { content: 'A', children: [{ content: 'B', children: [{ content: 'C' }] }, { content: 'D' }] },
    { content: 'E', children: [{ content: 'F', children: [{ content: 'G' }] }, { content: 'H' }] }
  ]);
});

test('Markdown heading sections nest the items that follow them', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, [
    '# Plan',
    '## Phase 1',
    '- Task a',
    '  - Detail',
    '## Phase 2',
    '- Task b',
    '# Later',
    '#hashtag-only line stays text'
  ].join('\n'));

  assert.deepEqual(outline(state, ids), [
    {
      content: 'Plan',
      children: [
        { content: 'Phase 1', children: [{ content: 'Task a', children: [{ content: 'Detail' }] }] },
        { content: 'Phase 2', children: [{ content: 'Task b' }] }
      ]
    },
    { content: 'Later', children: [{ content: '#hashtag-only line stays text' }] }
  ]);
});

test('Markdown export nests deeper levels as indented bullets', () => {
  const ctx = loadContext();
  const state = sampleState(ctx);
  const md = ctx.exportMarkdownDomain(state, ['p', 'q'], 0, true, true, ctx.walkTasks, ctx.SKIP_CHILDREN);

  assert.equal(md, [
    '## Project',
    '### Milestone',
    '- [x] Write spec',
    '  > remember the docs',
    '  - [~] Old approach',
    '    - Deep detail',
    '- Ship it #release',
    '## Second project',
    ''
  ].join('\n'));
});

test('Markdown export round-trips through import', () => {
  const ctx = loadContext();
  const md = ctx.exportMarkdownDomain(sampleState(ctx), ['p', 'q'], 0, true, true, ctx.walkTasks, ctx.SKIP_CHILDREN);
  const { state, ids } = importText(ctx, md);
  assert.deepEqual(outline(state, ids), SAMPLE_OUTLINE);
});

test('plain-text export round-trips through import', () => {
  const ctx = loadContext();
  const txt = ctx.exportTextDomain(sampleState(ctx), ['p', 'q'], 0, true, true, ctx.walkTasks, ctx.SKIP_CHILDREN);
  const { state, ids } = importText(ctx, txt);
  assert.deepEqual(outline(state, ids), SAMPLE_OUTLINE);
});

test('imported completed items have no completion time, so reports do not count them as done now', () => {
  const ctx = loadContext();
  const { state, ids } = importText(ctx, '- [x] Done long ago\n- ~~Dropped long ago~~');
  for (const id of ids) assert.equal(state.data.tasks[id].completed_at, '');
});
