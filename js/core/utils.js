'use strict';

const uid = () => Math.random().toString(36).slice(2,9) + Date.now().toString(36);
const now = () => new Date().toISOString();
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const dateStr = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayS = () => dateStr();
const tomorrowS = () => { const d=new Date(); d.setDate(d.getDate()+1); return dateStr(d); };
const nextMonday = () => { const d=new Date(),day=d.getDay(),dd=day===0?1:8-day; d.setDate(d.getDate()+dd); return dateStr(d); };
const dispDate = iso => { if(!iso)return''; const[y,m,d]=iso.split('-'); return`${d}/${m}/${y}`; };
const cmpDate = (a,b) => (!a&&!b)?0:!a?1:!b?-1:a<b?-1:a>b?1:0;
const isAllowedLinkUrl = (url='') => {
  const val = String(url || '').trim();
  if (!val) return false;
  if (val.startsWith('#')) return true;

  const m = val.match(/^([a-z][a-z0-9+.-]*):/i);
  if (!m) return true;

  const scheme = m[1].toLowerCase();
  if (scheme === 'file' || scheme === 'javascript' || scheme === 'vbscript' || scheme === 'data') {
    return false;
  }
  return true;
};
const normalizePromptLink = (raw='', kind='generic') => {
  let value = String(raw || '').trim();
  if (!value) return '';

  const mdMatch = value.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  if (mdMatch) value = String(mdMatch[1] || '').trim();

  if (value.startsWith('<') && value.endsWith('>')) {
    value = value.slice(1, -1).trim();
  }

  if (kind === 'onenote') {
    const legacyMatch = value.match(/\|\s*(onenote:[^\]\s]+)\s*\]?$/i);
    if (legacyMatch) value = String(legacyMatch[1] || '').trim();

    const match = value.match(/onenote:[^\s\])]+/i);
    if (match) value = String(match[0] || '').trim();

    value = value.replace(/&end$/i, '').trim();
    return isAllowedLinkUrl(value) ? value : '';
  }

  if (kind === 'email') {
    const legacyMatch = value.match(/\|\s*(outlook:[^\]\s]+)\s*\]?$/i);
    if (legacyMatch) value = String(legacyMatch[1] || '').trim();

    const outlookMatch = value.match(/outlook:[^\s\])]+/i);
    if (outlookMatch) value = String(outlookMatch[0] || '').trim();

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
    if (!hasScheme && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      value = `mailto:${value}`;
    }
    return isAllowedLinkUrl(value) ? value : '';
  }

  if (kind === 'file') {
    if (!/^start:/i.test(value)) {
      value = `start:${value}`;
    }
    return isAllowedLinkUrl(value) ? value : '';
  }

  if (kind === 'web') {
    if (!/^[a-z][a-z0-9+.-]*:/i.test(value)) {
      value = `https://${value}`;
    }
    return /^https?:\/\//i.test(value) && isAllowedLinkUrl(value) ? value : '';
  }

  return isAllowedLinkUrl(value) ? value : '';
};
const FA_TOKEN_ICONS = {
  envelope: '✉',
  outlook: '✉',
  calendar: '📅',
  link: '🔗',
  task: '☑',
  file: '📄',
  github: '🐙'
};
const ONENOTE_INLINE_SVG = '<svg viewBox="0 0 24 24" role="img" aria-hidden="true" focusable="false"><rect x="2" y="4" width="20" height="16" rx="2" fill="currentColor" opacity="0.18"></rect><rect x="3.5" y="5.5" width="7" height="13" rx="1" fill="currentColor"></rect><path d="M8.2 15.8V8.2h1.15l2.45 4.3V8.2h1.2v7.6h-1.05l-2.55-4.45v4.45z" fill="#ffffff"></path><rect x="12" y="7.5" width="8" height="1.3" fill="currentColor" opacity="0.65"></rect><rect x="12" y="10.6" width="8" height="1.3" fill="currentColor" opacity="0.65"></rect><rect x="12" y="13.7" width="6.2" height="1.3" fill="currentColor" opacity="0.65"></rect></svg>';
const renderLinkLabel = (label='') => {
  const raw = String(label || '').trim();
  const m = raw.match(/^fa:([a-z0-9-]+)$/i);
  if (!m) return raw;
  const name = m[1].toLowerCase();
  if (name === 'onenote') {
    return `<span class="fa-token onenote" data-fa="${name}" title="${name}" aria-label="${name}">${ONENOTE_INLINE_SVG}</span>`;
  }
  const glyph = FA_TOKEN_ICONS[name] || '🔗';
  return `<span class="fa-token" data-fa="${name}" title="${name}" aria-label="${name}">${glyph}</span>`;
};
const getDueCls = t => {
  if(t.due_asap) return 'asap';
  if(!t.due) return '';
  const td=todayS();
  if(t.due<td){
    // Selecting the same overdue date in the due picker acknowledges the overdue state.
    if((t.overdue_ack_due||'')===t.due) return '';
    return 'overdue';
  }
  if(t.due===td) return 'tod'; if(t.due===tomorrowS()) return 'tom';
  return '';
};
const fmtDue = (t,rel) => {
  if(t.due_asap) return 'ASAP';
  if(!t.due) return '';
  if(rel){
    const diff=Math.round((new Date(t.due)-new Date(todayS()))/86400000);
    if(diff<0) return `${Math.abs(diff)}d overdue`;
    if(diff===0) return 'Today'; if(diff===1) return 'Tomorrow';
    return `in ${diff}d`;
  }
  return dispDate(t.due);
};

