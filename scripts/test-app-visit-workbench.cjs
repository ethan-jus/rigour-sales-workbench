const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const test=require('node:test'),assert=require('node:assert/strict')
const {reactive,ref,computed,watch,nextTick}=require('vue')
const root=path.resolve(__dirname,'../app')
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function object(value) {
  if(value==null||typeof value!=='object')return value
  if(Array.isArray(value))return value.map(object)
  const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,object(v)]))
  Object.defineProperties(out,{getString:{value:k=>typeof out[k]==='string'?out[k]:null},getNumber:{value:k=>typeof out[k]==='number'?out[k]:null},getBoolean:{value:k=>typeof out[k]==='boolean'?out[k]:null},getJSON:{value:k=>out[k]??null},getArray:{value:k=>out[k]??null}})
  return out
}
function fixture() {
  const session=reactive({authenticated:true,revision:1,permissions:['sales:visit:own:read','crm:store:history-read','sales:visit-plan:own:read']})
  const calls=[],hooks={},navigation=[],owner=()=>session.revision+':'+session.permissions.join(',')
  const service={exports:{},uni:{switchTab:v=>navigation.push(v.url),navigateTo:v=>navigation.push(v.url)},require:n=>n==='vue'?{reactive}:n==='./visits.uts'?{apiVisitTime:s=>new Date(Date.parse(s)+8*3600000).toISOString().replace('T',' ').substring(0,16)}:{}}
  vm.runInNewContext(compile(fs.readFileSync(root+'/services/visit-workbench.uts','utf8')),service)
  const wb={exports:{},require:()=>({})};vm.runInNewContext(compile(fs.readFileSync(root+'/services/workbench.uts','utf8')),wb)
  const modules={
    '../../services/session.uts':{session,hasPermission:p=>session.authenticated&&session.permissions.includes(p),requireSession:()=>session.authenticated},
    '../../services/crm.uts':{crmOwner:owner,crmMessage:e=>e.message,crmObject:r=>r,crmCall:url=>new Promise((resolve,reject)=>calls.push({url,resolve,reject}))},
    '../../services/crm-media.uts':{crmUploadState:{pending:0},crmRunUploadQueue:async()=>{}},
    '../../services/visits.uts':{visitToday:()=> '2026-11-12',visitReadKey:owner,loadLocalVisits:()=>{},visitDraftCount:()=>0,hasActiveVisitRecording:()=>false},
    '../../services/workbench.uts':wb.exports,
    '../../services/visit-workbench.uts':{...service.exports,loadVisitBoard:(...args)=>new Promise((resolve,reject)=>calls.push({args,resolve,reject}))}
  }
  const source=fs.readFileSync(root+'/pages/visit-history/visit-history.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const ctx={exports:{},require:n=>modules[n],ref,computed,watch,setTimeout,clearTimeout,
    onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,uni:{showActionSheet:()=>{},navigateTo:v=>navigation.push(v.url)}}
  vm.runInNewContext(compile(source+'\nexports.view={rows,total,loaded,loading,visits,effective,error,period,kind,state};exports.actions={reload,selectPeriod,metric};'),ctx)
  return {...ctx.exports,session,calls,hooks,service:service.exports,navigation}
}
const flush=()=>new Promise(setImmediate)
const response=(id='one',status='SUBMITTED')=>object({items:[{id,storeId:'100',captureId:'capture',name:'门店',address:'四川省成都市武侯区',status,visitedAt:'2026-11-12T01:00:00Z',checkedOutAt:'2026-11-12T01:20:00Z'}],total:1,summary:{totalVisitCount:1,effectiveVisitCount:0,firstVisitCount:1},active:null})
test('history uses the current period and ignores superseded responses and hidden account changes',async()=>{
 const f=fixture();f.hooks.show();f.actions.selectPeriod('month')
 assert.equal(f.calls[1].args[0],'2026-11-01')
 f.calls[1].resolve(response('new'));await flush();f.calls[0].resolve(response('old'));await flush()
 assert.equal(f.view.rows.value[0].id,'new');assert.equal(f.view.effective.value,'0')
 f.hooks.hide();f.session.revision++;await nextTick()
 assert.equal(f.view.rows.value.length,0);assert.equal(f.view.total.value,0);assert.equal(f.view.loaded.value,false)
 assert.equal(f.calls.length,2)
})
test('failure or missing statistics never renders a successful zero count',async()=>{
 const f=fixture();f.hooks.show();f.calls[0].reject(new Error('无法读取'));await flush()
 assert.equal(f.view.visits.value,'—');assert.equal(f.view.error.value,'无法读取')
 f.actions.reload();f.calls[1].resolve(object({items:[],total:0,summary:{},active:null}));await flush()
 assert.equal(f.view.visits.value,'—');assert.match(f.view.error.value,/格式异常/);assert.equal(f.view.loaded.value,false)
})
test('effective and newly visited drilldowns retain dates and use server filters',()=>{
 const f=fixture();f.hooks.show();f.actions.metric('first')
 assert.deepEqual(Array.from(f.calls[1].args).slice(0,4),['2026-11-12','2026-11-12','first','ALL'])
 assert.match(f.service.visitBoardQuery('2026-11-01','2026-11-12','all','SUBMITTED',' 台球 & 店 ',2),/^\/sales\/me\/visit-workbench\?/)
 assert.match(f.service.visitBoardQuery('2026-11-01','2026-11-12','all','SUBMITTED',' 台球 & 店 ',2),/keyword=%E5%8F%B0%E7%90%83%20%26%20%E5%BA%97&page=2/)
 assert.equal(f.service.parseVisitBoardRow(response().getArray('items')[0]).label,'核验中')
})
test('home drilldowns open history directly and retain the supplied period and category',async()=>{
 const f=fixture();f.service.showVisitRecords('2026-10-01','2026-10-31','effective')
 assert.equal(f.navigation[0],'/pages/visit-history/visit-history?from=2026-10-01&to=2026-10-31&kind=effective')
 f.hooks.load({from:'2026-10-01',to:'2026-10-31',kind:'effective'});f.hooks.show()
 assert.deepEqual(Array.from(f.calls[0].args).slice(0,4),['2026-10-01','2026-10-31','effective','ALL'])
})
test('historical capture summary survives a denied CRM customer-material request',async()=>{
 const source=fs.readFileSync(root+'/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const ast=ts.createSourceFile('visit.ts',source,ts.ScriptTarget.Latest,true)
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='reload')
 const fields=['loading','error','ready','baseLoaded','captureId','storeId','storeAddress','timeText','storeName','status','submitted','hasStructuredResult','historicalLabels','verificationState','legacyIntention','note','rules','ending']
 const state=Object.fromEntries(fields.map(k=>[k,{value:''}]))
 state.captureId.value='capture';state.storeId.value='old-store'
 let materialRequests=0,title=''
 const ctx={...state,exports:{},generation:0,Error,crmOwner:()=> 'owner',emptyCaptureRules:()=>({}),appEnvironment:{environment:'test'},visitId:{value:'visit'},
   visitCaptureRules:async()=>({automaticRecording:false,automaticCheckout:false}),
   crmCall:async()=>object({targetSnapshot:{storeName:'历史门店',storeAddress:'北京市朝阳区'},checkedInAt:'start',checkedOutAt:'end',status:'CHECKED_OUT',resultSubmittedAt:'submitted',resultNote:'真实历史摘要'}),
   crmObject:r=>r,visitBoardTime:()=> '10:00–10:20 · 20分钟',crmEndingVisit:()=>false,
   loadVisitFieldwork:async()=>{materialRequests++;throw new Error('forbidden')},
   crmContacts:async()=>{throw new Error('must not request current contacts for submitted history')},
   crmReception:async()=>[],crmVisitRecords:async()=>[],
   crmMessage:e=>e.message,apiErrorMessage:()=> 'forbidden',uni:{setNavigationBarTitle:v=>title=v.title}}
 vm.runInNewContext(compile(node.getText(ast)+'\nexports.reload=reload;'),ctx)
 await ctx.exports.reload()
 assert.equal(materialRequests,1);assert.equal(title,'拜访详情')
 assert.equal(state.storeName.value,'历史门店');assert.equal(state.note.value,'真实历史摘要')
 assert.equal(state.baseLoaded.value,true);assert.equal(state.ready.value,false);assert.equal(state.loading.value,false)
 assert.match(state.error.value,/无权查看/)
})

