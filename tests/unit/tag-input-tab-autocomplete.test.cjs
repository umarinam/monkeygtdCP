const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function makeElement(id) {
  return {
    id,
    listeners: {},
    addEventListener(type, cb) { this.listeners[type] = cb; },
    value: '',
    classList: {
      _set: new Set(),
      contains(c) { return this._set.has(c); },
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); }
    }
  };
}

function loadKeyboardController() {
  const sourcePath = path.join(process.cwd(), 'js/ui/keyboard-controller.js');
  const source = fs.readFileSync(sourcePath, 'utf8');

  const elements = {};
  ['search', 'cpi', 'tag-in', 'move-q', 'qa-input'].forEach((id) => {
    elements[id] = makeElement(id);
  });

  const tagAc = makeElement('tag-ac');
  let highlighted = null;
  tagAc.querySelector = () => highlighted;
  elements['tag-ac'] = tagAc;

  const documentStub = {
    addEventListener() {},
    getElementById(id) { return elements[id] || makeElement(id); }
  };

  const sandbox = { console, document: documentStub };
  vm.createContext(sandbox);
  vm.runInContext(
    `${source}\n;globalThis.__kbExports = { bindGlobalEvents };`,
    sandbox,
    { filename: 'keyboard-controller.js' }
  );

  return {
    bindGlobalEvents: sandbox.__kbExports.bindGlobalEvents,
    elements,
    tagAc,
    setHighlighted: (el) => { highlighted = el; }
  };
}

function makeApp(calls) {
  return {
    pickTag: (tg) => calls.pickTag.push(tg),
    addTagFromInput: () => { calls.addTagFromInput += 1; },
    closeModal: (id) => calls.closeModal.push(id),
    handleKey: () => {},
    updateTagAC: () => {},
    updateMoveR: () => {},
    handleMoveInputKey: () => {},
    updateCP: () => {},
    execCP: () => {},
    closeCP: () => {},
    renderCPItems: () => {},
    quickAddKey: () => {}
  };
}

test('Tab selects the highlighted tag suggestion instead of shifting focus to the next control', () => {
  const { bindGlobalEvents, elements, tagAc, setHighlighted } = loadKeyboardController();
  const calls = { pickTag: [], addTagFromInput: 0, closeModal: [] };
  bindGlobalEvents(makeApp(calls), {});

  tagAc.classList.add('on');
  setHighlighted({ dataset: { tag: 'urgent' } });

  let defaultPrevented = false;
  elements['tag-in'].listeners.keydown({ key: 'Tab', preventDefault: () => { defaultPrevented = true; } });

  assert.deepEqual(calls.pickTag, ['urgent']);
  assert.equal(defaultPrevented, true);
  assert.equal(calls.addTagFromInput, 0);
});

test('Tab falls through to normal focus change when the suggestion dropdown is closed', () => {
  const { bindGlobalEvents, elements, tagAc, setHighlighted } = loadKeyboardController();
  const calls = { pickTag: [], addTagFromInput: 0, closeModal: [] };
  bindGlobalEvents(makeApp(calls), {});

  tagAc.classList.remove('on');
  setHighlighted(null);

  let defaultPrevented = false;
  elements['tag-in'].listeners.keydown({ key: 'Tab', preventDefault: () => { defaultPrevented = true; } });

  assert.deepEqual(calls.pickTag, []);
  assert.equal(defaultPrevented, false);
});

test('Tab falls through to normal focus change when the dropdown is open but has no highlighted match', () => {
  const { bindGlobalEvents, elements, tagAc, setHighlighted } = loadKeyboardController();
  const calls = { pickTag: [], addTagFromInput: 0, closeModal: [] };
  bindGlobalEvents(makeApp(calls), {});

  tagAc.classList.add('on');
  setHighlighted(null);

  let defaultPrevented = false;
  elements['tag-in'].listeners.keydown({ key: 'Tab', preventDefault: () => { defaultPrevented = true; } });

  assert.deepEqual(calls.pickTag, []);
  assert.equal(defaultPrevented, false);
});

test('Enter still submits the raw typed tag text, unaffected by the Tab fix', () => {
  const { bindGlobalEvents, elements, tagAc, setHighlighted } = loadKeyboardController();
  const calls = { pickTag: [], addTagFromInput: 0, closeModal: [] };
  bindGlobalEvents(makeApp(calls), {});

  tagAc.classList.add('on');
  setHighlighted({ dataset: { tag: 'urgent' } });

  let defaultPrevented = false;
  elements['tag-in'].listeners.keydown({ key: 'Enter', preventDefault: () => { defaultPrevented = true; } });

  assert.equal(calls.addTagFromInput, 1);
  assert.deepEqual(calls.pickTag, []);
  assert.equal(defaultPrevented, true);
});

test('Escape still closes the tags modal, unaffected by the Tab fix', () => {
  const { bindGlobalEvents, elements } = loadKeyboardController();
  const calls = { pickTag: [], addTagFromInput: 0, closeModal: [] };
  bindGlobalEvents(makeApp(calls), {});

  elements['tag-in'].listeners.keydown({ key: 'Escape', preventDefault: () => {} });

  assert.deepEqual(calls.closeModal, ['ov-tags']);
});