const md = text => {
  if(!text) return '';
  let h = esc(text);
  h = h.replace(/```([\s\S]*?)```/g, (_,c)=>`<pre><code>${c.trim()}</code></pre>`);
  h = h.replace(/`([^`]+)`/g,'<code>$1</code>');
  h = h.replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
  h = h.replace(/__(.+?)__/g,'<strong>$1</strong>');
  h = h.replace(/\*(.+?)\*/g,'<em>$1</em>');
  h = h.replace(/_(.+?)_/g,'<em>$1</em>');
  h = h.replace(/~~(.+?)~~/g,'<del>$1</del>');
  const linkSlots = [];
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => {
    const cleanUrl = String(url || '').trim();
    if (!isAllowedLinkUrl(cleanUrl)) return `[${label}](${cleanUrl})`;
    const html = `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${renderLinkLabel(label)}</a>`;
    const idx = linkSlots.push(html) - 1;
    return `__MGTD_LINK_${idx}__`;
  });
  h = h.replace(/(?<!["'=])\b([a-z][a-z0-9+.-]*:[^\s<>"]+)/gi, (_m, rawUrl) => {
    const cleanUrl = String(rawUrl || '').trim();
    if (!isAllowedLinkUrl(cleanUrl)) return cleanUrl;
    return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>`;
  });
  h = h.replace(/__MGTD_LINK_(\d+)__/g, (_m, idx) => linkSlots[Number(idx)] || '');
  h = h.replace(/\n/g,'<br>');
  return h;
};

