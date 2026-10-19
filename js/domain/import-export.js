'use strict';

function flatIdsDomain(state, ids, walkTasksFn) {
  const result = [];
  walkTasksFn(ids, state.data.tasks, task => {
    result.push(task.id);
  });
  return result;
}

function exportMarkdownDomain(state, ids, depth, notes, done, walkTasksFn, skipChildren) {
  let output = '';
  walkTasksFn(ids, state.data.tasks, (task, level) => {
    if (!done && task.status !== 0) return skipChildren;
    const pad = level < 2 ? '' : '  '.repeat(level - 2);
    const prefix = level === 0 ? '## ' : level === 1 ? '### ' : `${pad}- `;
    const check = task.status === 1 ? '[x] ' : task.status === 2 ? '[~] ' : '';
    output += `${prefix}${check}${task.content}\n`;
    if (notes && task.notes) {
      for (const n of task.notes) output += `${pad}  > ${n.content}\n`;
    }
  }, depth);
  return output;
}

function exportOpmlDomain(state, ids, notes, done, escFn, listId) {
  const list = state.data.lists[listId];
  // XML turns a raw newline inside an attribute into a space, so multi-line values need &#10;.
  const attr = value => escFn(value).replace(/\r\n?|\n/g, '&#10;');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    `<head><title>${escFn(list ? list.name : '')}</title></head>`,
    '<body>'
  ];

  const emit = (branchIds, depth) => {
    for (const id of branchIds) {
      const task = state.data.tasks[id];
      if (!task || task.deleted) continue;
      if (!done && task.status !== 0) continue;

      const ind = '  '.repeat(depth);
      const parts = [
        `text="${attr(task.content)}"`,
        `status="${task.status}"`,
        `due="${task.due || ''}"`,
        `tags="${attr(task.tags_as_text || '')}"`
      ];
      if (task.status === 1) parts.push('_complete="true"');
      if (task.status === 2) parts.push('_status="invalidated"');
      if (task.due_asap) parts.push('asap="true"');
      if (task.color) parts.push(`color="${task.color}"`);
      if ((task.assignees || []).length) parts.push(`assignees="${attr(task.assignees.join(','))}"`);
      if (task.repeating_due) parts.push(`repeat="${attr(JSON.stringify(task.repeating_due))}"`);
      if (notes && (task.notes || []).length) {
        // _note is what other outliners read; notes keeps each note and its author and dates.
        parts.push(`_note="${attr(task.notes.map(n => n.content).join('\n\n'))}"`);
        const kept = task.notes.map(({ author, content, created_at, updated_at }) => ({ author, content, created_at, updated_at }));
        parts.push(`notes="${attr(JSON.stringify(kept))}"`);
      }
      const attrs = parts.join(' ');

      if (task.tasks && task.tasks.length) {
        lines.push(`${ind}<outline ${attrs}>`);
        emit(task.tasks, depth + 1);
        lines.push(`${ind}</outline>`);
      } else {
        lines.push(`${ind}<outline ${attrs}/>`);
      }
    }
  };

  emit(ids, 1);
  lines.push('</body>', '</opml>');
  return lines.join('\n');
}

function exportTextDomain(state, ids, depth, notes, done, walkTasksFn, skipChildren) {
  let output = '';
  walkTasksFn(ids, state.data.tasks, (task, level) => {
    if (!done && task.status !== 0) return skipChildren;
    const ind = '\t'.repeat(level);
    const st = task.status === 1 ? ' (done)' : task.status === 2 ? ' (invalid)' : '';
    output += `${ind}${task.content}${st}\n`;
    if (notes && task.notes) {
      for (const n of task.notes) output += `${ind}\t[Note] ${n.content}\n`;
    }
  }, depth);
  return output;
}

