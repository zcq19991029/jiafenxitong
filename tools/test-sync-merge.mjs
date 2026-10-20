import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {api,environment,initialAdmin,ORIGIN,worker} from './lib/test-d1.mjs';
const source=fs.readFileSync('cloud.js','utf8');
const sandbox={URL,Date,Promise,addEventListener(){},localStorage:{getItem(){return null;}},location:{origin:ORIGIN}};sandbox.window=sandbox;vm.runInNewContext(source,sandbox);
const merge=sandbox.JFDT_CLOUD._mergeStates;
const clone=x=>JSON.parse(JSON.stringify(x));
const base={version:1,createdAt:'2026-10-19T00:00:00Z',updatedAt:'2026-10-19T00:00:00Z',classes:[{id:'c1',name:'测试班',teacher:'测试',roster:[],groups:[{id:'g1',no:1,members:[{id:'m1',name:'甲',sid:'26000000001'},{id:'m2',name:'乙',sid:'26000000002'}]},{id:'g2',no:2,members:[{id:'m3',name:'丙',sid:'26000000003'}]}]}],lessons:[{id:'l1',classId:'c1',seq:1,date:'2026-10-19',topic:'测试',memberProjectBase:5,leaderProjectNames:['项目甲','项目乙'],leaderProjectCount:2,scores:{1:{group:5,phone:0,first:0,duty:0,personal:{}},2:{group:5,phone:0,first:0,duty:0,personal:{}}},leaderScores:{1:{projects:['项目甲','项目乙'],members:{'sid:26000000001':[0,0]}},2:{projects:['项目甲','项目乙'],members:{}}},attendance:{}}],undo:[],redo:[],operationLog:[]};
let passed=0;function check(name,value){assert.ok(value,name);passed++;console.log('PASS',name);}
function scenario(name,left,right,verify,conflict=false){let l=clone(base),r=clone(base);left(l);right(r);const before=JSON.stringify([base,l,r]),out=merge(base,l,r);check(name,conflict?out.conflicts.length>0:out.conflicts.length===0&&verify(out.data));assert.equal(JSON.stringify([base,l,r]),before,'merge must not mutate source snapshots');}
scenario('different members deductions merge',s=>s.lessons[0].scores[1].personal[0]=1,s=>s.lessons[0].scores[1].personal[1]=2,s=>s.lessons[0].scores[1].personal[0]===1&&s.lessons[0].scores[1].personal[1]===2);
scenario('same member equal-looking deductions conflict',s=>s.lessons[0].scores[1].personal[0]=1,s=>s.lessons[0].scores[1].personal[0]=1,null,true);
scenario('same member differing deductions conflict',s=>s.lessons[0].scores[1].personal[0]=1,s=>s.lessons[0].scores[1].personal[0]=2,null,true);
{
  let l=clone(base),r=clone(base);l.lessons[0].scores[1].personal[0]=1;r.lessons[0].scores[1].personal[0]=2;
  const out=merge(base,l,r),detail=out.conflictDetails.find(x=>x.path==='/lessons/l1/scores/1/personal/0');
  check('conflict details include local and cloud values',detail&&detail.local===1&&detail.remote===2);
}
scenario('different groups and fields merge',s=>s.lessons[0].scores[1].personal[0]=1,s=>s.lessons[0].scores[2].duty=5,s=>s.lessons[0].scores[1].personal[0]===1&&s.lessons[0].scores[2].duty===5);
scenario('different individual project cells merge',s=>s.lessons[0].leaderScores[1].members['sid:26000000001'][0]=4,s=>s.lessons[0].leaderScores[1].members['sid:26000000001'][1]=5,s=>s.lessons[0].leaderScores[1].members['sid:26000000001'].join(',')==='4,5');
scenario('same individual project cell conflicts',s=>s.lessons[0].leaderScores[1].members['sid:26000000001'][0]=4,s=>s.lessons[0].leaderScores[1].members['sid:26000000001'][0]=4,null,true);
scenario('different student attendance merges',s=>s.lessons[0].attendance.a={status:'late',loss:1},s=>s.lessons[0].attendance.b={status:'leave',loss:0},s=>s.lessons[0].attendance.a.loss===1&&s.lessons[0].attendance.b.status==='leave');
scenario('group reassignment versus grading stops for review',s=>s.classes[0].groups[0].members.pop(),s=>s.lessons[0].scores[1].personal[1]=1,null,true);
scenario('project deletion versus grading stops for review',s=>s.lessons[0].leaderProjectNames.pop(),s=>s.lessons[0].leaderScores[1].members['sid:26000000001'][1]=4,null,true);
scenario('lesson deletion versus grading stops for review',s=>s.lessons=[],s=>s.lessons[0].scores[2].duty=5,null,true);
scenario('independently created lessons are retained',s=>s.lessons.push({...clone(base.lessons[0]),id:'la',seq:2}),s=>s.lessons.push({...clone(base.lessons[0]),id:'lb',seq:3}),s=>s.lessons.length===3);
scenario('two devices creating the same lesson number require review',s=>s.lessons.push({...clone(base.lessons[0]),id:'la',seq:2}),s=>s.lessons.push({...clone(base.lessons[0]),id:'lb',seq:2}),null,true);
scenario('same student assigned to two groups requires review',s=>s.classes[0].groups[0].members.push({id:'ma',name:'新生',sid:'new'}),s=>s.classes[0].groups[1].members.push({id:'mb',name:'新生',sid:'new'}),null,true);
scenario('metadata and grades merge',s=>s.lessons[0].topic='新主题',s=>s.lessons[0].scores[1].personal[0]=1,s=>s.lessons[0].topic==='新主题'&&s.lessons[0].scores[1].personal[0]===1);
scenario('equivalent personal zeros do not conflict',s=>{s.lessons[0].scores[1].personal={0:1,1:0};},s=>{s.lessons[0].scores[1].personal={0:0,1:1};},s=>s.lessons[0].scores[1].personal[0]===1&&s.lessons[0].scores[1].personal[1]===1);
scenario('new audit and undo records retain both device actions',s=>{s.undo.push({id:'oa',at:'a'});s.operationLog.push({id:'aa',at:'a',kind:'记分',detail:'甲'});},s=>{s.undo.push({id:'ob',at:'b'});s.operationLog.push({id:'ab',at:'b',kind:'记分',detail:'乙'});},s=>s.undo.length===2&&s.operationLog.length===2);
scenario('already accepted operation is not applied twice',s=>{s.lessons[0].scores[1].personal[0]=1;s.operationLog.push({id:'once',at:'a'});},s=>{s.lessons[0].scores[1].personal[0]=1;s.lessons[0].scores[2].duty=5;s.operationLog.push({id:'once',at:'a'});},s=>s.lessons[0].scores[1].personal[0]===1&&s.lessons[0].scores[2].duty===5);
const env=environment(),admin=await initialAdmin(env);
Object.values(base.lessons[0].leaderScores).forEach(r=>{r.signedBy='';r.note='';});
let initial=await api(env,'/api/state','PUT',{baseRevision:0,data:base},admin.token);assert.equal(initial.status,200,JSON.stringify(initial.data));
async function device(storage){const memory=new Map(Object.entries(storage||{}));if(!storage)memory.set('jfdt.session.v2',JSON.stringify({token:admin.token,user:admin.user}));let ready,state,delay=null;const booted=new Promise(r=>ready=r);const w={URL,Date,Promise,location:{origin:ORIGIN},addEventListener(){},setTimeout:()=>1,clearTimeout(){},localStorage:{getItem:k=>memory.get(k)||null,setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)},fetch:async(url,options)=>{if(options.method==='PUT'&&delay){const wait=delay;delay=null;await wait;}return worker.fetch(new Request(url,{...options,headers:{...options.headers,Origin:ORIGIN}}),env);}};w.window=w;vm.runInNewContext(source,w);const cloud=w.JFDT_CLOUD;cloud.boot({onReady:(_,rec)=>{state=clone(rec.data);cloud.acceptRemote(rec);ready();}});await booted;cloud.bindState({get:()=>state,apply:v=>state=clone(v),canApply:()=>true});return {cloud,get:()=>state,touch:()=>cloud.touch(()=>state),hold:p=>delay=p,storage:()=>Object.fromEntries(memory)};}
const a=await device(),b=await device();
a.get().lessons[0].scores[1].personal[0]=1;a.get().undo.push({id:'a1',at:'2026-10-19T01:00:00Z'});a.get().operationLog.push({id:'al1',at:'2026-10-19T01:00:00Z',kind:'记分',detail:'甲扣1'});a.touch();await a.cloud.flush();
b.get().lessons[0].scores[1].personal[1]=1;b.get().undo.push({id:'b1',at:'2026-10-19T01:00:01Z'});b.get().operationLog.push({id:'bl1',at:'2026-10-19T01:00:01Z',kind:'记分',detail:'乙扣1'});b.touch();await b.cloud.flush();
let remote=(await api(env,'/api/state','GET',undefined,admin.token)).data;
check('real Worker CAS collision automatically merges different members',remote.data.lessons[0].scores[1].personal[0]===1&&remote.data.lessons[0].scores[1].personal[1]===1&&b.cloud.status().mode==='ok');
check('merged state updates device memory and both undo histories',b.get().undo.length===2&&b.get().lessons[0].scores[1].personal[0]===1);
await a.cloud.checkLatest(a.get,rec=>Object.assign(a.get(),clone(rec.data)));check('other device pulls merged revision cleanly',a.get().lessons[0].scores[1].personal[1]===1);
const c=await device(),d=await device();c.get().lessons[0].scores[1].personal[0]=2;c.touch();d.get().lessons[0].scores[1].personal[0]=2;d.touch();await c.cloud.flush();await assert.rejects(d.cloud.flush());check('same student concurrent edit remains protected',d.cloud.status().mode==='conflict'&&(await api(env,'/api/state','GET',undefined,admin.token)).data.data.lessons[0].scores[1].personal[0]===2);
const e=await device(),f=await device();let release;e.hold(new Promise(r=>release=r));e.get().lessons[0].scores[2].duty=3;e.touch();const upload=e.cloud.flush();e.get().lessons[0].scores[1].personal[1]=2;e.touch();f.get().lessons[0].leaderScores[1].members['sid:26000000001'][0]=5;f.touch();await f.cloud.flush();release();await upload;remote=(await api(env,'/api/state','GET',undefined,admin.token)).data;
check('edits during upload and CAS rebase all survive',remote.data.lessons[0].scores[2].duty===3&&remote.data.lessons[0].scores[1].personal[1]===2&&remote.data.lessons[0].leaderScores[1].members['sid:26000000001'][0]===5);
env.sqlite.close();console.log(`Fine-grained sync: ${passed} passed, 0 failed`);
