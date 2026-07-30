const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadModalController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/modal-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    JSON,
    Math,
    Date,
    now: () => '2026-06-27T12:00:00.000Z'
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__taskJsonExports = { parseTaskJsonInput, normalizeTaskFromJson, parseListJsonInput, normalizeListFromJson, normalizeCurrentListJsonPayload, buildCurrentListJsonPayload };`,
    sandbox,
    { filename: 'modal-controller.js' }
  );

  return sandbox.__taskJsonExports;
}

function makeState() {
  return {
    listId: 'l1',
    data: {
      lists: {
        l1: { id: 'l1', name: 'Inbox', root_tasks: ['t1'] },
        l2: { id: 'l2', name: 'Work', root_tasks: [] }
      },
      tasks: {
        t1: {
          id: 't1',
          content: 'Original',
          status: 0,
          checklist_id: 'l1',
          parent_id: '',
          tags: {},
          tags_as_text: '',
          notes: [],
          comments_count: 0,
          assignees: [],
          tasks: [],
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z'
        }
      }
    }
  };
}

test('normalizeTaskFromJson keeps task id and derives tags/comments on valid task JSON', () => {
  const { parseTaskJsonInput, normalizeTaskFromJson } = loadModalController();
  const state = makeState();
  const parsed = parseTaskJsonInput(JSON.stringify({
    id: 'hacked-id',
    content: 'Updated content',
    status: 1,
    checklist_id: 'l2',
    tags: { bug: { isPrivate: false }, urgent: { isPrivate: false } },
    notes: [{ id: 'n1', author: 'me', content: 'note', created_at: '2026-06-01', updated_at: '2026-06-01' }],
    assignees: ['sam'],
    tasks: ['t2']
  }));

  const normalized = normalizeTaskFromJson('t1', parsed, state);

  assert.equal(normalized.id, 't1');
  assert.equal(normalized.content, 'Updated content');
  assert.equal(normalized.status, 1);
  assert.equal(normalized.checklist_id, 'l2');
  assert.deepEqual(normalized.tasks, ['t2']);
  assert.deepEqual(normalized.assignees, ['sam']);
  assert.equal(normalized.tags_as_text, 'bug,urgent');
  assert.equal(normalized.comments_count, 1);
  assert.equal(normalized.updated_at, '2026-06-27T12:00:00.000Z');
});

test('parseTaskJsonInput and normalizeTaskFromJson reject bad shape and normalize invalid references', () => {
  const { parseTaskJsonInput, normalizeTaskFromJson } = loadModalController();
  const state = makeState();

  assert.throws(() => parseTaskJsonInput('[1,2,3]'), /Task JSON must be an object/);

  const parsed = parseTaskJsonInput(JSON.stringify({
    content: 123,
    parent_id: 'missing-parent',
    checklist_id: 'missing-list',
    tags: [],
    notes: {},
    assignees: {},
    tasks: 'bad'
  }));

  const normalized = normalizeTaskFromJson('t1', parsed, state);

  assert.equal(normalized.content, '123');
  assert.equal(normalized.parent_id, '');
  assert.equal(normalized.checklist_id, 'l1');
  assert.equal(JSON.stringify(normalized.tags), '{}');
  assert.equal(JSON.stringify(normalized.notes), '[]');
  assert.equal(JSON.stringify(normalized.assignees), '[]');
  assert.equal(JSON.stringify(normalized.tasks), '[]');
  assert.equal(normalized.comments_count, 0);
});

test('normalizeListFromJson keeps list id and sanitizes root task ids', () => {
  const { parseListJsonInput, normalizeListFromJson } = loadModalController();
  const state = makeState();
  state.data.tasks.t2 = {
    id: 't2',
    content: 'Top level second',
    checklist_id: 'l1',
    parent_id: '',
    deleted: false,
    tasks: []
  };
  state.data.tasks.t3 = {
    id: 't3',
    content: 'Child',
    checklist_id: 'l1',
    parent_id: 't1',
    deleted: false,
    tasks: []
  };

  const parsed = parseListJsonInput(JSON.stringify({
    id: 'hacked-list-id',
    name: '  Updated List  ',
    tags: [' team ', '', 'ops'],
    root_tasks: ['t2', 't2', 't3', 'missing', 't1'],
    archived: 1
  }));

  const normalized = normalizeListFromJson('l1', parsed, state);

  assert.equal(normalized.id, 'l1');
  assert.equal(normalized.name, 'Updated List');
  assert.equal(JSON.stringify(normalized.tags), '["team","ops"]');
  assert.equal(JSON.stringify(normalized.root_tasks), '["t2","t1"]');
  assert.equal(normalized.archived, true);
  assert.equal(typeof normalized.updated_at, 'string');
});

test('parseListJsonInput and normalizeListFromJson reject bad shape and preserve defaults', () => {
  const { parseListJsonInput, normalizeListFromJson } = loadModalController();
  const state = makeState();

  assert.throws(() => parseListJsonInput('[1,2,3]'), /List JSON must be an object/);

  const parsed = parseListJsonInput(JSON.stringify({
    name: ' ',
    tags: {},
    style: 123,
    root_tasks: 'bad'
  }));

  const normalized = normalizeListFromJson('l1', parsed, state);

  assert.equal(normalized.name, 'Inbox');
  assert.equal(JSON.stringify(normalized.tags), '[]');
  assert.equal(normalized.style, 'none');
  assert.equal(JSON.stringify(normalized.root_tasks), '["t1"]');
});

test('buildCurrentListJsonPayload includes all tasks and subtasks for current list', () => {
  const { buildCurrentListJsonPayload } = loadModalController();
  const state = makeState();
  state.data.tasks.t2 = {
    id: 't2',
    content: 'Subtask',
    status: 0,
    checklist_id: 'l1',
    parent_id: 't1',
    tasks: [],
    deleted: false
  };
  state.data.tasks.t3 = {
    id: 't3',
    content: 'Other list task',
    status: 0,
    checklist_id: 'l2',
    parent_id: '',
    tasks: [],
    deleted: false
  };

  const payload = buildCurrentListJsonPayload('l1', state);

  assert.equal(payload.list.id, 'l1');
  assert.equal(Object.prototype.hasOwnProperty.call(payload.tasks, 't1'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.tasks, 't2'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.tasks, 't3'), false);
});

test('normalizeCurrentListJsonPayload accepts full payload and rejects invalid tasks map', () => {
  const { normalizeCurrentListJsonPayload } = loadModalController();
  const state = makeState();

  const payload = normalizeCurrentListJsonPayload('l1', {
    list: { id: 'l1', name: 'Inbox', root_tasks: ['t1'] },
    tasks: { t1: { id: 't1', content: 'Edited', checklist_id: 'l1' } }
  }, state);

  assert.equal(payload.mode, 'payload');
  assert.equal(payload.list.name, 'Inbox');
  assert.equal(payload.tasks.t1.content, 'Edited');

  assert.throws(
    () => normalizeCurrentListJsonPayload('l1', { list: { name: 'Inbox' }, tasks: [] }, state),
    /tasks.*object map/
  );
});
