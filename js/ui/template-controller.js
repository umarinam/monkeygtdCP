'use strict';

function templateNamePromptText(task) {
  const content = String(task.content || '').trim();
  const short = content.length > 60 ? `${content.slice(0, 57)}...` : content;
  return `Template name (leave blank to use "${short}"):`;
}

function selectedTaskUi(state) {
  const t = state.selId ? state.data.tasks[state.selId] : null;
  return t && !t.deleted ? t : null;
}

function toggleTemplateSelectionUi(app, state) {
  const t = selectedTaskUi(state);
  if (!t) {
    app.toast('Select a task to mark as a template');
    return;
  }

  if (t.is_template) {
    const name = templateNameDomain(t);
    app.dispatch('task.unmarkTemplate', { id: t.id });
    app.render();
    app.toast(`"${name}" is no longer a template (Ctrl+Z to undo)`);
    return;
  }

  const name = prompt(templateNamePromptText(t), '');
  if (name === null) return;
  app.dispatch('task.markTemplate', { id: t.id, name });
  app.render();
  const hasSubtasks = (t.tasks || []).some(id => state.data.tasks[id] && !state.data.tasks[id].deleted);
  app.toast(hasSubtasks
    ? `Saved template "${templateNameDomain(t)}" - apply it to a task with at`
    : `Saved template "${templateNameDomain(t)}" - add sub-tasks to it`);
}

function renameTemplateSelectionUi(app, state) {
  const t = selectedTaskUi(state);
  if (!t || !t.is_template) {
    app.toast('Select a template to rename');
    return;
  }

  const name = prompt(templateNamePromptText(t), t.template_name || '');
  if (name === null || name.trim() === String(t.template_name || '').trim()) return;
  app.dispatch('task.markTemplate', { id: t.id, name });
  app.render();
  app.toast(`Template renamed to "${templateNameDomain(t)}"`);
}

function openTemplatePickerUi(app, state) {
  if (!app.selectedIds().length) {
    app.toast('Select a task to apply a template to');
    return;
  }
  if (!app.select('templates.all').length) {
    app.toast('No templates yet - select a task with sub-tasks and press mt');
    return;
  }
  app.openCP('templates');
}

function applyTemplateSelectionUi(app, state, templateId) {
  const tpl = state.data.tasks[templateId];
  if (!tpl || tpl.deleted) return;
  const targetIds = app.selectedIds();
  if (!targetIds.length) {
    app.toast('Select a task to apply a template to');
    return;
  }

  const name = templateNameDomain(tpl);
  const result = app.dispatch('task.applyTemplate', { templateId, targetIds });
  if (!result || !result.created) {
    app.toast(`Template "${name}" has no sub-tasks to add`);
    return;
  }

  app.render();
  const added = `${result.created} task${result.created === 1 ? '' : 's'} added`;
  app.toast(result.applied === 1
    ? `Applied "${name}" (${added})`
    : `Applied "${name}" to ${result.applied} tasks (${added})`);
}
