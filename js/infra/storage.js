'use strict';

const DB={
  get(){ try{ const r=localStorage.getItem('mgtd3'); return r?JSON.parse(r):null; }catch{return null;} },
  save(d){ try{ localStorage.setItem('mgtd3',JSON.stringify(d)); }catch(e){ console.error(e); } },
  // The running timer is per-device, so it lives outside the synced app data.
  getTimer(){ try{ const r=localStorage.getItem('mgtd3_timer'); return r?JSON.parse(r):null; }catch{return null;} },
  saveTimer(t){ try{ if(t) localStorage.setItem('mgtd3_timer',JSON.stringify(t)); else localStorage.removeItem('mgtd3_timer'); }catch(e){ console.error(e); } }
};
