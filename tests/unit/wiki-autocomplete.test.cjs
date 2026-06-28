const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditorController(docNodes = {}) {
  const sourcePath = path.join(process.cwd(), 'js/ui/editor-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const sandbox = {
    console,
    document: {
      getElementById: (id) => docNodes[id] || null
    }
  };

  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__exports = { updateInlineAutocompleteUi, acceptInlineAutocompleteUi, getWikiSuggestionsUi };`,
    sandbox,
    { filename: 'editor-controller.js' }
  );

  return sandbox.__exports;
}

function makeState() {
  return {
    data: {
      tasks: {
        t1: { id: 't1', content: 'Inbox Root', checklist_id: 'l1', deleted: false, tags: {}, assignees: [] },
        t2: { id: 't2', content: 'Project Plan', checklist_id: 'l2', deleted: false, tags: {}, assignees: [] },
        t3: { id: 't3', content: 'Write Tests', checklist_id: 'l2', deleted: false, tags: {}, assignees: [] }
      },
      lists: {
        l1: { id: 'l1', name: 'Inbox' },
        l2: { id: 'l2', name: 'Work' }
      }
    },
    iac: { open: false, taskId: null, type: '', query: '', start: 0, end: 0, items: [], index: 0 }
  };
}

test('getWikiSuggestionsUi returns global and cross-list wiki suggestions', () => {
  const { getWikiSuggestionsUi } = loadEditorController({});
  const state = makeState();

  const all = getWikiSuggestionsUi(state, '');
  assert.equal(all.includes('Project Plan'), true);
  assert.equal(all.includes('Work::Project Plan'), true);

  const filtered = getWikiSuggestionsUi(state, 'work::write');
  assert.equal(filtered.includes('Work::Write Tests'), true);
});

test('updateInlineAutocompleteUi opens wiki suggestions for [[ prefix', () => {
  const box = {
    classList: { add: () => {}, remove: () => {} },
    innerHTML: '',
    querySelectorAll: () => []
  };
  const editor = {
    value: 'See [[Work::Pro',
    selectionStart: 16,
    focus: () => {},
    setSelectionRange: () => {},
    style: {}
  };

  const { updateInlineAutocompleteUi } = loadEditorController({ 'iac-t1': box });
  const state = makeState();

  const app = {
    hideInlineAutocomplete: () => {
      state.iac = { open: false, taskId: null, type: '', query: '', start: 0, end: 0, items: [], index: 0 };
    },
    getTagSuggestions: () => [],
    getAssigneeSuggestions: () => [],
    renderInlineAutocomplete: () => {}
  };

  updateInlineAutocompleteUi(app, state, 't1', editor);

  assert.equal(state.iac.open, true);
  assert.equal(state.iac.type, 'wiki');
  assert.equal(state.iac.items.some(v => v.includes('Work::Project Plan')), true);
});

test('acceptInlineAutocompleteUi inserts closing wiki token', () => {
  const box = {
    classList: { add: () => {}, remove: () => {} },
    innerHTML: '',
    querySelectorAll: () => []
  };
  const editor = {
    value: 'Link [[Pro',
    selectionStart: 10,
    focus: () => {},
    setSelectionRange: () => {},
    style: { height: 'auto' },
    scrollHeight: 20
  };

  const { acceptInlineAutocompleteUi } = loadEditorController({ 'ea-t1': editor, 'iac-t1': box });
  const state = makeState();
  state.iac = {
    open: true,
    taskId: 't1',
    type: 'wiki',
    query: 'pro',
    start: 7,
    end: 10,
    items: ['Project Plan'],
    index: 0
  };

  const app = {
    isInlineAutocompleteOpen: () => true,
    hideInlineAutocomplete: () => {
      state.iac = { open: false, taskId: null, type: '', query: '', start: 0, end: 0, items: [], index: 0 };
    },
    updateInlineAutocomplete: () => {}
  };

  acceptInlineAutocompleteUi(app, state);

  assert.equal(editor.value, 'Link [[Project Plan]] ');
});