function addImportedNoteDomain(task, content, uidFn, from = {}) {
  const created = typeof from.created_at === 'string' && from.created_at ? from.created_at : now();
  const updated = typeof from.updated_at === 'string' && from.updated_at ? from.updated_at : created;
  const author = typeof from.author === 'string' && from.author ? from.author : 'me';
  task.notes = [...(task.notes || []), { id: uidFn(), author, content, created_at: created, updated_at: updated }];
  task.comments_count = task.notes.length;
}

// Reads indented text and Markdown, including what exportMarkdownDomain and exportTextDomain write.
// A line nests under the nearest earlier line with a lower rank: a heading ranks by its level, above
// any list item; other lines rank by their indentation (a tab counts as 4 spaces).
function importTextDomain(state, text, list, uidFn, mkTaskFn) {
  const ids = [];
  const stack = [];
  let last = null;

  for (const raw of String(text || '').split(/\r\n?|\n/)) {
    let line = raw.trim();
    if (!line) continue;

    const note = line.match(/^(?:>|\[Note\])\s?(.*)$/);
    if (note && last) {
      if (note[1].trim()) addImportedNoteDomain(last, note[1].trim(), uidFn);
      continue;
    }

    let rank = raw.match(/^[ \t]*/)[0].replace(/\t/g, '    ').length;
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      rank = heading[1].length - 7;
      line = heading[2];
    }

    line = line.replace(/^(?:[-*+•](?:\s+|$)|\d+[.)]\s+)/, '');
    let status = 0;
    const box = line.match(/^\[([ xX~])\]\s*/);
    if (box) {
      status = box[1] === ' ' ? 0 : box[1] === '~' ? 2 : 1;
      line = line.slice(box[0].length);
    }
    const strike = line.match(/^~~(.+)~~$/);
    if (strike) {
      status = 2;
      line = strike[1];
    }
    const suffix = line.match(/^(.*?)\s+\((done|invalid)\)$/);
    if (suffix) {
      status = suffix[2] === 'done' ? 1 : 2;
      line = suffix[1];
    }

    const content = line.trim();
    if (!content) continue;

    while (stack.length && stack[stack.length - 1].rank >= rank) stack.pop();
    const parentId = stack.length ? stack[stack.length - 1].id : '';
    const id = uidFn();

    // completed_at stays blank: the real completion time is unknown, and stamping it now would
    // make reports count old work as done this week.
    const task = mkTaskFn({
      id,
      content,
      status,
      parent_id: parentId,
      checklist_id: list.id
    });

    state.data.tasks[id] = task;
    if (parentId) {
      const parent = state.data.tasks[parentId];
      parent.tasks = [...(parent.tasks || []), id];
    } else {
      ids.push(id);
    }

    stack.push({ id, rank });
    last = task;
  }

  return ids;
}

function opmlRepeatDomain(raw) {
  if (!raw) return null;
  try {
    const repeat = JSON.parse(raw);
    return repeat && typeof repeat === 'object' && ['daily', 'weekly', 'monthly', 'yearly'].includes(repeat.freq) ? repeat : null;
  } catch {
    return null;
  }
}

function opmlNotesDomain(el) {
  try {
    const notes = JSON.parse(el.getAttribute('notes') || 'null');
    if (Array.isArray(notes)) return notes.filter(n => n && typeof n.content === 'string');
  } catch {
    // Fall back to _note below.
  }
  const note = el.getAttribute('_note');
  return note ? [{ content: note }] : [];
}

