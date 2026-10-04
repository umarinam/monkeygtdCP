'use strict';

// A template is any task flagged with is_template. Applying it copies the
// template's sub-tasks (not the template task itself) under another task.
// template_name is optional; when blank the template is named after the task.

function templateNameDomain(task) {
  if (!task) return '';
  return String(task.template_name || '').trim()
    || String(task.content || '').trim()
    || 'Untitled template';
}

function templateBranchesDomain(state, templateId) {
  const tasks = state.data.tasks;
  const seen = new Set();
  const snapshot = id => {
    const t = tasks[id];
    if (!t || t.deleted || seen.has(id)) return null;
    seen.add(id);
    return { task: t, children: (t.tasks || []).map(snapshot).filter(Boolean) };
  };
  return (tasks[templateId]?.tasks || []).map(snapshot).filter(Boolean);
}

function countTemplateBranchTasks(branches) {
  return branches.reduce((n, b) => n + 1 + countTemplateBranchTasks(b.children), 0);
}

function listTemplatesDomain(state) {
  const data = state.data;
  return Object.values(data.tasks || {})
    .filter(t => t && t.is_template && !t.deleted && data.lists?.[t.checklist_id])
    .map(t => ({
      id: t.id,
      name: templateNameDomain(t),
      listName: data.lists[t.checklist_id].name || '',
      count: countTemplateBranchTasks(templateBranchesDomain(state, t.id))
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

// Marks a task as a template, or renames it when it already is one.
function markTemplateDomain(app, state, id, name) {
  const t = state.data.tasks[id];
  if (!t || t.deleted) return false;

  app.pushUndo(app.snap());
  const before = t.is_template ? templateNameDomain(t) : '';
  t.is_template = true;
  t.template_name = String(name || '').trim();
  t.updated_at = now();
  const after = templateNameDomain(t);
  if (before !== after) logTaskHistory(t, 'template', { from: before, to: after });
  app.save();
  return true;
}

function unmarkTemplateDomain(app, state, id) {
  const t = state.data.tasks[id];
  if (!t || !t.is_template) return false;

  app.pushUndo(app.snap());
  const before = templateNameDomain(t);
  delete t.is_template;
  delete t.template_name;
  t.updated_at = now();
  logTaskHistory(t, 'template', { from: before, to: '' });
  app.save();
  return true;
}

// Copies the template's sub-tasks under every target as fresh open tasks.
// The template branch is snapshotted once up front, so applying a template to
// itself or to one of its own sub-tasks copies it exactly once per target.
function applyTemplateDomain(app, state, templateId, targetIds) {
  const result = { applied: 0, created: 0 };
  const tpl = state.data.tasks[templateId];
  if (!tpl || tpl.deleted || !tpl.is_template) return result;

  const targets = [...new Set(targetIds || [])]
    .map(id => state.data.tasks[id])
    .filter(t => t && !t.deleted);
  const branches = templateBranchesDomain(state, templateId);
  if (!targets.length || !branches.length) return result;

  app.pushUndo(app.snap());
  const stamp = now();

  const materialize = (node, parent) => {
    const copy = JSON.parse(JSON.stringify(node.task));
    delete copy.is_template;
    delete copy.template_name;
    delete copy._deleted_at;
    delete copy.overdue_ack_due;
    Object.assign(copy, {
      id: uid(),
      parent_id: parent.id,
      checklist_id: parent.checklist_id,
      status: 0,
      completed_at: '',
      deleted: false,
      history: [],
      created_at: stamp,
      updated_at: stamp
    });
    state.data.tasks[copy.id] = copy;
    copy.tasks = node.children.map(child => materialize(child, copy));
    logTaskHistory(copy, 'creation', {
      source: 'template',
      templateId: tpl.id,
      listId: copy.checklist_id,
      parentId: copy.parent_id
    });
    result.created += 1;
    return copy.id;
  };

  for (const target of targets) {
    const newIds = branches.map(branch => materialize(branch, target));
    target.tasks = [...(target.tasks || []), ...newIds];
    target._collapsed = false;
    result.applied += 1;
  }

  app.save();
  return result;
}
