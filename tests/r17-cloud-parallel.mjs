import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const values = new Map([['projekte',JSON.stringify([{id:'p',name:'Original'}])],['ordner','[]']]);
const status = {textContent:'',dataset:{}};
let finish, sending;
const started = new Promise(r => sending=r);
const context = {
  localStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},
  GK:{projekte:'projekte',ordner:'ordner'},GERUEST_DATEN_EVENT:'data',
  navigator:{onLine:true},CustomEvent:class{},
  document:{readyState:'complete',getElementById:id=>id==='hubCloudStatus'?status:null,addEventListener(){},dispatchEvent(){}},
  window:{addEventListener(){}},setTimeout:()=>1,clearTimeout(){},
  fetch: async (url,opts) => {
    if(url.endsWith('arbeitsbereich')) return {ok:true,status:200,json:async()=>({projects:[],folders:[]})};
    sending(); await new Promise(r=>finish=r);
    return {ok:true,status:200,json:async()=>({projekt:{revision:1,ownerUserId:'owner',rolle:'owner'}})};
  }
};
vm.runInNewContext(fs.readFileSync(new URL('../legacy-app/cloud.js',import.meta.url),'utf8'),context);
await started;
values.set('projekte',JSON.stringify([{id:'p',name:'Weitergezeichnet'}]));
finish();
await new Promise(r=>setImmediate(r));
const result = JSON.parse(values.get('projekte'))[0];
assert.equal(result.name,'Weitergezeichnet');assert.equal(result._cloud.revision,1);assert.equal(result._cloud.dirty,true);
console.log('Cloud-Abgleich behält Änderungen während laufender Übertragung.');
