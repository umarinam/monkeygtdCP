'use strict';

// Weekly report export: turns "what changed between two dates" into an
// indented Markdown outline an LLM can turn into a status report. Pure domain
// code (data in, text out) so it can be used from the query bus and unit tests.

const WEEKLY_REPORT_PROMPT = [
  'You are helping me write my weekly status report from an export of my task manager (an outliner).',
  '',
  'HOW TO READ THE EXPORT',
  '- Indentation is hierarchy: top levels are projects, middle levels are milestones/workstreams, leaves are individual tasks. Untagged lines are unchanged ancestors kept only for context. Never report them as work done.',
  '- [DONE mm-dd] = accomplished this period. Report as accomplishments, grouped by project and milestone.',
  '- [NEW mm-dd] = added this period. Do NOT present these as delivered. A new project or task means research, scoping, or solution/architecture design time. Describe it as "explored / scoped / designed / planned", inferring the topic from the title and its parent. A new list is a new area of work.',
  '- A task can carry several tags, e.g. [NEW 10-01] [DONE 10-02]: created and finished within the week. Report it as an accomplishment.',
  '- [EDIT mm-dd] = refined or re-planned, or it received notes. Mention only if it adds meaning (scope change, new direction).',
  '- [DROPPED mm-dd] = cancelled or removed. Mention briefly as descoped if significant.',
  '- [REOPENED mm-dd] = was finished, now open again. Flag as rework.',
  '- "note (mm-dd)" lines are evidence of what was actually done. Use them for detail.',
  '- The "Upcoming" section lists open tasks that are overdue or due soon, as Project > Milestone > Task. Use it for "Next week" and "Risks / Blockers".',
  '',
  'RULES',
  '- Use only what is in the export. Do not invent outcomes, metrics, dates, people or causes. If a title is ambiguous, describe it plainly rather than guessing. Put anything significant but under-specified under "Questions for me" instead of embellishing.',
  '- Rewrite terse task titles into plain professional language. Merge related tasks into one bullet. Lead with outcomes and progress per project, not a task-by-task dump. Order projects by amount of activity.',
  '- No task IDs, tag syntax or tool jargon in the output.',
  '- Overdue, blocked or reopened items go under "Risks / Blockers".',
  '- If there is no Upcoming section, write "Next week" only from open work implied by the export, and say it is inferred.',
  '',
  'PRODUCE ALL THREE',
  '1. EMAIL: subject line; 2-sentence summary; a section per project with 2-4 bullets; Risks / Blockers; Next week. Max 300 words.',
  '2. SPOKEN (for a meeting, about 90 seconds, about 200 words): plain flowing sentences, no bullets or symbols, written to be read aloud. Open with the headline, cover the 2-3 most active projects, close with next week.',
  '3. QUESTIONS FOR ME: anything you could not determine from the export.',
  '',
  'Tone: factual, first person, past tense for completed work, no filler or hype.'
].join('\n');