function importOpmlDomain(state, xml, list, uidFn, mkTaskFn) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ids = [];
  const body = doc.querySelector('parsererror') ? null : doc.querySelector('body');
  if (!body) throw new Error('not a readable OPML file');

  const process = (el, parentId) => {
    for (const child of el.children) {
      if (child.tagName !== 'outline') continue;

      const attr = name => child.getAttribute(name) || '';
      const statusAttr = attr('status');
      const status = /^[012]$/.test(statusAttr) ? Number(statusAttr)
        : attr('_status') === 'invalidated' ? 2
        : attr('_complete') === 'true' ? 1
        : 0;
      const tags = {};
      for (const tg of attr('tags').split(/[\s,]+/)) {
        const name = tg.replace(/^#/, '');
        if (name) tags[name] = { isPrivate: false };
      }

      const id = uidFn();
      // completed_at stays blank, as in importTextDomain: the real completion time is unknown.
      const task = mkTaskFn({
        id,
        checklist_id: list.id,
        parent_id: parentId,
        content: attr('text'),
        status,
        due: attr('due'),
        due_asap: attr('asap') === 'true',
        color: /^[1-9]$/.test(attr('color')) ? Number(attr('color')) : 0,
        assignees: attr('assignees').split(',').map(a => a.trim()).filter(Boolean),
        tags,
        tags_as_text: Object.keys(tags).join(','),
        repeating_due: opmlRepeatDomain(attr('repeat'))
      });
      for (const note of opmlNotesDomain(child)) addImportedNoteDomain(task, note.content, uidFn, note);

      state.data.tasks[id] = task;
      if (parentId) {
        const parent = state.data.tasks[parentId];
        parent.tasks = [...(parent.tasks || []), id];
      } else {
        ids.push(id);
      }

      process(child, id);
    }
  };

  process(body, '');
  return ids;
}

function doImportDomain(app, state, payload) {
  const fmt = payload.fmt;
  const pos = payload.pos;
  const raw = payload.raw;

  app.pushUndo(app.snap());
  const list = state.data.lists[state.listId];
  let ids = [];

  try {
    if (fmt === 'json') {
      const parsed = JSON.parse(raw);
      const tasks = parsed.tasks || (Array.isArray(parsed) ? parsed : []);
      for (const t of tasks) {
        const id = uid();
        state.data.tasks[id] = { ...mkTask(), ...t, id, checklist_id: state.listId };
        logTaskHistory(state.data.tasks[id], 'creation', {
          source: 'import-json',
          listId: state.listId,
          parentId: state.data.tasks[id].parent_id || ''
        });
        ids.push(id);
      }
    } else if (fmt === 'text') {
      ids = importTextDomain(state, raw, list, uid, mkTask);
      for (const id of ids) {
        const t = state.data.tasks[id];
        if (t) {
          logTaskHistory(t, 'creation', {
            source: 'import-text',
            listId: state.listId,
            parentId: t.parent_id || ''
          });
        }
      }
    } else if (fmt === 'opml') {
      ids = importOpmlDomain(state, raw, list, uid, mkTask);
      for (const id of ids) {
        const t = state.data.tasks[id];
        if (t) {
          logTaskHistory(t, 'creation', {
            source: 'import-opml',
            listId: state.listId,
            parentId: t.parent_id || ''
          });
        }
      }
    }

    if (pos === 'top') list.root_tasks = [...ids, ...list.root_tasks];
    else if (pos === 'bottom') list.root_tasks = [...list.root_tasks, ...ids];
    else if (pos === 'under' && state.selId) {
      const parent = state.data.tasks[state.selId];
      parent.tasks = [...(parent.tasks || []), ...ids];
      for (const id of ids) {
        const t = state.data.tasks[id];
        if (!t) continue;
        const beforeParent = t.parent_id || '';
        t.parent_id = state.selId;
        if (beforeParent !== (t.parent_id || '')) {
          logTaskHistory(t, 'structure', {
            action: 'import-under-parent',
            from: { parent_id: beforeParent },
            to: { parent_id: t.parent_id || '' }
          });
        }
      }
    }
    else if (pos === 'replace') list.root_tasks = ids;
    else list.root_tasks = [...list.root_tasks, ...ids];

    app.save();
    app.closeModal('ov-import');
    app.render();
    app.toast(`Imported ${ids.length} task(s)`);
  } catch (err) {
    app.toast('Import failed: ' + err.message);
  }
}
