'use strict';

const DB={
  get(){ try{ const r=localStorage.getItem('mgtd3'); return r?JSON.parse(r):null; }catch{return null;} },
  save(d){ try{ localStorage.setItem('mgtd3',JSON.stringify(d)); }catch(e){ console.error(e); } }
};
