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
    `${source}\n;globalThis.__taskJsonExports = { parseTaskJsonInput, normalizeTaskFromJson };`,
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
