const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const { reactive } = require('vue')
function json(value) {
  if (value == null || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([k,v])=>[k,json(v)]))
  for(const [name, type] of [['getString','string'],['getNumber','number'],['getJSON','object'],['getBoolean','boolean']]) Object.defineProperty(result,name,{value:key=>typeof result[key] === type ? result[key] : null})
  return result
}
const day = status => ({id:'day', status, businessDate:'2026-11-12', checkedInAt:'2026-11-12T01:00:00Z', locationSessionId:'segment'})
function fixture(storage = new Map()) {
  const session = {authenticated:true, tenantId:'tenant', userId:'one', revision:1}; let index=0, gps=0, reads=0
  const owner=()=>session.authenticated ? session.tenantId+':'+session.userId+':'+session.revision : ''
  let handler=()=>day('ACTIVE'); const writes=[]; let permission=true
  const modules={
    vue:{reactive}, './session.uts':{session,hasPermission:()=>permission},
    './api.uts':{apiErrorMessage:code=>code},
    './crm.uts':{
      crmOwner:owner, crmToday:()=> '2026-11-12', crmId:()=> 'request-'+(++index), crmMessage:e=>e.message, crmSalesReady:async()=>{},
      crmLocation:async()=>{gps++;return json({latitude:30,longitude:120,accuracyMeters:12,source:'APP_NATIVE'})}, crmObject:r=>json(r.data),
      crmCall:async(path,method='GET',body=null)=>{if(method==='GET')reads++;else writes.push({path,body:JSON.parse(JSON.stringify(body))});const value=await handler(path,method,body);return {data:path.endsWith('/attendance-context')?{businessDate:value?.businessDate||'2026-11-12',captureUntil:'2026-11-12T20:00:00Z',serverTime:'2026-11-12T01:00:00Z',locationEnabled:true,locationIntervalMinutes:1,offlineUploadDeadlineMinutes:120,workDay:value}:value}}
    },
    './field-storage.uts': {fieldStorageScope:()=>session.tenantId+':'+session.userId,fieldStorageDurable:()=>true,
      readFieldValue:async(s,k)=>json(storage.get(s+'|'+k)??null),writeFieldValue:async(s,k,v)=>storage.set(s+'|'+k,JSON.parse(JSON.stringify(v))),clearFieldValue:async(s,k)=>storage.delete(s+'|'+k)}
  }
  const source=fs.readFileSync(__dirname+'/../app/services/attendance.uts','utf8')
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const ctx={exports:{},require:n=>modules[n],uni:{getStorageSync:()=>'',setStorageSync:()=>{}},Error,Date,Promise,JSON}
  vm.createContext(ctx)
  vm.runInContext("Object.prototype.getBoolean=function(k){return typeof this[k]==='boolean'?this[k]:null}; Object.prototype.getString=function(k){return typeof this[k]==='string'?this[k]:null}; Object.prototype.getJSON=function(k){return typeof this[k]==='object'?this[k]:null}; Object.prototype.getNumber=function(k){return typeof this[k]==='number'?this[k]:null}",ctx)
  vm.runInContext(code,ctx)
  return {api:ctx.exports,session,storage,writes,respond:f=>handler=f,deny:()=>permission=false,gps:()=>gps,reads:()=>reads}
}
test('failed command retries identical evidence even after App restart',async()=>{
  const store=new Map(), first=fixture(store)
  first.respond((p,m)=>{if(m==='GET')return null;throw Error('network')})
  await assert.rejects(first.api.punchAttendance(false),/network/)
  assert.equal(first.api.attendance.pending,true);assert.equal(store.size,1)
  const restarted=fixture(store);restarted.respond((p,m)=>{if(m==='GET')return null;return day('ACTIVE')})
  await restarted.api.punchAttendance(false)
  assert.deepEqual(first.writes[0],restarted.writes[0]);assert.equal(restarted.gps(),0);assert.equal(store.size,0)
})
test('already active sign-in and finished sign-out reconcile without a second write',async()=>{
  const f=fixture();await f.api.punchAttendance(false);assert.equal(f.writes.length,0);assert.equal(f.gps(),0)
  f.respond(()=>day('FINISHED'));await f.api.punchAttendance(true);assert.equal(f.writes.length,0)
})
test('only a known missing day is not-started; denied reads cannot turn into check-in',async()=>{
  const f=fixture();f.respond(()=>{throw Error('permission denied')})
  await assert.rejects(f.api.punchAttendance(false),/permission denied/);assert.equal(f.gps(),0);assert.equal(f.writes.length,0)
  f.respond(()=>null);assert.equal(await f.api.attendanceStatus(),'NOT_STARTED')
})
test('display reads coalesce and expire independently from fresh mutation validation',async()=>{
  const f=fixture();let finish;f.respond(()=>new Promise(r=>finish=r))
  const a=f.api.refreshAttendance(),b=f.api.refreshAttendance();assert.equal(f.reads(),1);finish(day('ACTIVE'));await Promise.all([a,b])
  await f.api.refreshAttendance();assert.equal(f.reads(),1)
  f.respond(()=>day('ACTIVE'));await f.api.punchAttendance(false);assert.equal(f.reads(),2)
})
test('account switch discards a late day and does not acquire location or write',async()=>{
  const f=fixture();let finish;f.respond(()=>new Promise(r=>finish=r))
  const action=f.api.punchAttendance(false);await new Promise(setImmediate);f.session.userId='two';finish(day('ACTIVE'))
  await assert.rejects(action,/账号已变更/);assert.equal(f.api.attendance.day,null);assert.equal(f.gps(),0);assert.equal(f.writes.length,0)
})
test('sign-out conflict preserves the request for retry and permission blocks capture',async()=>{
  const f=fixture();f.respond((p,m)=>{if(m==='POST')throw Error('请先完成当前拜访');return day('ACTIVE')})
  await assert.rejects(f.api.punchAttendance(true),/当前拜访/);assert.equal(f.writes[0].path,'/sales/work-days/day/check-out');assert.equal(f.api.attendance.busy,false)
  f.deny();await assert.rejects(f.api.punchAttendance(true),/无打卡权限/);assert.equal(f.gps(),1)
})

test('business-date and pending command are restored from server context, not phone midnight',async()=>{
  const f=fixture(new Map([['tenant:one|punch:2026-11-11:out',{priorSessionId:'segment',path:'/sales/work-days/day/check-out',command:{idempotencyKey:'retained',clientOccurredAt:'2026-11-11T18:00:00Z',location:{latitude:30,longitude:120}}}]]))
  f.respond((p,m)=>m==='GET'?{...day('ACTIVE'),businessDate:'2026-11-11'}:{...day('FINISHED'),businessDate:'2026-11-11'})
  await f.api.refreshAttendance();assert.equal(f.api.attendance.businessDate,'2026-11-11');assert.equal(f.api.attendance.pending,true)
  await f.api.punchAttendance(true);assert.equal(f.writes[0].body.idempotencyKey,'retained');assert.equal(f.gps(),0)
})
