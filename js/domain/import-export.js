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
    const prefix = level === 0 ? '## ' : level === 1 ? '### ' : '- ';
    const check = task.status === 1 ? '[x] ' : task.status === 2 ? '[~] ' : '';
    output += `${prefix}${check}${task.content}\n`;
    if (notes && task.notes) {
      for (const n of task.notes) output += `  > ${n.content}\n`;
    }
  }, depth);
  return output;
}

function exportOpmlDomain(state, ids, notes, done, escFn, listId) {
  const list = state.data.lists[listId];
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
      const attrs = `text="${escFn(task.content)}" status="${task.status}" due="${task.due || ''}" tags="${task.tags_as_text || ''}"`;

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

function importTextDomain(state, text, list, uidFn, mkTaskFn) {
  const lines = text.split('\n').filter(l => l.trim());
  const ids = [];
  const stack = [];

  for (const line of lines) {
    const clean = line.replace(/^[-*]\s*/, '').replace(/^\[\s*[x\s]?\]\s*/, '');
    const ind = line.length - line.trimStart().length;
    const depth = Math.floor(ind / 2);
    const id = uidFn();
    const parentId = stack.filter(s => s.depth < depth).at(-1)?.id || '';

    const task = mkTaskFn({
      id,
      content: clean.trim(),
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

    stack.push({ id, depth });
  }

  return ids;
}

function importOpmlDomain(state, xml, list, uidFn, mkTaskFn) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const ids = [];

  const process = (el, parentId) => {
    for (const child of el.children) {
      if (child.tagName !== 'outline') continue;

      const id = uidFn();
      const task = mkTaskFn({
        id,
        checklist_id: list.id,
        parent_id: parentId,
        content: child.getAttribute('text') || '',
        due: child.getAttribute('due') || '',
        tags_as_text: child.getAttribute('tags') || ''
      });

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

  const body = doc.querySelector('body');
  if (body) process(body, '');
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
