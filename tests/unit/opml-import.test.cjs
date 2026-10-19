const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Just enough of the browser's DOMParser for OPML: nested elements, attributes with XML's
// whitespace normalisation (a raw newline in an attribute becomes a space) and entity decoding,
// and a <parsererror> element when the tags don't match.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? whole;
  });
}

function findElement(node, tagName) {
  for (const child of node.children) {
    if (child.tagName === tagName) return child;
    const hit = findElement(child, tagName);
    if (hit) return hit;
  }
  return null;
}

function xmlElement(tagName, attrText = '') {
  const attrs = {};
  for (const [, name, value] of attrText.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) {
    attrs[name] = decodeXml(value.replace(/[\t\n\r]/g, ' '));
  }
  const node = {
    tagName,
    children: [],
    getAttribute: name => (name in attrs ? attrs[name] : null),
    querySelector: sel => findElement(node, sel)
  };
  return node;
}

class FakeDOMParser {
  parseFromString(xml) {
    const doc = xmlElement('#document');
    const stack = [doc];
    let ok = true;
    const tagRe = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<(\/?)([\w:-]+)((?:\s+[\w:-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
    for (const m of String(xml).matchAll(tagRe)) {
      if (!m[2]) continue;
      if (m[1]) {
        if (stack.at(-1).tagName !== m[2]) { ok = false; break; }
        stack.pop();
        continue;
      }
      const node = xmlElement(m[2], m[3]);
      stack.at(-1).children.push(node);
      if (!m[4]) stack.push(node);
    }
    if (!ok || stack.length !== 1) doc.children = [xmlElement('parsererror')];
    return doc;
  }
}

function loadContext() {
  const sandbox = { console, JSON, Math, Date, DOMParser: FakeDOMParser };
  vm.createContext(sandbox);
  for (const rel of ['js/core/utils.js', 'js/core/traversal.js', 'js/domain/import-export.js']) {
    vm.runInContext(fs.readFileSync(path.join(process.cwd(), rel), 'utf8'), sandbox, { filename: rel });
  }
  vm.runInContext(
    'globalThis.__exports = { mkTask, esc, exportOpmlDomain, importOpmlDomain, doImportDomain };',
    sandbox
  );
  return sandbox.__exports;
}

function importOpml(ctx, xml) {
  const state = { data: { tasks: {}, lists: {} } };
  let n = 0;
  const ids = ctx.importOpmlDomain(state, xml, { id: 'l2', root_tasks: [] }, () => `t${++n}`, ctx.mkTask);
  return { state, ids };
}

// What a round trip must keep, as plain objects in this realm (so deepEqual works), checking parent links.
function project(state, ids, parentId = '') {
  return Array.from(ids, id => {
    const t = state.data.tasks[id];
    assert.equal(t.parent_id, parentId, `parent of "${t.content}"`);
    assert.equal(t.comments_count, t.notes.length, `comments_count of "${t.content}"`);
    return JSON.parse(JSON.stringify({
      content: t.content,
      status: t.status,
      due: t.due,
      due_asap: t.due_asap,
      color: t.color,
      assignees: t.assignees,
      tags: Object.keys(t.tags),
      tags_as_text: t.tags_as_text,
      notes: t.notes.map(n => ({ content: n.content, author: n.author, created_at: n.created_at })),
      repeating_due: t.repeating_due,
      children: project(state, t.tasks, t.id)
    }));
  });
}

function sampleState(ctx) {
  const tags = names => Object.fromEntries(names.map(name => [name, { isPrivate: false }]));
  const notes = [
    { id: 'n1', author: 'me', content: 'line one\nline two', created_at: '2026-01-02T03:04:05.000Z', updated_at: '2026-01-02T03:04:05.000Z' },
    { id: 'n2', author: 'ann', content: 'second note & <stuff> "quoted"', created_at: '2026-02-03T04:05:06.000Z', updated_at: '2026-02-03T04:05:06.000Z' }
  ];
  const repeat = { freq: 'weekly', interval: 2, weekdays: [1, 4], repeatFrom: 'due', paused: false, startDate: '2026-10-19', reopenDays: 0 };
  const task = o => ctx.mkTask({ checklist_id: 'l1', ...o });
  const tasks = {
    p: task({
      id: 'p', content: 'Plan launch', tasks: ['a', 'b', 'r', 's', 'm'],
      tags: tags(['work', 'q4']), tags_as_text: 'work,q4', color: 3, assignees: ['ann', 'bob'],
      due: '2026-11-02', notes, comments_count: 2
    }),
    a: task({ id: 'a', parent_id: 'p', content: 'Draft "spec" & <outline>', status: 1, completed_at: '2026-10-01T00:00:00.000Z' }),
    b: task({ id: 'b', parent_id: 'p', content: 'Old idea', status: 2, tasks: ['c'] }),
    c: task({ id: 'c', parent_id: 'b', content: 'Detail' }),
    r: task({ id: 'r', parent_id: 'p', content: 'Weekly sync', due: '2026-10-19', repeating_due: repeat }),
    s: task({ id: 's', parent_id: 'p', content: 'Urgent thing', due_asap: true }),
    m: task({ id: 'm', parent_id: 'p', content: 'Line A\nLine B' }),
    q: task({ id: 'q', content: 'Second root' })
  };
  return { data: { tasks, lists: { l1: { id: 'l1', name: 'Work & Play', root_tasks: ['p', 'q'] } } } };
}

test('OPML export round-trips status, tags, notes, repeats and other attributes through import', () => {
  const ctx = loadContext();
  const source = sampleState(ctx);
  const xml = ctx.exportOpmlDomain(source, ['p', 'q'], true, true, ctx.esc, 'l1');
  const { state, ids } = importOpml(ctx, xml);

  assert.deepEqual(project(state, ids), project(source, ['p', 'q']));
  for (const t of Object.values(state.data.tasks)) assert.equal(t.checklist_id, 'l2');
});

test('imported completed tasks have no completion time, and notes get fresh ids', () => {
  const ctx = loadContext();
  const source = sampleState(ctx);
  const { state, ids } = importOpml(ctx, ctx.exportOpmlDomain(source, ['p'], true, true, ctx.esc, 'l1'));
  const root = state.data.tasks[ids[0]];
  const done = state.data.tasks[root.tasks[0]];

  assert.equal(done.status, 1);
  assert.equal(done.completed_at, '');
  assert.equal(root.notes.length, 2);
  assert.notEqual(root.notes[0].id, 'n1');
  assert.notEqual(root.notes[0].id, root.notes[1].id);
});

test('OPML export leaves notes out when they are not requested', () => {
  const ctx = loadContext();
  const xml = ctx.exportOpmlDomain(sampleState(ctx), ['p'], false, true, ctx.esc, 'l1');
  assert.equal(xml.includes('line one'), false);
  assert.equal(importOpml(ctx, xml).state.data.tasks.t1.notes.length, 0);
});

test('OPML from other outliners: _complete, _status and _note are understood', () => {
  const ctx = loadContext();
  const { state, ids } = importOpml(ctx, [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0"><head><title>Elsewhere</title></head><body>',
    '  <outline text="Done thing" _complete="true"/>',
    '  <outline text="Dropped" _status="invalidated"/>',
    '  <outline text="Has note" _note="first line&#10;second line">',
    '    <outline text="Child"/>',
    '  </outline>',
    '</body></opml>'
  ].join('\n'));

  const tasks = Array.from(ids, id => state.data.tasks[id]);
  assert.deepEqual(tasks.map(t => [t.content, t.status]), [['Done thing', 1], ['Dropped', 2], ['Has note', 0]]);
  assert.deepEqual(Array.from(tasks[2].notes, n => [n.content, n.author]), [['first line\nsecond line', 'me']]);
  assert.equal(tasks[2].comments_count, 1);
  assert.equal(state.data.tasks[tasks[2].tasks[0]].content, 'Child');
});

test('an unreadable repeat attribute is ignored, and the task is still imported', () => {
  const ctx = loadContext();
  const { state, ids } = importOpml(ctx, [
    '<opml version="2.0"><body>',
    '<outline text="Bad JSON" repeat="{not json"/>',
    '<outline text="Unknown frequency" repeat="{&quot;freq&quot;:&quot;hourly&quot;}"/>',
    '</body></opml>'
  ].join(''));

  assert.deepEqual(Array.from(ids, id => [state.data.tasks[id].content, state.data.tasks[id].repeating_due]), [
    ['Bad JSON', null],
    ['Unknown frequency', null]
  ]);
});

test('malformed OPML reports an import error instead of importing nothing', () => {
  const ctx = loadContext();
  const list = { id: 'l1', root_tasks: ['keep'] };
  const state = {
    listId: 'l1',
    selId: null,
    data: { tasks: { keep: ctx.mkTask({ id: 'keep', checklist_id: 'l1' }) }, lists: { l1: list } }
  };
  const toasts = [];
  const app = {
    pushUndo: () => {}, snap: () => ({}), save: () => {}, render: () => {}, closeModal: () => {},
    toast: msg => toasts.push(msg)
  };

  ctx.doImportDomain(app, state, { fmt: 'opml', pos: 'bottom', raw: '<opml><body><outline text="x"></body></opml>' });

  assert.match(toasts.at(-1), /^Import failed: /);
  assert.deepEqual(Array.from(list.root_tasks), ['keep']);
  assert.deepEqual(Object.keys(state.data.tasks), ['keep']);
});
