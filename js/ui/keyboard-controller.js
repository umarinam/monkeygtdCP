'use strict';

function bindGlobalEvents(app, state) {
  document.addEventListener('keydown', e => app.handleKey(e));

  const srch = document.getElementById('search');
  srch.addEventListener('input', () => {
    applySearchInputUi(app, state, srch.value);
  });
  srch.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      app.clearSearch();
      srch.blur();
    }
  });

  document.getElementById('cpi').addEventListener('input', () => app.updateCP());
  document.getElementById('cpi').addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      state.cpIdx = Math.min(state.cpIdx + 1, state.cpItems.length - 1);
      app.renderCPItems();
      e.preventDefault();
    }
    if (e.key === 'ArrowUp') {
      state.cpIdx = Math.max(state.cpIdx - 1, 0);
      app.renderCPItems();
      e.preventDefault();
    }
    if (e.key === 'Enter') {
      app.execCP(state.cpIdx);
      e.preventDefault();
    }
    if (e.key === 'Escape') app.closeCP();
  });

  document.getElementById('tag-in').addEventListener('input', () => app.updateTagAC());
  document.getElementById('tag-in').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      app.addTagFromInput();
    }
    if (e.key === 'Escape') app.closeModal('ov-tags');
  });

  document.getElementById('move-q').addEventListener('input', () => app.updateMoveR());
}

function handleGlobalKey(app, state, e) {
  const tag = document.activeElement?.tagName;
  const inIn = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  const anyModal = [...'due repeat tags notes move sort export import restore wc settings task-json task-history shortcuts'.split(' ')].some(
    n => !document.getElementById(`ov-${n}`).classList.contains('hidden')
  );
  const cpOpen = !document.getElementById('ov-cp').classList.contains('hidden');

  if (cpOpen || anyModal) {
    if (e.key === 'Escape') {
      app.closeAll();
      e.preventDefault();
    }
    return;
  }

  if (e.key === '/' && !inIn) {
    e.preventDefault();
    document.getElementById('search').focus();
    return;
  }
  if (e.key === '?' && !inIn) {
    e.preventDefault();
    app.showShortcuts();
    return;
  }
  if (state.editId) return;

  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    app.undo();
    return;
  }

  if (e.key === 'Escape') {
    if (state.msel.size) {
      state.msel.clear();
      app.render();
      return;
    }
    if (state.hoistId) {
      app.unHoist();
      return;
    }
    if (state.filter) {
      app.clearSearch();
      return;
    }
    state.selId = null;
    app.render();
    return;
  }

  if (inIn) return;

  // Continue pending two-key sequences (e.g. tj) before single-key navigation handlers.
  if (!e.ctrlKey && !e.altKey && !e.metaKey && state.kbuf && /^[a-z]$/i.test(e.key)) {
    e.preventDefault();
    app.twoKey(e);
    return;
  }

  if ((e.key === 'ArrowDown' || e.key === 'j') && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    app.navDown();
    return;
  }
  if ((e.key === 'ArrowUp' || e.key === 'k') && !e.shiftKey && !e.ctrlKey) {
    e.preventDefault();
    app.navUp();
    return;
  }
  if (e.key === 'ArrowDown' && e.shiftKey) {
    e.preventDefault();
    app.extDown();
    return;
  }
  if (e.key === 'ArrowUp' && e.shiftKey) {
    e.preventDefault();
    app.extUp();
    return;
  }
  if (e.key === 'ArrowLeft' && !e.shiftKey) {
    e.preventDefault();
    const t = state.data.tasks[state.selId];
    if (t && t.tasks && t.tasks.length && !t._collapsed) {
      t._collapsed = true;
      app.renderList();
    } else if (t && t.parent_id) {
      state.selId = t.parent_id;
      app.renderList();
    }
    return;
  }
  if (e.key === 'ArrowRight' && !e.shiftKey) {
    e.preventDefault();
    const t = state.data.tasks[state.selId];
    if (t && t._collapsed) {
      t._collapsed = false;
      app.renderList();
    } else if (t && t.tasks && t.tasks.length) {
      state.selId = t.tasks[0];
      app.renderList();
    }
    return;
  }
  if (e.key === 'ArrowLeft' && e.shiftKey) {
    e.preventDefault();
    app.unHoist();
    return;
  }
  if (e.key === 'ArrowRight' && e.shiftKey) {
    e.preventDefault();
    if (state.selId) app.hoistTask(state.selId);
    return;
  }
  if (e.key === 'Home') {
    e.preventDefault();
    const v = app.visible();
    if (v.length) {
      state.selId = v[0];
      app.renderList();
    }
    return;
  }
  if (e.key === 'End') {
    e.preventDefault();
    const v = app.visible();
    if (v.length) {
      state.selId = v[v.length - 1];
      app.renderList();
    }
    return;
  }
  if (e.key === 'PageDown') {
    e.preventDefault();
    const v = app.visible();
    const i = v.indexOf(state.selId);
    state.selId = v[Math.min(i + 10, v.length - 1)] || v[0];
    app.renderList();
    return;
  }
  if (e.key === 'PageUp') {
    e.preventDefault();
    const v = app.visible();
    const i = v.indexOf(state.selId);
    state.selId = v[Math.max(i - 10, 0)] || v[0];
    app.renderList();
    return;
  }
  if (e.key === 'F2') {
    e.preventDefault();
    if (state.selId) app.startEdit(state.selId);
    return;
  }
  if (e.key === 'Enter' && !e.altKey && !e.shiftKey) {
    e.preventDefault();
    const nid = app.dispatch('task.add', { afterId: state.selId, asChild: false, content: '' });
    state.selId = nid;
    app.renderList();
    app.startEdit(nid);
    return;
  }
  if (e.key === 'Enter' && e.shiftKey && !e.altKey) {
    e.preventDefault();
    if (state.selId) {
      const nid = app.dispatch('task.add', { afterId: state.selId, asChild: true, content: '' });
      state.selId = nid;
      app.renderList();
      app.startEdit(nid);
    }
    return;
  }
  if (e.key === 'Enter' && e.altKey) {
    e.preventDefault();
    if (state.selId) {
      const nid = app.addAbove(state.selId);
      state.selId = nid;
      app.renderList();
      app.startEdit(nid);
    }
    return;
  }
  if (e.key === 'Delete') {
    e.preventDefault();
    if (state.selId) app.dispatch('task.delete', { id: state.selId });
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    if (state.selId) {
      if (e.shiftKey) app.unindent(state.selId);
      else app.indent(state.selId);
    }
    return;
  }
  if (e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    if (state.selId) {
      if (e.shiftKey) app.invalidate(state.selId);
      else app.dispatch('task.toggleStatus', { id: state.selId });
    }
    return;
  }
  if (e.ctrlKey && e.key === 'ArrowUp') {
    e.preventDefault();
    if (state.selId) app.moveUp(state.selId);
    return;
  }
  if (e.ctrlKey && e.key === 'ArrowDown') {
    e.preventDefault();
    if (state.selId) app.moveDown(state.selId);
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'ArrowRight') {
    e.preventDefault();
    app.expandAll();
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'ArrowLeft') {
    e.preventDefault();
    app.collapseAll();
    return;
  }
  if (e.ctrlKey && e.key === 'a') {
    e.preventDefault();
    state.msel = new Set(app.visible());
    app.renderList();
    return;
  }
  if (e.ctrlKey && !e.shiftKey && e.key === 'c') {
    e.preventDefault();
    app.copy();
    return;
  }
  if (e.ctrlKey && e.key === 'x') {
    e.preventDefault();
    app.cut();
    return;
  }
  if (e.ctrlKey && e.key === 'v') {
    e.preventDefault();
    app.paste();
    return;
  }
  if (e.ctrlKey && e.key === 'd') {
    e.preventDefault();
    app.dup(state.selId);
    return;
  }
  if (e.ctrlKey && e.shiftKey && e.key === 'C') {
    e.preventDefault();
    app.copyWithUrl();
    return;
  }
  if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
    e.preventDefault();
    if (state.selId) {
      app.pushUndo(app.snap());
      const t = state.data.tasks[state.selId];
      const before = Number(t.color || 0);
      t.color = +e.key;
      if (before !== Number(t.color || 0)) {
        logTaskHistory(t, 'priority', { from: before, to: Number(t.color || 0) });
      }
      app.save();
      app.renderList();
    }
    return;
  }

  app.twoKey(e);
}

