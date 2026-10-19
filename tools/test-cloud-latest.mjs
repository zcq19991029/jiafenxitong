import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
let passed=0;
const source=fs.readFileSync('cloud.js','utf8');
async function fixture(){
  let record={revision:1,updated_at:'2026-10-19T00:00:00Z',data:{createdAt:'a',updatedAt:'b',classes:[],lessons:[],undo:[],redo:[],operationLog:[]}};
  const memory=new Map([['jfdt.session.v2',JSON.stringify({token:'test',user:{uid:'fixture'}})]]);
  let hold=null,offline=false,writes=0,ready;
  const booted=new Promise(r=>ready=r);
  const w={location:{origin:'https://fixture.test'},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v)},addEventListener(){},setTimeout:()=>1,clearTimeout(){},URL,Date,Promise,
    fetch:async(url,options)=>{if(offline)throw Error('offline');if(url.endsWith('/api/auth/me'))return {ok:true,json:async()=>({user:{uid:'fixture'}})};const snapshot=structuredClone(record);if(hold){const h=hold;hold=null;await h;}if(options.method==='PUT'){writes++;const body=JSON.parse(options.body);assert.equal(body.baseRevision,record.revision);record={revision:record.revision+1,data:body.data};return{ok:true,json:async()=>({revision:record.revision})};}return {ok:true,json:async()=>snapshot};}};
  w.window=w;vm.runInNewContext(source,w);w.JFDT_CLOUD.boot({onReady:ready});await booted;
  let state=structuredClone(record.data),applied=0;
  return {cloud:w.JFDT_CLOUD,get:()=>state,apply:r=>{state=structuredClone(r.data);applied++;},edit:()=>state.classes.push({id:'local'}),remote:()=>{record.revision++;record.data.classes.push({id:'remote'});},hold:p=>hold=p,offline:v=>offline=v,applied:()=>applied,writes:()=>writes};
}
function check(name,value){assert.ok(value,name);console.log('PASS',name);passed++;}
let f=await fixture();f.remote();check('clean old device pulls newer cloud revision',await f.cloud.checkLatest(f.get,f.apply)&&f.applied()===1&&f.get().classes[0].id==='remote');
check('verified status carries version and check time',f.cloud.status().cloudVersion===2&&f.cloud.status().checkedAt>0);
f=await fixture();f.edit();f.cloud.touch(f.get);f.remote();check('dirty device stops with conflict',!(await f.cloud.checkLatest(f.get,f.apply))&&f.cloud.status().mode==='conflict');
check('conflict preserves local data and sends no overwrite',f.get().classes[0].id==='local'&&f.applied()===0&&f.writes()===0);
f=await fixture();let release;f.hold(new Promise(r=>release=r));f.remote();const checking=f.cloud.checkLatest(f.get,f.apply);f.edit();f.cloud.touch(f.get);release();check('editing during check prevents remote replacement',!(await checking)&&f.applied()===0&&f.get().classes[0].id==='local');
f=await fixture();f.get().updatedAt='view-only-time';check('timestamp-only change is not a content conflict',await f.cloud.checkLatest(f.get,f.apply));
f=await fixture();f.edit();f.cloud.touch(f.get);check('same revision pending edit uploads before latest confirmation',await f.cloud.checkLatest(f.get,f.apply)&&f.writes()===1&&f.cloud.status().cloudVersion===2);
f=await fixture();f.offline(true);check('offline never claims latest',!(await f.cloud.checkLatest(f.get,f.apply))&&f.cloud.status().mode==='offline');
console.log(`Cloud latest: ${passed} passed, 0 failed`);