const stripLinkTargetsForSmartParsing = raw => {
  let s = String(raw || '');
  // Keep markdown link labels but ignore link targets to avoid false tag detection from URL fragments.
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label) => String(label || ''));
  // Ignore bare protocol URLs so #anchors and @segments do not become smart tokens.
  s = s.replace(/\b([a-z][a-z0-9+.-]*:[^\s<>"]+)/gi, ' ');
  return s;
};

const parseSmart = raw => {
  const r={content:raw,tags:[],due:'',due_asap:false,color:0,assignees:[]};
  const tokenSource = stripLinkTargetsForSmartParsing(raw);
  const contentSource = String(raw || '');
  const tagRe = /(^|[\s([{])#([\w-]+)/g;
  let m;
  while ((m = tagRe.exec(tokenSource))) {
    const t = m[2];
    if (!/^[1-9]$/.test(t)) r.tags.push(t);
  }

  const pm=tokenSource.match(/(^|[\s([{])!([1-9])(?=\s|$)/);
  if(pm) r.color=+pm[2];

  const dueRe = /(^|[\s([{])\^(\S+)/g;
  while ((m = dueRe.exec(tokenSource))) {
    const v=m[2].toLowerCase();
    if(v==='today'||v==='tod') r.due=todayS();
    else if(v==='tomorrow'||v==='tom') r.due=tomorrowS();
    else if(v==='asap'||v==='shortlist') r.due_asap=true;
    else if(v==='nextweek') r.due=nextMonday();
    else if(/^\d{4}-\d{2}-\d{2}$/.test(m[2])) r.due=m[2];
    else if(/^\d{2}\/\d{2}\/\d{4}$/.test(m[2])){ const[d2,mo,yr]=m[2].split('/'); r.due=`${yr}-${mo}-${d2}`; }
  }

  const assigneeRe = /(^|[\s([{])@([\w-]+)/g;
  while ((m = assigneeRe.exec(tokenSource))) r.assignees.push(m[2]);
  r.content=contentSource.replace(/\s*!([1-9])/g,'').replace(/\s*\^(\S+)/g,'').trim();
  return r;
};

const ensureTaskHistory = task => {
  if (!task) return [];
  if (!Array.isArray(task.history)) task.history = [];
  return task.history;
};

const logTaskHistory = (task, type, changes) => {
  if (!task || !type || !changes) return;
  const history = ensureTaskHistory(task);
  history.push({ at: now(), type, changes });
  if (history.length > 200) history.shift();
};

const mkTask = (o={}) => ({
  id:uid(),content:'',status:0,checklist_id:'',parent_id:'',position:0,deleted:false,
  tasks:[],tags:{},tags_as_text:'',color:0,due:'',due_asap:false,repeating_due:null,
  assignees:[],attachments:[],links:[],notes:[],comments_count:0,
  history:[],
  update_line:'',updated_at:now(),created_at:now(),completed_at:'',_collapsed:false,...o
});

const mkList = (o={}) => ({
  id:uid(),name:'New List',tags:[],style:'none',archived:false,root_tasks:[],
  created_at:now(),updated_at:now(),...o
});

const seedData = () => {
  const lid=uid();
  const make=(o)=>mkTask({checklist_id:lid,...o});
  const t1=make({content:'Welcome to MonkeyGTD',color:5,tags:{welcome:{isPrivate:false}},tags_as_text:'welcome'});
  const t2=make({content:'Getting started'});
  const t2a=make({content:'Press Enter to add a task below selected',parent_id:t2.id});
  const t2b=make({content:'Press Tab to indent a task (make it a sub-task)',parent_id:t2.id,due:todayS(),tags:{tip:{isPrivate:false}},tags_as_text:'tip'});
  const t2c=make({content:'Press F2 or double-click to edit',parent_id:t2.id});
  const t2c1=make({content:'Smart syntax: #tag ^today !3 @user -> auto-parsed',parent_id:t2c.id,color:3});
  const t3=make({content:'Keyboard shortcuts reference',status:1,completed_at:now()});
  const t3a=make({content:'Shift+Shift -> command palette',parent_id:t3.id,due:tomorrowS()});
  const t3b=make({content:'/ -> focus search bar',parent_id:t3.id});
  const t3c=make({content:'dd / td / tm -> due date shortcuts',parent_id:t3.id});
  const t4=make({content:'Open the Due page to see scheduled tasks',due:todayS()});
  t4.notes=[{id:uid(),author:'me',content:'All tasks with due dates appear here. Press **gd** to open.',created_at:now(),updated_at:now()}];
  t4.comments_count=1;
  t2.tasks=[t2a.id,t2b.id,t2c.id]; t2c.tasks=[t2c1.id]; t3.tasks=[t3a.id,t3b.id,t3c.id];
  const tasks={}; [t1,t2,t2a,t2b,t2c,t2c1,t3,t3a,t3b,t3c,t4].forEach(t=>tasks[t.id]=t);
  const list=mkList({id:lid,name:'My Tasks',root_tasks:[t1.id,t2.id,t3.id,t4.id]});
  return {
    lists:{[lid]:list},tasks,
    settings:{darkMode:false,zenMode:false,showCompleted:true,moveCompletedDown:false,
              relativeDates:false,hideFuture:false,showBreadcrumbs:true,autoCloseParent:true,
              closeChildrenOnParentDone:false,
              taskDensity:'comfortable',emphasizeParentTasks:true,indentGuideStyle:'subtle',
              branchSpacing:'relaxed',focusMode:'off',contentWidth:'measure',
              listStyle:'none',showNotes:false,copyOnlyVisibleSubtasks:true,copyStatusPrefix:false,
              gistAutoSyncEnabled:true,gistAutoSyncIntervalMin:5,
              syncProvider:'gist',repoBranch:'main',repoPath:'monkeygtd-backup.json'},
    deletedItems:[],currentListId:lid
  };
};