function handleTwoKeySequence(app, state, e) {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  if (!state.selId && !['g', 'l', 'o', 'h', 's'].includes(e.key)) return;
  if (e.key === 'Shift') {
    if (state.kbuf === 'Shift') {
      state.kbuf = '';
      app.clearKH();
      app.openCP();
      return;
    }
  }

  state.kbuf += e.key;
  clearTimeout(state.kbtimer);
  app.showKH(state.kbuf);

  const sc = {
    'ee': () => app.startEdit(state.selId),
    'ei': () => app.startEdit(state.selId, 'start'),
    'ea': () => app.startEdit(state.selId, 'end'),
    'dd': () => app.openDueModal(),
    'td': () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'today' }); },
    'tm': () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'tomorrow' }); },
    'as': () => { if (state.selId) app.dispatch('task.setDueQuick', { taskId: state.selId, preset: 'asap' }); },
    'cd': () => {
      if (state.selId) {
        app.pushUndo(app.snap());
        const t = state.data.tasks[state.selId];
        const before = { due: t.due || '', due_asap: !!t.due_asap, repeating_due: t.repeating_due ? 'set' : '' };
        const ts = Date.now();
        if (t.due || t.due_asap) {
          t.due = '';
          t.due_asap = false;
          state.lastCdAt = ts;
          logTaskHistory(t, 'scheduling', {
            from: before,
            to: { due: t.due || '', due_asap: !!t.due_asap, repeating_due: t.repeating_due ? 'set' : '' }
          });
          app.save();
          app.render();
          app.toast(t.repeating_due ? 'Due cleared (press cd again to delete repeating)' : 'Due cleared');
          return;
        }
        if (t.repeating_due && (ts - state.lastCdAt) < 2000) {
          t.repeating_due = null;
          logTaskHistory(t, 'scheduling', {
            from: before,
            to: { due: t.due || '', due_asap: !!t.due_asap, repeating_due: '' }
          });
          app.save();
          app.render();
          app.toast('Repeating removed');
          state.lastCdAt = 0;
          return;
        }
        if (t.repeating_due) {
          state.lastCdAt = ts;
          app.toast('Press cd again to delete repeating');
        }
      }
    },
    'dr': () => { if (state.selId) app.openRepeatModal(); },
    'df': () => { state.data.settings.relativeDates = !state.data.settings.relativeDates; app.save(); app.render(); app.toast(`Dates: ${state.data.settings.relativeDates ? 'relative' : 'exact'}`); },
    'tt': () => { if (state.selId) app.openTagsModal(state.selId); },
    'th': () => { if (state.selId) app.openTaskHistory(state.selId); },
    'tj': () => { if (state.selId) app.openTaskJson(state.selId); },
    'ct': () => { if (state.selId) app.dispatch('task.clearTags', { taskId: state.selId }); },
    'gt': () => app.showPage('tags'),
    'gk': () => app.showPage('kanban'),
    'nn': () => { if (state.selId) app.openNotesModal(state.selId); },
    'cn': () => { if (state.selId) app.dispatch('task.clearNotes', { taskId: state.selId }); },
    'sn': () => { state.showNotes = !state.showNotes; app.render(); app.toast(`Notes ${state.showNotes ? 'visible' : 'hidden'}`); },
    'ae': () => app.assignTask(),
    'ca': () => {
      if (state.selId) {
        app.pushUndo(app.snap());
        const t = state.data.tasks[state.selId];
        const before = [...(t.assignees || [])];
        t.assignees = [];
        if (before.length) {
          logTaskHistory(t, 'assignment', { from: before, to: [] });
        }
        app.save();
        app.render();
      }
    },
    'hc': () => { state.data.settings.showCompleted = !state.data.settings.showCompleted; app.save(); app.render(); app.syncSettings(); app.toast(`Completed: ${state.data.settings.showCompleted ? 'visible' : 'hidden'}`); },
    'hf': () => { state.data.settings.hideFuture = !state.data.settings.hideFuture; app.save(); app.render(); app.syncSettings(); app.toast(`Future due: ${state.data.settings.hideFuture ? 'hidden' : 'visible'}`); },
    'sd': () => app.toggleDetails(),
    'pc': () => { if (state.selId) app.showProgress(state.selId); },
    'om': () => { app.setZen(!document.body.classList.contains('zen')); },
    'oo': () => app.openSettings(),
    'ss': () => app.openSortDlg(),
    'sm': () => app.runSmokeChecks(),
    'll': () => app.openCP('lists'),
    'gh': () => app.showPage('home'),
    'gd': () => app.showPage('due'),
    'gg': () => { if (state.selId) { const t = state.data.tasks[state.selId]; const m = t.content.match(/https?:\/\/\S+/); if (m) window.open(m[0], '_blank'); } },
    'mm': () => app.openMoveDlg(),
    'rd': () => app.showRestoreDeleted(),
    'wc': () => app.showWC(),
    'xx': () => app.extractBranch(),
    'uu': () => app.undo(),
    'st': () => { if (state.selId) { state.msel.has(state.selId) ? state.msel.delete(state.selId) : state.msel.add(state.selId); app.renderList(); } },
    'ec': () => app.toggleEC(),
    'ex': () => app.openExport(),
    'im': () => app.openImport(),
    'tc': () => app.copyPermalink(),
    'lc': () => app.copyPermalink()
  };

  const s4 = state.kbuf.slice(-4);
  const s5 = state.kbuf.slice(-5);
  if (s5 === 'reset') {
    app.resetCompleted();
    state.kbuf = '';
    app.clearKH();
    return;
  }
  if (s4 === 'wipe') {
    app.wipeCompleted();
    state.kbuf = '';
    app.clearKH();
    return;
  }

  if (state.kbuf.length >= 2) {
    const s2 = state.kbuf.slice(-2);
    if (sc[s2]) {
      e.preventDefault();
      if (state.selId || ['gt', 'gk', 'gh', 'gd', 'gg', 'om', 'oo', 'ss', 'll', 'rd', 'wc', 'im', 'ex'].includes(s2)) sc[s2]();
      state.kbuf = '';
      app.clearKH();
      return;
    }
  }

  state.kbtimer = setTimeout(() => {
    state.kbuf = '';
    app.clearKH();
  }, 1500);
}
