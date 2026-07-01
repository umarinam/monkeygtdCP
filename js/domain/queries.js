'use strict';

function registerAppQueries(app, deps) {
  const {
    state,
    walkTasks,
    skipChildren,
    todayS,
    tomorrowS,
    cmpDate,
    esc
  } = deps;

  const getData = () => state.data;

  app.queryService.register('tasks.visible', () => {
    const data = getData();
    const list = data.lists[state.listId];
    if (!list) return [];

    const roots = state.hoistId ? [state.hoistId] : (list.root_tasks || []);
    const visible = [];

    walkTasks(roots, data.tasks, task => {
      if (!data.settings.showCompleted && task.status !== 0) return skipChildren;
      visible.push(task.id);
      if (task._collapsed) return skipChildren;
    });

    return visible;
  });

  app.queryService.register('tasks.filterIds', payload => {
    const data = getData();
    const ids = payload.ids || [];
    const q = String(payload.q || '').toLowerCase();

    const match = id => {
      const t = data.tasks[id];
      if (!t || t.deleted) return false;
      const tm = q.match(/#([\w-]+)/);
      const am = q.match(/@([\w-]+)/);
      const cm = q.match(/(?:color|priority):(\d)/);
      const hm = q.match(/has:(attachment|note|hyperlink)/);
      const im2 = q.match(/in:(open|closed|all)/);
      const dm = q.match(/\^([\w-]+)/);
      let ok = true;
      if (tm) ok = ok && (t.tags_as_text || '').toLowerCase().includes(tm[1]);
      if (am) ok = ok && (t.assignees || []).some(a => a.toLowerCase().includes(am[1]));
      if (cm) ok = ok && t.color === +cm[1];
      if (hm) {
        const a2 = hm[1];
        if (a2 === 'note') ok = ok && t.comments_count > 0;
        if (a2 === 'attachment') ok = ok && (t.attachments || []).length > 0;
        if (a2 === 'hyperlink') ok = ok && /https?:\/\//.test(t.content);
      }
      if (im2) {
        const f = im2[1];
        if (f === 'open') ok = ok && t.status === 0;
        if (f === 'closed') ok = ok && t.status === 1;
      }
      if (dm) {
        const p = dm[1], td = todayS(), tm2 = tomorrowS();
        if (p === 'today') ok = ok && t.due === td;
        else if (p === 'tomorrow') ok = ok && t.due === tm2;
        else if (p === 'asap') ok = ok && t.due_asap;
        else if (p === 'overdue') ok = ok && !!t.due && t.due < td;
        else if (p === 'any') ok = ok && (!!t.due || t.due_asap);
        else if (p === 'none') ok = ok && !t.due && !t.due_asap;
        else if (p === 'now') ok = ok && (t.due_asap || (!!t.due && t.due <= td));
      }
      const plain = q
        .replace(/#[\w-]+/g, '')
        .replace(/@[\w-]+/g, '')
        .replace(/\^[\w-]+/g, '')
        .replace(/\w+:\S+/g, '')
        .trim();
      if (plain) ok = ok && t.content.toLowerCase().includes(plain);
      return ok;
    };

    const hasMatchingDescendant = (task, fn) => {
      let found = false;
      walkTasks(task.tasks || [], data.tasks, child => {
        if (fn(child.id)) {
          found = true;
          return skipChildren;
        }
      });
      return found;
    };

    return ids.filter(id => match(id) || (data.tasks[id] && hasMatchingDescendant(data.tasks[id], match)));
  });

  app.queryService.register('due.sections', () => {
    const data = getData();
    const tasks = Object.values(data.tasks).filter(t => !t.deleted && (t.due || t.due_asap));
    const td = todayS();
    const tm = tomorrowS();
    const sections = [
      { title: 'Overdue', filter: t => !!t.due && t.due < td },
      { title: 'ASAP', filter: t => t.due_asap },
      { title: 'Today', filter: t => t.due === td },
      { title: 'Tomorrow', filter: t => t.due === tm },
      { title: 'Upcoming', filter: t => !!t.due && t.due > tm },
      { title: 'Repeating', filter: t => !!t.repeating_due }
    ];

    return sections
      .map(sec => ({
        title: sec.title,
        items: tasks.filter(sec.filter).sort((a, b) => cmpDate(a.due, b.due))
      }))
      .filter(sec => sec.items.length > 0);
  });

  app.queryService.register('tags.cloud', () => {
    const data = getData();
    const map = {};
    Object.values(data.tasks).filter(t => !t.deleted).forEach(t => {
      Object.keys(t.tags || {}).forEach(tg => {
        if (!map[tg]) map[tg] = 0;
        map[tg]++;
      });
    });
    const tags = Object.keys(map).sort();
    return { map, tags };
  });

  app.queryService.register('export.output', payload => {
    const data = getData();
    const fmt = payload.fmt;
    const scope = payload.scope;
    const notes = !!payload.notes;
    const done = !!payload.done;
    const list = data.lists[state.listId];
    const rootIds = scope === 'sel' && state.selId ? [state.selId] : (list ? list.root_tasks : []);

    if (fmt === 'json') {
      const tasks = app.flatIds(rootIds).map(id => data.tasks[id]).filter(Boolean);
      return JSON.stringify({ list: list ? { id: list.id, name: list.name } : {}, tasks }, null, 2);
    }
    if (fmt === 'markdown') return app.expMD(rootIds, 0, notes, done);
    if (fmt === 'opml') return app.expOPML(rootIds, notes, done);
    return app.expTXT(rootIds, 0, notes, done);
  });

  app.queryService.register('move.searchTargets', payload => {
    const data = getData();
    const q = String(payload.q || '').toLowerCase();
    const lists = Object.values(data.lists)
      .filter(l => !q || l.name.toLowerCase().includes(q))
      .map(l => ({ id: l.id, name: l.name }));

    const tasks = !q ? [] : Object.values(data.tasks)
      .filter(t => !t.deleted && t.content.toLowerCase().includes(q))
      .map(t => ({
        id: t.id,
        content: t.content.slice(0, 50),
        listName: data.lists[t.checklist_id] ? data.lists[t.checklist_id].name : ''
      }));

    return { lists, tasks, esc };
  });

  app.queryService.register('stats.wordCount', payload => {
    const data = getData();
    const ids = payload.ids || [];
    let allText = '';
    walkTasks(ids, data.tasks, task => {
      allText += task.content + ' ';
    });
    return {
      words: allText.trim().split(/\s+/).filter(Boolean).length,
      chars: allText.replace(/\s/g, '').length,
      charsWithSpaces: allText.trim().length
    };
  });

  app.queryService.register('stats.progress', payload => {
    const data = getData();
    const id = payload.id;
    const root = data.tasks[id];
    if (!root) return null;

    let open = 0;
    let total = 0;
    walkTasks(root.tasks || [], data.tasks, task => {
      total++;
      if (task.status === 0) open++;
    });
    return { open, total, done: total - open };
  });

  app.queryService.register('report.rows', payload => {
    const data = getData();
    const start = String(payload.start || '').trim();
    const end = String(payload.end || '').trim();
    const startMs = Date.parse(`${start}T00:00:00.000Z`);
    const endMs = Date.parse(`${end}T23:59:59.999Z`);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return [];

    const inRange = iso => {
      const ms = Date.parse(String(iso || ''));
      return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
    };

    const list = data.lists[state.listId];
    if (!list) return [];

    const rows = [];
    const seenIds = new Set();

    const classify = (task, deletedAt) => {
      const history = Array.isArray(task.history) ? task.history : [];
      const added = inRange(task.created_at) || history.some(h => h?.type === 'creation' && inRange(h.at));
      const deleted = !!deletedAt && inRange(deletedAt)
        || history.some(h => h?.type === 'deletion' && inRange(h.at));
      const completed = inRange(task.completed_at)
        || history.some(h => h?.type === 'status' && Number(h?.changes?.to) === 1 && inRange(h.at));
      const modified = inRange(task.updated_at)
        || history.some(h => ['title', 'tags', 'assignment', 'scheduling', 'priority', 'notes', 'structure'].includes(h?.type) && inRange(h.at));

      if (deleted) return 'deleted';
      if (completed) return 'completed';
      if (added) return 'added';
      if (modified) return 'modified';
      return 'untouched';
    };

    const addRow = (task, depth, deletedAt) => {
      if (!task || seenIds.has(task.id)) return;
      seenIds.add(task.id);
      rows.push({
        id: task.id,
        content: task.content || '',
        depth: Math.max(0, depth || 0),
        statusKey: classify(task, deletedAt)
      });
    };

    const walkList = (ids, depth) => {
      for (const id of ids || []) {
        const t = data.tasks[id];
        if (!t || t.deleted) continue;
        addRow(t, depth, '');
        walkList(t.tasks || [], depth + 1);
      }
    };

    walkList(list.root_tasks || [], 0);

    for (const item of (data.deletedItems || [])) {
      const snap = item?.snapshot;
      if (!snap || snap.checklist_id !== state.listId) continue;
      addRow(snap, 0, item.deletedAt || snap._deleted_at || '');
    }

    return rows;
  });

  app.queryService.register('cp.listTargets', () => {
    const data = getData();
    return Object.values(data.lists)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(l => ({ id: l.id, name: l.name }));
  });
}
