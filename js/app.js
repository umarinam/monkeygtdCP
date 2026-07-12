'use strict';

// â”€â”€ State â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const S={
  data:null, page:'list', listId:null, selId:null, editId:null, hoistId:null,
  msel:new Set(), filter:'', undos:[], redos:[], kbuf:'', kbtimer:null,
  undoBatchDepth:0,
  dragSrc:null, listMode:'create', listEditId:null,
  cpIdx:0, cpItems:[], cpMode:'', sortField:'alpha', calDate:new Date(),
  movePickIdx:0, moveTargets:[],
  pendingNewEditId:null, pendingNewEditPrevId:null,
  reportStart:'', reportEnd:'',
  reportFilters:{ added:true, modified:true, completed:true, deleted:true, untouched:true },
  showNotes:false, clipboard:null,
  lastClickId:'', lastClickAt:0,
  lastCdAt:0,
  iac:{open:false,taskId:null,type:'',query:'',start:0,end:0,items:[],index:0}
};

// â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const App={

  // â”€ Boot â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  init(){
    let d=DB.get(); if(!d){d=seedData();DB.save(d);}
    S.data=d; S.listId=d.currentListId||Object.keys(d.lists)[0];
    S.reportEnd=todayS();
    const reportStartDate=new Date();
    reportStartDate.setDate(reportStartDate.getDate()-7);
    S.reportStart=dateStr(reportStartDate);
    S.data.settings = S.data.settings || {};
    const gs=d.settings;
    if(gs.darkMode) document.documentElement.setAttribute('data-theme','dark');
    if(gs.zenMode) document.body.classList.add('zen');
    this.initCqrs();
    this.bindGlobal();
    this.render();
    this.syncSettings();
    if (S.data.settings.gistAutoSyncEnabled !== false) {
      this.checkGistOnRefresh();
    }
    this.startGistAutoSync();
  },

  save(){
    S.data.currentListId=S.listId;
    S.data.settings = S.data.settings || {};
    S.data.settings.gistLastLocalSaveAt = now();
    DB.save(S.data);
  },

  initCqrs(){
    this.commandBus = createCommandBus();
    this.queryService = createQueryService();

    registerAppCommands(this);
    registerAppReadModel(this, {
      state:S,
      walkTasks,
      skipChildren:SKIP_CHILDREN,
      todayS,
      tomorrowS,
      cmpDate,
      esc
    });
  },

  dispatch(name, payload){
    return this.commandBus.dispatch(name, payload);
  },

  select(name, payload){
    return this.queryService.select(name, payload);
  },

  // â”€ Undo â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  snap(){ return JSON.parse(JSON.stringify({tasks:S.data.tasks,lists:S.data.lists})); },
  pushUndo(sn){
    if (S.undoBatchDepth > 0) return;
    S.undos.push(sn);
    if(S.undos.length>60) S.undos.shift();
    S.redos = [];
  },
  pushRedo(sn){
    S.redos.push(sn);
    if(S.redos.length>60) S.redos.shift();
  },
  undo(){
    if(!S.undos.length){this.toast('Nothing to undo');return;}
    this.pushRedo(this.snap());
    const sn=S.undos.pop(); S.data.tasks=sn.tasks; S.data.lists=sn.lists;
    this.save(); this.render(); this.toast('Undone');
  },
  redo(){
    if(!S.redos.length){this.toast('Nothing to redo');return;}
    S.undos.push(this.snap());
    if(S.undos.length>60) S.undos.shift();
    const sn=S.redos.pop(); S.data.tasks=sn.tasks; S.data.lists=sn.lists;
    this.save(); this.render(); this.toast('Redone');
  },
  selectedIds(){
    const selected = S.msel.size ? new Set(S.msel) : new Set(S.selId ? [S.selId] : []);
    if (!selected.size) return [];

    const ordered = [];
    for (const id of this.visible()) {
      if (selected.has(id)) {
        ordered.push(id);
        selected.delete(id);
      }
    }
    for (const id of selected) ordered.push(id);

    return ordered.filter(id => {
      const t = S.data.tasks[id];
      return !!t && !t.deleted;
    });
  },
  selectedRootIds(ids){
    const ordered = Array.isArray(ids) ? ids : this.selectedIds();
    const selectedSet = new Set(ordered);
    return ordered.filter(id => {
      let p = S.data.tasks[id]?.parent_id;
      while (p) {
        if (selectedSet.has(p)) return false;
        p = S.data.tasks[p]?.parent_id;
      }
      return true;
    });
  },
  withUndoBatch(fn){
    this.pushUndo(this.snap());
    S.undoBatchDepth += 1;
    this._suppressToast = true;
    try {
      fn();
    } finally {
      this._suppressToast = false;
      S.undoBatchDepth = Math.max(0, S.undoBatchDepth - 1);
    }
  },
  deleteSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.delete', { id: ids[0] });
      return;
    }
    this.withUndoBatch(() => {
      for (const id of [...ids].reverse()) deleteTaskDomain(this, S, id);
    });
    S.msel.clear();
    if (!S.selId || !S.data.tasks[S.selId] || S.data.tasks[S.selId].deleted) {
      const vis = this.visible();
      S.selId = vis[0] || null;
    }
    this.save();
    this.render();
    this.toast(`Deleted ${ids.length} task(s)`);
  },
  toggleStatusSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.toggleStatus', { id: ids[0] });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => toggleStatusDomain(this, S, id)));
    this.save();
    this.render();
    this.toast(`Status toggled for ${ids.length} task(s)`);
  },
  invalidateSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.invalidate', { id: ids[0] });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => invalidateDomain(this, S, id)));
    this.save();
    this.render();
    this.toast(`Invalidated ${ids.length} task(s)`);
  },
  clearDueSelection(removeRepeat){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.clearDue', { taskId: ids[0], removeRepeat: !!removeRepeat });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => clearDueUi(this, S, id, true, !!removeRepeat)));
    this.save();
    this.render();
    this.toast(`Due cleared for ${ids.length} task(s)`);
  },
  clearTagsSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.clearTags', { taskId: ids[0] });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => clearTagsUi(this, S, id, true)));
    this.save();
    this.render();
    this.toast(`Tags cleared for ${ids.length} task(s)`);
  },
  addTagSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;

    if (ids.length === 1) {
      this.openTagsModal(ids[0]);
      return;
    }

    const raw = String(prompt('Tag to add:') || '')
      .trim()
      .replace(/^#/, '')
      .replace(/,/g, '')
      .trim();
    if (!raw) return;

    this.withUndoBatch(() => ids.forEach(id => {
      const t = S.data.tasks[id];
      if (!t) return;
      t.tags = t.tags || {};
      const before = t.tags_as_text || '';
      t.tags[raw] = { isPrivate: false };
      t.tags_as_text = Object.keys(t.tags).join(',');
      t.updated_at = now();
      if (before !== (t.tags_as_text || '')) {
        logTaskHistory(t, 'tags', { from: before, to: t.tags_as_text || '' });
      }
    }));

    this.save();
    this.render();
    this.toast(`Added #${raw} to ${ids.length} task(s)`);
  },
  clearNotesSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.clearNotes', { taskId: ids[0] });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => clearNotesUi(this, S, id, true)));
    this.save();
    this.render();
    this.toast(`Notes cleared for ${ids.length} task(s)`);
  },
  setDueQuickSelection(preset){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.dispatch('task.setDueQuick', { taskId: ids[0], preset });
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => setDueQuickUi(this, S, preset, true, id)));
    this.save();
    this.render();
    this.toast(`Due set (${preset}) for ${ids.length} task(s)`);
  },
  clearAssigneesSelection(){
    const ids = this.selectedIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      const t = S.data.tasks[ids[0]];
      if (!t) return;
      this.pushUndo(this.snap());
      const before = [...(t.assignees || [])];
      t.assignees = [];
      t.updated_at = now();
      if (before.length) {
        logTaskHistory(t, 'assignment', { from: before, to: [] });
      }
      this.save();
      this.render();
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => {
      const t = S.data.tasks[id];
      if (!t) return;
      const before = [...(t.assignees || [])];
      t.assignees = [];
      t.updated_at = now();
      if (before.length) {
        logTaskHistory(t, 'assignment', { from: before, to: [] });
      }
    }));
    this.save();
    this.render();
    this.toast(`Assignees cleared for ${ids.length} task(s)`);
  },
  moveUpSelection(){
    const ids = this.selectedRootIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.moveUp(ids[0]);
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => moveUpDomain(this, S, id)));
    this.save();
    this.renderList();
    this.toast(`Moved up ${ids.length} task(s)`);
  },
  moveDownSelection(){
    const ids = this.selectedRootIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.moveDown(ids[0]);
      return;
    }
    this.withUndoBatch(() => [...ids].reverse().forEach(id => moveDownDomain(this, S, id)));
    this.save();
    this.renderList();
    this.toast(`Moved down ${ids.length} task(s)`);
  },
  indentSelection(){
    const ids = this.selectedRootIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.indent(ids[0]);
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => indentDomain(this, S, id)));
    this.save();
    this.renderList();
    this.toast(`Indented ${ids.length} task(s)`);
  },
  unindentSelection(){
    const ids = this.selectedRootIds();
    if (!ids.length) return;
    if (ids.length === 1) {
      this.unindent(ids[0]);
      return;
    }
    this.withUndoBatch(() => ids.forEach(id => unindentDomain(this, S, id)));
    this.save();
    this.renderList();
    this.toast(`Un-indented ${ids.length} task(s)`);
  },

  // â”€ Pages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showPage(p){ showPageUi(this, S, p); },

  render(){ renderCurrentPageUi(this, S); },

  // â”€ Home â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderHome(){ renderHomeUi(S); },

  openList(id){ openListUi(this, S, id); },

  // â”€ List view â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderList(){ renderListUi(this, S); },

  buildTree(ids,depth,list){ return buildTaskTreeUi(this, S, ids, depth, list); },

  buildItem(id,depth,list){ return buildTaskItemUi(this, S, id, depth, list); },

  sibIdx(id){ return sibIndexUi(S, id); },

  filterIds(ids){ return filterIdsUi(this, S, ids); },

  renderBreadcrumbs(){ renderBreadcrumbsUi(this, S); },

  ancestors(id){ return ancestorsUi(S, id); },

  // â”€ Due page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderDue(){ renderDueUi(this, S); },

  renderReport(){ renderReportUi(this, S); },
  toggleReportFilter(key){
    if (!S.reportFilters || !(key in S.reportFilters)) return;
    S.reportFilters[key] = !S.reportFilters[key];
    this.renderReport();
  },

  renderKanban(){ renderKanbanUi(this, S); },
  addKanbanTaskFromInput(inputId,parentTaskId){ addKanbanTaskFromInputUi(this, S, inputId, parentTaskId); },
  setTaskStatus(id, targetStatus){
    const t = S.data.tasks[id];
    if (!t || t.deleted) return;

    const cur = Number(t.status || 0);
    const target = Number(targetStatus || 0);
    if (cur === target) return;

    if (target === 0) {
      if (cur === 1) this.toggleStatus(id);
      else if (cur === 2) this.invalidate(id);
      return;
    }

    if (target === 1) {
      if (cur === 0) this.toggleStatus(id);
      else if (cur === 2) {
        this.invalidate(id);
        this.toggleStatus(id);
      }
      return;
    }

    if (target === 2) {
      this.invalidate(id);
    }
  },

  // â”€ Tags page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  renderTags(){ renderTagsUi(this); },

  filterTag(tg){ filterTagUi(this, S, tg); },

  // â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  bindGlobal(){ bindGlobalEvents(this, S); },

  bindTaskEvents(){ bindTaskListEvents(this, S); },

  scrollSel(){ scrollToSelectedTask(S); },

  // â”€ Visible IDs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  visible(){
    try{return this.select('tasks.visible');}
    catch{return [];}
  },

  // â”€ Task CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  addTask(afterId,asChild,content){ return addTaskDomain(this, S, afterId, asChild, content); },

  addAbove(refId){ return addAboveDomain(this, S, refId); },

  deleteTask(id){ deleteTaskDomain(this, S, id); },

  saveEdit(id,val){ saveEditDomain(this, S, id, val); },

  toggleStatus(id){ toggleStatusDomain(this, S, id); },

  advanceRecurringTask(t){ advanceRecurringTaskDomain(S, t); },

  invalidate(id){ invalidateDomain(this, S, id); },

  checkAutoClose(pid){ checkAutoCloseDomain(this, S, pid); },

  toggleCollapse(id){ toggleCollapseDomain(this, S, id); },

  // â”€ Move/Reorder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  sibList(id){ return sibListDomain(S, id); },

  moveUp(id){ moveUpDomain(this, S, id); },
  moveDown(id){ moveDownDomain(this, S, id); },

  moveBefore(srcId,tgtId){ moveBeforeDomain(this, S, srcId, tgtId); },

  indent(id){ indentDomain(this, S, id); },

  unindent(id){ unindentDomain(this, S, id); },

  // â”€ Edit mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startEdit(id,pos){ startEditUi(this, S, id, pos); },

  editKey(e,id){ editKeyUi(this, S, e, id); },

  commitEdit(id){ commitEditUi(this, S, id); },

  // â”€ Inline autocomplete (#tag / @assignee) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  isInlineAutocompleteOpen(){ return isInlineAutocompleteOpenUi(S); },

  hideInlineAutocomplete(){ hideInlineAutocompleteUi(S); },

  updateInlineAutocomplete(id,el){ updateInlineAutocompleteUi(this, S, id, el); },

  getTagSuggestions(q){ return getTagSuggestionsUi(S, q); },

  getAssigneeSuggestions(q){ return getAssigneeSuggestionsUi(S, q); },

  renderInlineAutocomplete(){ renderInlineAutocompleteUi(this, S); },

  moveInlineAutocomplete(dir){ moveInlineAutocompleteUi(this, S, dir); },

  acceptInlineAutocomplete(forceIdx){ acceptInlineAutocompleteUi(this, S, forceIdx); },
  twoKey(e){ handleTwoKeySequence(this, S, e); },
  handleKey(e){ handleGlobalKey(this, S, e); },

  showKH(b){const h=document.getElementById('kh');h.textContent=b;h.classList.add('on');},
  clearKH(){document.getElementById('kh').classList.remove('on');},

  // â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  navDown(){ navDownUi(this, S); },
  navUp(){ navUpUi(this, S); },
  extUp(){ extUpUi(this, S); },
  extDown(){ extDownUi(this, S); },

  expandAll(){ expandAllUi(this, S); },
  collapseAll(){ collapseAllUi(this, S); },
  toggleEC(){ toggleExpandCollapseUi(this, S); },

  hoistTask(id){ hoistTaskUi(this, S, id); },
  unHoist(){ unHoistUi(this, S); },

  // â”€ Copy/Paste â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  taskText(t,d){ return taskTextDomain(S, t, d); },
  copy(){ copyUi(this, S); },
  cut(){ cutUi(this, S); },
  paste(){ pasteUi(this, S); },
  dup(id){ dupUi(this, S, id); },
  copyWithUrl(){ copyWithUrlUi(this, S); },
  copyPermalink(){ copyPermalinkUi(this, S); },

  // â”€ Due date modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openDueModal(){ openDueModalUi(this, S); },
  renderCal(){ renderCalUi(this, S); },
  calPrev(){ calPrevUi(this, S); },
  calNext(){ calNextUi(this, S); },
  pickDate(ds){ pickDateUi(this, S, ds); },
  setDueQ(p,internal,taskId){ setDueQuickUi(this, S, p, internal, taskId); },
  clearDue(taskId,internal,removeRepeat){ clearDueUi(this, S, taskId, internal, removeRepeat); },

  // â”€ Repeating modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleRepeatWeekdays(){ toggleRepeatWeekdaysUi(); },
  openRepeatModal(){ openRepeatModalUi(this, S); },
  saveRepeatSettings(){ saveRepeatSettingsUi(this, S); },
  deleteRepeatSettings(){ deleteRepeatSettingsUi(this, S); },

  // â”€ Tags modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openTagsModal(id){ openTagsModalUi(this, S, id); },
  renderCurTags(){ renderCurrentTagsUi(this, S); },
  addTagFromInput(internal,payload){ addTagFromInputUi(this, S, internal, payload); },
  rmTag(tg,internal,taskId){ removeTagUi(this, S, tg, internal, taskId); },
  clearTags(taskId,internal){ clearTagsUi(this, S, taskId, internal); },
  updateTagAC(){ updateTagAutocompleteUi(S); },
  pickTag(tg){ pickTagUi(this, tg); },

  // â”€ Notes modal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openNotesModal(id){ openNotesModalUi(this, S, id); },
  renderNotes(id){ renderNotesUi(S, id); },
  addNote(internal,payload){ addNoteUi(this, S, internal, payload); },
  delNote(tid,nid,internal){ deleteNoteUi(this, S, tid, nid, internal); },
  clearNotes(taskId,internal){ clearNotesUi(this, S, taskId, internal); },

  openTaskJson(id){ openTaskJsonModalUi(this, S, id); },
  saveTaskJson(){ saveTaskJsonUi(this, S); },
  openTaskHistory(id){ openTaskHistoryUi(this, S, id); },

  // â”€ Assign â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  assignTask(internal,payload){
    assignTaskDomain(this, S, internal, payload);
  },

  // â”€ Sort â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openSortDlg(){ openSortDlgUi(this, S); },
  selSort(f){ selSortUi(S, f); this.openSortDlg(); },
  applySort(internal,payload){
    applySortDomain(this, S, internal, payload);
  },

  // â”€ Move â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openMoveDlg(){ openMoveDlgUi(this, S); },
  updateMoveR(){ updateMoveRUi(this, S); },
  handleMoveInputKey(e){ handleMoveInputKeyUi(this, S, e); },
  moveToList(lid,internal){
    if(!internal){
      this.dispatch('task.moveToList',{listId:lid});
      return;
    }
    moveToListDomain(this, S, lid);
  },
  moveToTask(tid,internal){
    if(!internal){
      this.dispatch('task.moveToTask',{taskId:tid});
      return;
    }
    moveToTaskDomain(this, S, tid);
  },

  // â”€ Export â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openExport(){ openExportUi(this); },
  refreshExport(){ refreshExportUi(this); },
  flatIds(ids){ return flatIdsDomain(S, ids, walkTasks); },
  expMD(ids,d,notes,done){ return exportMarkdownDomain(S, ids, d, notes, done, walkTasks, SKIP_CHILDREN); },
  expOPML(ids,notes,done){ return exportOpmlDomain(S, ids, notes, done, esc, S.listId); },
  expTXT(ids,d,notes,done){ return exportTextDomain(S, ids, d, notes, done, walkTasks, SKIP_CHILDREN); },
  copyExport(){ copyExportUi(); this.toast('Copied'); },
  downloadExport(){ downloadExportUi(S); this.toast('Downloaded'); },

  // â”€ Import â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openImport(){ openImportUi(this); },
  doImport(internal,payload){
    let fmt,pos,raw;
    if(!internal){
      fmt=document.getElementById('imp-fmt').value;
      pos=document.getElementById('imp-pos').value;
      raw=document.getElementById('imp-in').value.trim();
      if(!raw){this.toast('Nothing to import');return;}
      this.dispatch('task.import',{fmt,pos,raw});
      return;
    }
    doImportDomain(this, S, payload);
  },
  impText(text,list){ return importTextDomain(S, text, list, uid, mkTask); },
  impOPML(xml,list){ return importOpmlDomain(S, xml, list, uid, mkTask); },

  // â”€ Restore deleted â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showRestoreDeleted(){ showRestoreDeletedUi(this, S); },
  restoreSel(internal){
    if(!internal){this.dispatch('task.restoreSelected');return;}
    const checks=document.querySelectorAll('[data-del]:checked');
    const ids=[...checks].map(ch=>ch.dataset.del);
    restoreSelectedDomain(this, S, ids);
  },

  // â”€ Word count â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showWC(){ showWCUi(this, S); },
  showShortcuts(){ showShortcutsUi(this); },
  addOneNoteLink(){ addOneNoteLinkUi(this, S); },
  addEmailLink(){ addEmailLinkUi(this, S); },
  addFileLink(){ addFileLinkUi(this, S); },
  addWebLink(){ addWebLinkUi(this, S); },
  addLabeledWebLink(){ addLabeledWebLinkUi(this, S); },

  showStorageUsage(){ showStorageUsageUi(this, S); },

  // â”€ Progress â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  showProgress(id){ showProgressUi(this, S, id); },

  // â”€ Toggle details â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toggleDetails(){ toggleDetailsUi(this); },

  // â”€ Wipe / Reset â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  wipeCompleted(internal){
    if(!internal){ wipeCompletedUi(this, S); return; }
    wipeCompletedDomainUi(this, S);
  },
  resetCompleted(internal){
    if(!internal){ resetCompletedUi(this, S); return; }
    resetCompletedDomainUi(this, S);
  },

  // â”€ Extract branch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  extractBranch(internal){
    if(!internal){ extractBranchUi(this, S); return; }
    extractBranchDomainUi(this, S);
  },

  // â”€ List CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  createList(){ createListUi(this, S); },
  renameList(id){ renameListUi(this, S, id); },
  confirmList(){
    const name=document.getElementById('list-n').value.trim(); if(!name) return;
    const tags=(document.getElementById('list-t').value.match(/#([\w-]+)/g)||[]).map(t=>t.slice(1));
    confirmListDomain(this, S, name, tags, mkList, now);
  },
  archiveList(id){ archiveListDomain(this, S, id); },
  unarchiveList(id){ unarchiveListDomain(this, S, id); },
  deleteList(id){
    const l=S.data.lists[id];if(!l)return;
    if(!confirm(`Delete "${l.name}"?`))return;
    deleteListDomain(this, S, id);
  },

  jumpTo(id){ jumpToUi(this, S, id); },

  runSmokeChecks(){
    const rows = runAppSmokeChecks(this, S);
    const passed = rows.filter(r => r.pass).length;
    console.table(rows);
    this.toast(`Smoke checks: ${passed}/${rows.length} passed`);
  },

  // â”€ Settings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openSettings(){ openSettingsUi(this, S); },
  syncSettings(){ syncSettingsUi(this, S); },
  setSetting(k,v){ setSettingDomain(this, S, k, v); },
  setDark(v){ setDarkModeUi(this, S, v); },
  setZen(v){ setZenModeUi(this, S, v); },
  setListStyle(v){ setListStyleUi(this, S, v); },

  setGistToken(v){
    setSettingDomain(this, S, 'gistToken', v.trim());
    try {
      if (v.trim()) localStorage.setItem('mgtd3_gist_token', v.trim());
      else localStorage.removeItem('mgtd3_gist_token');
    } catch {}
    this.syncSettings();
  },
  setGistId(v){
    setSettingDomain(this, S, 'gistId', v.trim());
    this.syncSettings();
  },
  setGistFilename(v){
    setSettingDomain(this, S, 'gistFilename', v.trim() || 'monkeygtd-backup.json');
    this.syncSettings();
  },
  setGistAutoSyncEnabled(v){
    setSettingDomain(this, S, 'gistAutoSyncEnabled', !!v);
    this.startGistAutoSync();
    this.syncSettings();
  },
  setGistAutoSyncInterval(v){
    const n = Math.max(1, parseInt(v, 10) || 5);
    setSettingDomain(this, S, 'gistAutoSyncIntervalMin', n);
    this.startGistAutoSync();
    this.syncSettings();
  },
  async syncFromGist(){ return syncFromGistRemote(this, S, { silent:false, auto:false }); },
  async syncToGist(){ return syncToGistRemote(this, S, { silent:false }); },
  async syncGistNow(){ return syncGistBidirectionalRemote(this, S, { silent:false }); },
  async checkGistNow(){ return this.syncGistNow(); },
  async checkGistOnRefresh(){ return checkGistOnRefreshRemote(this, S); },
  startGistAutoSync(){ return startGistAutoSyncRemote(this, S, {}); },

  // â”€ Command palette â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openCP(mode){ openCommandPalette(this, S, mode); },
  closeCP(){ closeCommandPalette(this, S); },
  updateCP(){ updateCommandPalette(this, S); },
  renderCPItems(){ renderCommandPaletteItems(S); },
  execCP(idx){ executeCommandPaletteItem(this, S, idx); },

  // â”€ Modal helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  openModal(id){ openOverlay(id); },
  closeModal(id){ closeOverlay(this, S, id); },
  closeAll(){ closeAllOverlays(this, S); },

  // â”€ Search â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  clearSearch(){ clearSearchUi(this, S); },

  // â”€ Status bar â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  syncSB(){ syncStatusBarUi(S); },

  // â”€ Toast â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  toast(msg){ showToastUi(this, msg); }
};

App.init();
