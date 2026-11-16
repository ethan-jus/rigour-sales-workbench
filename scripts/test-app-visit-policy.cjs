const fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict')
const {reactive,watch,nextTick}=require('vue')
function object(value){if(value==null||typeof value!=='object')return value;const result={...value};for(const [method,type] of [['getString','string'],['getNumber','number'],['getBoolean','boolean']])Object.defineProperty(result,method,{value:k=>typeof value[k]===type?value[k]:null});Object.defineProperty(result,'getJSON',{value:k=>value[k]!=null&&typeof value[k]==='object'?object(value[k]):null});return result}
function fixture(){
 let now=1000000;const session=reactive({authenticated:true,tenantId:'tenant',userId:'one',revision:1,permissions:['sales:context:read']})
 const environment={environment:'development',gatewayOrigin:'gateway',issuer:'iam'},requests=[],timers=new Map();let timerId=0
 const request=(path,success,fail)=>requests.push({path,success:v=>success(object({data:v})),fail})
 const modules={vue:{watch},'./session.uts':{session,hasPermission:p=>session.authenticated&&session.permissions.includes(p)},'./config.uts':{appEnvironment:environment},
 './api.uts':{requestApi:(path,_method,_body,success,fail)=>request(path,success,fail)},'./sales-profile.uts':{requestSalesApi:request}}
 const source=fs.readFileSync('app/services/visit-policy.uts','utf8'),compiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}})
 assert.equal(compiled.diagnostics.length,0)
 const ctx={exports:{},require:n=>modules[n],Error,Date:{now:()=>now},setInterval:fn=>{timers.set(++timerId,fn);return timerId},clearInterval:id=>timers.delete(id)}
 vm.runInNewContext(compiled.outputText,ctx)
 return {...ctx.exports,session,environment,requests,timers,advance:ms=>now+=ms}
}
const policy=(id='v1',radiusMeters=200)=>({id,radiusMeters,captureRules:{maximumLocationAccuracyMeters:100,automaticRecording:true}})
const flush=()=>new Promise(setImmediate)
test('login preload and all policy readers share one request and one validated version cache',async()=>{
 const f=fixture();f.startVisitPolicyPreload();const entry=f.currentVisitEntryPolicy(),capture=f.currentCaptureRules();assert.equal(f.requests.length,1)
 f.requests[0].success(policy());assert.equal((await entry).id,'v1');assert.equal((await capture).automaticRecording,true)
 await f.currentCaptureRules();await f.currentVisitEntryPolicy();f.resumeVisitPolicyPreload();assert.equal(f.requests.length,1);assert.equal(f.timers.size,1)
})
test('foreground refresh picks a new published version; in-progress visits retain their own capture snapshot',async()=>{
 const f=fixture();f.startVisitPolicyPreload();f.requests[0].success(policy());await flush()
 let capture=f.visitCaptureRules('capture');f.requests[1].success({maximumLocationAccuracyMeters:50,automaticRecording:false});await capture
 f.advance(60000);[...f.timers.values()][0]();f.requests[2].success(policy('v2',500));await flush()
 assert.equal((await f.currentVisitEntryPolicy()).radiusMeters,500)
 assert.equal((await f.visitCaptureRules('capture')).maximumLocationAccuracyMeters,50);assert.equal(f.requests.length,3)
 f.pauseVisitPolicyPreload();assert.equal(f.timers.size,0)
})
test('invalid policies and failed refreshes never become fallback authorization rules',async()=>{
 const f=fixture();for(const value of [{...policy(),id:''},{...policy(),radiusMeters:0},{...policy(),radiusMeters:NaN},{id:'v1',radiusMeters:200}]){
  const pending=f.currentVisitEntryPolicy();f.requests.at(-1).success(value);await assert.rejects(pending,/规则尚未加载/)
 }
 let pending=f.currentVisitEntryPolicy();f.requests.at(-1).success(policy());await pending
 pending=f.currentVisitEntryPolicy(true);f.requests.at(-1).fail('权限已收回');await assert.rejects(pending,/权限已收回/)
 const before=f.requests.length;pending=f.currentVisitEntryPolicy();assert.equal(f.requests.length,before+1);f.requests.at(-1).success(policy());await pending
})
test('account, permission and environment isolation discards old pending responses without clearing new requests',async()=>{
 const f=fixture();const old=f.currentVisitEntryPolicy();f.session.userId='two';const current=f.currentVisitEntryPolicy()
 f.requests[0].success(policy('old'));await assert.rejects(old,/账号已变更/)
 assert.equal(f.currentVisitEntryPolicy(),current);f.requests[1].success(policy('new'));assert.equal((await current).id,'new')
 f.session.permissions=[];await assert.rejects(f.currentVisitEntryPolicy(),/不能读取/)
 f.session.permissions=['sales:context:read'];f.environment.gatewayOrigin='new-env';const fresh=f.currentVisitEntryPolicy();assert.equal(f.requests.length,3);f.requests[2].success(policy());await fresh
})
test('cache expiry and clock rollback revalidate while logged-out preload sends no request',async()=>{
 const f=fixture();let p=f.currentVisitEntryPolicy();f.requests[0].success(policy());await p
 f.advance(300001);p=f.currentVisitEntryPolicy();f.requests[1].success(policy());await p
 f.advance(-1);p=f.currentVisitEntryPolicy();f.requests[2].success(policy());await p
 f.session.authenticated=false;f.startVisitPolicyPreload();assert.equal(f.requests.length,3)
 f.session.authenticated=true;await nextTick();assert.equal(f.requests.length,4);f.requests[3].success(policy());await flush()
})
test('capture rules coalesce per visit and revalidate after expiry or account change',async()=>{
 const f=fixture(),one=f.visitCaptureRules('a/b'),two=f.visitCaptureRules('a/b');assert.equal(one,two);assert.equal(f.requests[0].path,'/sales/me/visits/a%2Fb/capture-rules')
 f.requests[0].success({maximumLocationAccuracyMeters:100});await one
 f.advance(600001);let next=f.visitCaptureRules('a/b');f.requests[1].success({maximumLocationAccuracyMeters:50});await next
 f.session.userId='two';next=f.visitCaptureRules('a/b');assert.equal(f.requests.length,3);f.requests[2].success({maximumLocationAccuracyMeters:30});await next
})