function buildWeeklyReportDomain(data, options) {
  const opts = options || {};
  const counts = { done: 0, new: 0, edited: 0, dropped: 0, reopened: 0, newLists: 0 };
  const empty = error => ({ text: '', counts, error });

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const start = String(opts.start || '').trim();
  const end = String(opts.end || '').trim();
  if (!data || !dateRe.test(start) || !dateRe.test(end)) return empty('Pick a valid date range');

  // Local-day boundaries so a task finished at 9pm still lands on that day.
  const startMs = new Date(`${start}T00:00:00`).getTime();
  const endMs = new Date(`${end}T23:59:59.999`).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) {
    return empty('Pick a valid date range');
  }

  const pad2 = n => String(n).padStart(2, '0');
  const mdOf = iso => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  };
  const ymdOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const inRange = iso => {
    const ms = Date.parse(String(iso || ''));
    return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
  };
  const clean = s => String(s || '')
    .replace(/\[([^\]]*)\]\(#[^)]*\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  const lists = data.lists || {};
  const tasks = data.tasks || {};
  const listIds = opts.scope === 'current'
    ? [opts.currentListId].filter(id => lists[id])
    : Object.keys(lists);
  const listSet = new Set(listIds);

  const lastAt = entries => (entries.length ? entries[entries.length - 1].at : '');

  // One independent flag per kind of change, so a task created and finished in
  // the same week is both NEW and DONE instead of collapsing into one status.
  const eventsFor = t => {
    const history = Array.isArray(t.history) ? t.history : [];
    const hist = (type, pred) => history.filter(
      h => h && h.type === type && inRange(h.at) && (!pred || pred(h.changes || {}))
    );
    const status = Number(t.status || 0);
    const ev = { newAt: '', doneAt: '', droppedAt: '', droppedBy: '', reopenedAt: '', editAt: '', notes: [] };

    if (inRange(t.created_at)) ev.newAt = t.created_at;
    else ev.newAt = lastAt(hist('creation', c => c.source !== 'restore'));

    if (status === 1) {
      ev.doneAt = inRange(t.completed_at) ? t.completed_at : lastAt(hist('status', c => Number(c.to) === 1));
    } else if (status === 0 && t.repeating_due && inRange(t.completed_at)) {
      // Completing a recurring task re-opens it immediately and logs no status change.
      ev.doneAt = t.completed_at;
    }

    if (status === 2) {
      ev.droppedAt = inRange(t.completed_at) ? t.completed_at : lastAt(hist('status', c => Number(c.to) === 2));
      ev.droppedBy = ev.droppedAt ? 'invalidate' : '';
    } else if (t.deleted && status !== 1) {
      ev.droppedAt = lastAt(hist('deletion', c => c.action === 'soft-delete'))
        || (inRange(t._deleted_at) ? t._deleted_at : '');
      ev.droppedBy = ev.droppedAt ? 'delete' : '';
    }

    if (status === 0 && !ev.doneAt) {
      ev.reopenedAt = lastAt(hist('status', c => (
        Number(c.from) === 1 && Number(c.to) === 0 && c.source !== 'reset-completed'
      )));
    }

    // A blank-to-text title change is just the task being typed in, not an edit.
    ev.editAt = lastAt(hist('title', c => !c.source && String(c.from || '').trim() !== '' && c.from !== c.to));
    ev.notes = (Array.isArray(t.notes) ? t.notes : []).filter(
      n => n && clean(n.content) && (inRange(n.created_at) || inRange(n.updated_at))
    );

    // Created and deleted in the same week is a typo or false start, not work.
    if (ev.newAt && ev.droppedBy === 'delete') return null;
    return ev;
  };

  const hasEvents = ev => !!(ev.newAt || ev.doneAt || ev.droppedAt || ev.reopenedAt || ev.editAt || ev.notes.length);

  const eventsById = new Map();
  for (const t of Object.values(tasks)) {
    if (!t || !listSet.has(t.checklist_id) || !clean(t.content)) continue;
    const ev = eventsFor(t);
    if (ev && hasEvents(ev)) eventsById.set(t.id, ev);
  }

  // Deleting a branch logs a deletion on every descendant; report only the branch root.
  for (const [id, ev] of [...eventsById]) {
    if (ev.droppedBy !== 'delete') continue;
    const parentEv = eventsById.get(tasks[id].parent_id);
    if (!parentEv || parentEv.droppedBy !== 'delete') continue;
    ev.droppedAt = '';
    ev.droppedBy = '';
    if (!hasEvents(ev)) eventsById.delete(id);
  }

  // Keep every ancestor of a changed task, untagged, so the hierarchy gives context.
  const visible = new Set(eventsById.keys());
  for (const id of eventsById.keys()) {
    let cur = tasks[id];
    for (let guard = 0; cur && cur.parent_id && guard < 100; guard++) {
      const parent = tasks[cur.parent_id];
      if (!parent) break;
      visible.add(parent.id);
      cur = parent;
    }
  }

  const childrenOf = new Map();
  const rootsOf = new Map();
  for (const id of visible) {
    const t = tasks[id];
    if (t.parent_id && tasks[t.parent_id]) {
      if (!childrenOf.has(t.parent_id)) childrenOf.set(t.parent_id, []);
      childrenOf.get(t.parent_id).push(id);
    } else {
      if (!rootsOf.has(t.checklist_id)) rootsOf.set(t.checklist_id, []);
      rootsOf.get(t.checklist_id).push(id);
    }
  }

  const sortSiblings = (ids, order) => {
    const at = id => {
      const i = (order || []).indexOf(id);
      return i < 0 ? Number.MAX_SAFE_INTEGER : i;
    };
    return ids.slice().sort((a, b) => (
      at(a) - at(b) || String(tasks[a].created_at || '').localeCompare(String(tasks[b].created_at || ''))
    ));
  };

  const truncate = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

  const taskLine = (t, ev) => {
    const tagParts = [];
    if (ev.newAt) tagParts.push(`[NEW ${mdOf(ev.newAt)}]`);
    if (ev.doneAt) tagParts.push(`[DONE ${mdOf(ev.doneAt)}]`);
    if (ev.droppedAt) tagParts.push(`[DROPPED ${mdOf(ev.droppedAt)}]`);
    if (ev.reopenedAt) tagParts.push(`[REOPENED ${mdOf(ev.reopenedAt)}]`);
    if (!tagParts.length) {
      const noteAt = ev.notes.length
        ? ev.notes.map(n => (inRange(n.updated_at) ? n.updated_at : n.created_at)).sort().pop()
        : '';
      tagParts.push(`[EDIT ${mdOf(ev.editAt || noteAt)}]`);
    }
    // Typed #tags and @assignees usually stay in the content text too; don't print them twice.
    const text = clean(t.content);
    const words = new Set(text.toLowerCase().split(' ').map(w => w.replace(/[.,;:!?)]+$/, '')));
    const meta = [
      ...Object.keys(t.tags || {}).map(l => `#${l}`),
      ...(t.assignees || []).map(a => `@${a}`)
    ].filter(token => !words.has(token.toLowerCase()));
    if (t.due) meta.push(`(due ${String(t.due).slice(0, 10)})`);
    return `${tagParts.join(' ')} ${text}${meta.length ? ` ${meta.join(' ')}` : ''}`;
  };

  const renderBranch = (id, depth, lines, seen) => {
    if (seen.has(id)) return;
    seen.add(id);
    const t = tasks[id];
    const ev = eventsById.get(id);
    const pad = '  '.repeat(depth);
    lines.push(`${pad}- ${ev ? taskLine(t, ev) : (clean(t.content) || '(untitled)')}`);
    if (ev) {
      for (const n of ev.notes) {
        const when = mdOf(inRange(n.updated_at) ? n.updated_at : n.created_at);
        lines.push(`${pad}  - note (${when}): ${truncate(clean(n.content), 400)}`);
      }
    }
    for (const childId of sortSiblings(childrenOf.get(id) || [], t.tasks)) {
      renderBranch(childId, depth + 1, lines, seen);
    }
  };

  for (const ev of eventsById.values()) {
    if (ev.newAt) counts.new++;
    if (ev.doneAt) counts.done++;
    if (ev.droppedAt) counts.dropped++;
    if (ev.reopenedAt) counts.reopened++;
    if (!ev.newAt && !ev.doneAt && !ev.droppedAt && !ev.reopenedAt && (ev.editAt || ev.notes.length)) counts.edited++;
  }

  const body = [];
  for (const listId of listIds) {
    const list = lists[listId];
    const listNew = inRange(list.created_at);
    const roots = rootsOf.get(listId) || [];
    if (!listNew && !roots.length) continue;
    if (listNew) counts.newLists++;
    body.push(`## ${clean(list.name) || '(untitled list)'}${listNew ? ` [NEW ${mdOf(list.created_at)}]` : ''}`);
    if (!roots.length) body.push('- (new list, no tasks yet)');
    const seen = new Set();
    for (const rootId of sortSiblings(roots, list.root_tasks)) renderBranch(rootId, 0, body, seen);
    body.push('');
  }

  const out = [
    '# Weekly Activity Export',
    `Period: ${start} to ${end} (local dates) · Scope: ${opts.scope === 'current'
      ? `list "${clean((lists[listIds[0]] || {}).name)}"`
      : `all lists (${listIds.length})`} · Generated: ${opts.generatedOn || ymdOf(new Date())}`,
    `Summary: ${counts.done} done · ${counts.new} new · ${counts.edited} edited · ${counts.dropped} dropped · ${counts.reopened} reopened · ${counts.newLists} new ${counts.newLists === 1 ? 'list' : 'lists'}`,
    '',
    'Legend: [DONE] completed · [NEW] created · [EDIT] title changed or notes added · [DROPPED] deleted or invalidated · [REOPENED] finished task opened again · untagged lines = unchanged context',
    ''
  ];

  if (body.length) out.push(...body);
  else out.push('No changes recorded in this period.', '');

  if (opts.includeUpcoming) {
    const days = Number.isFinite(opts.upcomingDays) ? opts.upcomingDays : 14;
    const limitDate = new Date(`${end}T00:00:00`);
    limitDate.setDate(limitDate.getDate() + days);
    const limit = ymdOf(limitDate);

    const crumb = t => {
      const names = [];
      for (let cur = t, guard = 0; cur && guard < 100; guard++) {
        names.unshift(clean(cur.content) || '(untitled)');
        cur = tasks[cur.parent_id];
      }
      return [clean((lists[t.checklist_id] || {}).name), ...names].filter(Boolean).join(' › ');
    };

    const upcoming = [];
    for (const t of Object.values(tasks)) {
      if (!t || t.deleted || Number(t.status || 0) !== 0 || !listSet.has(t.checklist_id) || !clean(t.content)) continue;
      const due = String(t.due || '').slice(0, 10);
      if (t.due_asap) upcoming.push({ key: '', tag: '[ASAP]', t });
      else if (dateRe.test(due) && due <= limit) {
        upcoming.push({ key: due, tag: due < end ? `[OVERDUE since ${due.slice(5)}]` : `[due ${due.slice(5)}]`, t });
      }
    }
    upcoming.sort((a, b) => a.key.localeCompare(b.key));

    out.push(`# Upcoming (open tasks overdue or due on or before ${limit})`);
    if (!upcoming.length) out.push('- (none)');
    for (const u of upcoming.slice(0, 50)) out.push(`- ${u.tag} ${crumb(u.t)}`);
    if (upcoming.length > 50) out.push(`- (+${upcoming.length - 50} more)`);
    out.push('');
  }

  const markdown = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  const text = opts.includePrompt
    ? `${WEEKLY_REPORT_PROMPT}\n\n--- EXPORT BELOW ---\n\n${markdown}`
    : markdown;
  return { text, counts, error: '' };
}