function capturePageFixture(){
 const source=fs.readFileSync(root+'/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const ast=ts.createSourceFile('visit.ts',source,ts.ScriptTarget.Latest,true)
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='reload')
 const fields=['loading','error','ready','baseLoaded','captureId','storeId','visitId','storeAddress','timeText','storeName','status','submitted','hasStructuredResult','historicalLabels','verificationState','legacyIntention','note','rules','ending','reviewStatus','reviewReason','contacts','selected','receptionText','outcome','intention','minimumClipSeconds','recordingText','draftSaved','fieldwork','dictionaries','syncStatus','remoteRecordingTimes']
 const state=Object.fromEntries(fields.map(k=>[k,{value:''}]))
 state.captureId.value='capture';state.storeId.value='store';state.visitId.value='visit'
 const calls=[],recordings=[];let owner='owner'
 const load=key=>new Promise((resolve,reject)=>calls.push({key,resolve,reject,done:false}))
 const ctx={...state,exports:{},generation:0,Error,crmOwner:()=>owner,emptyCaptureRules:()=>({}),appEnvironment:{environment:'test'},
  emptyVisitFieldwork:()=>({storeRevision:0}),loadVisitFieldwork:()=>load('fieldwork'),visitCaptureRules:()=>load('rules'),crmCall:load,crmObject:r=>r,visitBoardTime:()=> '10:00',crmEndingVisit:()=>false,
  crmEnsureAutomaticRecording:id=>recordings.push(id),ensureCrmDeparture:()=>load('departure'),
  crmContacts:()=>load('contacts'),crmReception:()=>load('reception'),crmVisitRecords:()=>load('visits'),
  crmVisitStatus:s=>s,crmVisitReason:s=>s,applyPhotoStatus:()=>{},refreshMedia:()=>{},draftKey:()=> 'draft',
  crmMessage:e=>e.message,apiErrorMessage:()=> 'forbidden',uni:{setNavigationBarTitle:()=>{},getStorageSync:()=>''}}
 vm.runInNewContext(compile(node.getText(ast)+'\nexports.reload=reload;'),ctx)
 return {state,calls,recordings,reload:ctx.exports.reload,switchOwner:()=>{owner='other'},invalidate:()=>{ctx.generation++},
  resolve:(key,value)=>{const call=calls.find(c=>c.key===key&&!c.done);assert.ok(call,key);call.done=true;call.resolve(object(value))}}
}
test('visit page loads base and materials in parallel and does not hold the form behind departure setup',async()=>{
 const f=capturePageFixture(),pending=f.reload()
 assert.deepEqual(f.calls.map(c=>c.key),['rules','/sales/me/visits/capture'])
 f.resolve('rules',{automaticRecording:true,automaticCheckout:true})
 f.resolve('/sales/me/visits/capture',{status:'CHECKED_IN',targetSnapshot:{storeName:'当前门店'},resultNote:''});await flush()
 assert.equal(f.state.baseLoaded.value,true);assert.equal(f.state.storeName.value,'当前门店');assert.deepEqual(f.recordings,['capture'])
 assert.deepEqual(f.calls.slice(2).map(c=>c.key),['departure','fieldwork','/sales/me/visits/capture/fieldwork','contacts','reception','/sales/me/visits/capture/evidence','/sales/me/visits/capture/recordings','visits'])
 f.resolve('fieldwork',{storeRevision:1,businessStatus:'OPEN',businessTypeCode:'CONFIRMED_TYPE',businesses:[],dictionaries:[],syncStatus:'NONE',visitStatus:'IN_PROGRESS'});f.resolve('/sales/me/visits/capture/fieldwork',{})
 f.resolve('contacts',[{id:'person',name:'接待人',role:'店长',status:'ACTIVE'}]);f.resolve('reception',[{id:'person',name:'接待人',role:'店长'}])
 f.resolve('/sales/me/visits/capture/evidence',{storefrontPhotoCount:0});f.resolve('/sales/me/visits/capture/recordings',{recordingEnabled:true,minimumClipSeconds:30,minimumRecordingSeconds:0,verifiedTotalDurationMs:12345,clips:[{clientClipId:'native',clientDurationMs:null,durationMs:12345}]})
 await flush();assert.equal(f.state.ready.value,false)
 f.resolve('visits',[{id:'visit',status:'IN_PROGRESS',reviewReason:''}]);await pending
 assert.equal(f.state.remoteRecordingTimes.value[0].durationMs,12345);assert.equal(f.state.ready.value,true);assert.equal(f.state.loading.value,false);assert.deepEqual(Array.from(f.state.selected.value),['person'])
 assert.equal(f.calls.find(c=>c.key==='departure').done,false)
 f.resolve('departure',null);await flush()
})
test('a changed account or unloaded page cannot apply delayed base data or start capture services',async()=>{
 for(const action of ['switchOwner','invalidate']){
  const f=capturePageFixture(),pending=f.reload();f[action]()
  f.resolve('rules',{automaticRecording:true,automaticCheckout:true});f.resolve('/sales/me/visits/capture',{status:'CHECKED_IN',targetSnapshot:{storeName:'旧门店'}})
  await pending;assert.equal(f.state.baseLoaded.value,false);assert.equal(f.state.ready.value,false);assert.equal(f.calls.length,2);assert.equal(f.recordings.length,0)
 }
})

