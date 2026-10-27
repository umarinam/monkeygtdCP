const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEditorController(document) {
  const source = fs.readFileSync(path.join(process.cwd(), 'js/ui/editor-controller.js'), 'utf8');
  const sandbox = { console, document };
  vm.createContext(sandbox);
  vm.runInContext(`${source}\n;globalThis.__editor = { editKeyUi, toggleMarkdownEmphasis };`, sandbox, {
    filename: 'editor-controller.js'
  });
  return sandbox.__editor;
}

function fakeTextarea(value, start, end = start) {
  return {
    value,
    selectionStart: start,
    selectionEnd: end,
    focus() {},
    setSelectionRange(a, b) {
      this.selectionStart = a;
      this.selectionEnd = b;
    }
  };
}

function fakeApp() {
  return { isInlineAutocompleteOpen: () => false };
}

function key(k, mods = {}) {
  const e = { key: k, ctrlKey: false, shiftKey: false, altKey: false, prevented: false, ...mods };
  e.preventDefault = () => { e.prevented = true; };
  return e;
}

// Applies the toggle to a {value, start, end} snapshot, like repeated keypresses would.
function press(toggle, snap, marker) {
  const r = toggle(snap.value, snap.start, snap.end, marker);
  return { value: r.value, start: r.selStart, end: r.selEnd };
}

const { toggleMarkdownEmphasis } = loadEditorController({ getElementById: () => null });

test('bold wraps the selection in ** and keeps the same words selected', () => {
  const r = toggleMarkdownEmphasis('make this bold', 5, 9, '**');
  assert.equal(r.value, 'make **this** bold');
  assert.equal(r.value.slice(r.selStart, r.selEnd), 'this');
});

test('italic wraps the selection in *', () => {
  const r = toggleMarkdownEmphasis('an aside here', 3, 8, '*');
  assert.equal(r.value, 'an *aside* here');
  assert.equal(r.value.slice(r.selStart, r.selEnd), 'aside');
});

test('bold toggles off when the selected text is already bold', () => {
  const r = toggleMarkdownEmphasis('make **this** bold', 7, 11, '**');
  assert.equal(r.value, 'make this bold');
  assert.equal(r.value.slice(r.selStart, r.selEnd), 'this');
});

test('a selection that includes its own markers toggles off too', () => {
  const r = toggleMarkdownEmphasis('make **this** bold', 5, 13, '**');
  assert.equal(r.value, 'make this bold');
  assert.equal(r.value.slice(r.selStart, r.selEnd), 'this');
});

test('with no selection, markers are inserted with the caret between them, and a second press removes them', () => {
  const once = press(toggleMarkdownEmphasis, { value: 'ab', start: 1, end: 1 }, '**');
  assert.deepEqual(once, { value: 'a****b', start: 3, end: 3 });

  const twice = press(toggleMarkdownEmphasis, once, '**');
  assert.deepEqual(twice, { value: 'ab', start: 1, end: 1 });
});

test('bold and italic stack and unstack independently', () => {
  let s = { value: 'x', start: 0, end: 1 };
  s = press(toggleMarkdownEmphasis, s, '*');
  assert.equal(s.value, '*x*');
  s = press(toggleMarkdownEmphasis, s, '**');
  assert.equal(s.value, '***x***', 'bold is added around italic');
  s = press(toggleMarkdownEmphasis, s, '*');
  assert.equal(s.value, '**x**', 'removing italic keeps bold');
  s = press(toggleMarkdownEmphasis, s, '**');
  assert.equal(s.value, 'x');
  assert.equal(s.value.slice(s.start, s.end), 'x');
});

test('italic on bold text adds italic instead of stripping one asterisk', () => {
  const r = toggleMarkdownEmphasis('**x**', 2, 3, '*');
  assert.equal(r.value, '***x***');
});

test('Ctrl+B in the task editor bolds the selection via insertText so native undo still works', () => {
  const el = fakeTextarea('make this bold', 5, 9);
  const calls = [];
  const document = {
    getElementById: (id) => (id === 'ea-t1' ? el : null),
    execCommand(cmd, _ui, text) {
      calls.push({ cmd, text, range: [el.selectionStart, el.selectionEnd] });
      el.value = el.value.slice(0, el.selectionStart) + text + el.value.slice(el.selectionEnd);
      return true;
    }
  };
  const { editKeyUi } = loadEditorController(document);

  const e = key('b', { ctrlKey: true });
  editKeyUi(fakeApp(), {}, e, 't1');

  assert.equal(e.prevented, true);
  assert.deepEqual(calls, [{ cmd: 'insertText', text: '**this**', range: [5, 9] }]);
  assert.equal(el.value, 'make **this** bold');
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), 'this');
});

test('unbolding an empty pair uses the delete command, since insertText needs text', () => {
  const el = fakeTextarea('a****b', 3);
  const calls = [];
  const document = {
    getElementById: () => el,
    execCommand(cmd) {
      calls.push({ cmd, range: [el.selectionStart, el.selectionEnd] });
      el.value = el.value.slice(0, el.selectionStart) + el.value.slice(el.selectionEnd);
      return true;
    }
  };
  const { editKeyUi } = loadEditorController(document);

  editKeyUi(fakeApp(), {}, key('b', { ctrlKey: true }), 't1');

  assert.deepEqual(calls, [{ cmd: 'delete', range: [1, 5] }]);
  assert.equal(el.value, 'ab');
  assert.deepEqual([el.selectionStart, el.selectionEnd], [1, 1]);
});

test('Ctrl+I falls back to setting the value when execCommand is unavailable', () => {
  const el = fakeTextarea('an aside here', 3, 8);
  const { editKeyUi } = loadEditorController({ getElementById: () => el });

  const e = key('I', { ctrlKey: true }); // Caps Lock on
  editKeyUi(fakeApp(), {}, e, 't1');

  assert.equal(e.prevented, true);
  assert.equal(el.value, 'an *aside* here');
  assert.equal(el.value.slice(el.selectionStart, el.selectionEnd), 'aside');
});

test('plain b, Ctrl+Shift+B and Ctrl+Alt+B are left alone', () => {
  const el = fakeTextarea('abc', 0, 3);
  const { editKeyUi } = loadEditorController({ getElementById: () => el });

  for (const e of [key('b'), key('B', { ctrlKey: true, shiftKey: true }), key('b', { ctrlKey: true, altKey: true })]) {
    editKeyUi(fakeApp(), {}, e, 't1');
    assert.equal(e.prevented, false);
  }
  assert.equal(el.value, 'abc');
});