test('history entry highlights matching quick periods without changing the query dates',()=>{
 for(const [from,to,expected] of [['2026-11-12','2026-11-12','today'],['2026-11-01','2026-11-12','month'],['2026-10-01','2026-10-31','lastMonth'],['2026-10-05','2026-10-09','range']]){
   const f=fixture();f.hooks.load({from,to});assert.equal(f.view.period.value,expected);f.hooks.show()
   assert.deepEqual(Array.from(f.calls[0].args).slice(0,2),[from,to])
 }
})

function receiptFixture() {
 let owner='tenant:one',payload;const timers=[]
 const ctx={exports:{},uni:{},setTimeout:fn=>{timers.push(fn);return timers.length},clearTimeout:()=>{},require:n=>n==='vue'?{reactive}:n==='./crm.uts'?{crmOwner:()=>owner,crmCall:async()=>payload,crmObject:v=>v}:n==='./visits.uts'?{apiVisitTime:s=>s}:{}}
 vm.runInNewContext(compile(fs.readFileSync(root+'/services/visit-workbench.uts','utf8')),ctx)
 return {api:ctx.exports,timers,set:v=>payload=object(v),switchOwner:()=>owner='tenant:two',read:status=>ctx.exports.loadVisitBoard('2026-11-16','2026-11-16','all',status??'ALL','',1)}
}
const delayedBoard=status=>({items:[{id:'visit',captureId:'capture',status}],active:{id:'visit',captureId:'capture',status:'IN_PROGRESS'},total:1,summary:{totalVisitCount:1,firstVisitCount:1}})
test('confirmed cancellation cannot be overwritten by a delayed projection and shared refresh settles on CRM acknowledgment',async()=>{
 const f=receiptFixture();f.api.rememberVisitReceipt('capture','CANCELLED','2026-11-16T09:00:00Z');f.set(delayedBoard('IN_PROGRESS'))
 const r=await f.read();assert.equal(r.items[0].status,'CANCELLED');assert.equal(r.active,null);assert.equal(r.summary.totalVisitCount,1)
 assert.equal(f.timers.length,1);f.timers[0]();assert.equal(f.api.visitRefresh.revision,1)
 f.set({...delayedBoard('CANCELLED'),active:null,summary:{totalVisitCount:0,firstVisitCount:0}});assert.equal((await f.read()).summary.totalVisitCount,0);assert.equal(f.timers.length,1)
})
test('completed visits leave the active slot immediately without masking later effective judgments',async()=>{
 const f=receiptFixture();f.api.rememberVisitReceipt('capture','SUBMITTED','2026-11-16T09:00:00Z');f.set(delayedBoard('PENDING_SUBMIT'));assert.equal((await f.read()).items[0].status,'SUBMITTED')
 f.set({...delayedBoard('EFFECTIVE'),active:null});assert.equal((await f.read()).items[0].status,'EFFECTIVE')
})
test('receipt refresh is bounded and cannot contaminate another account or a filtered active list',async()=>{
 const f=receiptFixture();f.api.rememberVisitReceipt('capture','CANCELLED','2026-11-16T09:00:00Z')
 for(let i=0;i<8;i++){f.set(delayedBoard('IN_PROGRESS'));const r=await f.read('IN_PROGRESS');assert.equal(r.items.length,0);assert.equal(r.total,0);if(i<f.timers.length)f.timers[i]()}
 assert.equal(f.timers.length,6);f.switchOwner();f.set(delayedBoard('IN_PROGRESS'));assert.equal((await f.read()).items[0].status,'IN_PROGRESS')
})
