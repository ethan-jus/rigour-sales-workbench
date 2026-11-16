const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript')
const test=require('node:test'),assert=require('node:assert/strict')
const {reactive,ref,computed,watch,nextTick}=require('vue')
const root=path.resolve(__dirname,'../app')
const compile=source=>ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function object(value) {
  if(value==null||typeof value!=='object')return value
  if(Array.isArray(value))return value.map(object)
  const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,object(v)]))
  Object.defineProperties(out,{getString:{value:k=>typeof out[k]==='string'?out[k]:null},getNumber:{value:k=>typeof out[k]==='number'?out[k]:null},getJSON:{value:k=>out[k]??null},getArray:{value:k=>out[k]??null}})
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
 assert.equal(f.service.parseVisitBoardRow(response().getArray('items')[0]).label,'待核验')
})
test('home drilldowns open history directly and retain the supplied period and category',async()=>{
 const f=fixture();f.service.showVisitRecords('2026-10-01','2026-10-31','effective')
 assert.equal(f.navigation[0],'/pages/visit-history/visit-history?from=2026-10-01&to=2026-10-31&kind=effective')
 f.hooks.load({from:'2026-10-01',to:'2026-10-31',kind:'effective'});f.hooks.show()
 assert.deepEqual(Array.from(f.calls[0].args).slice(0,4),['2026-10-01','2026-10-31','effective','ALL'])
})
test('complete visit never checks out after an unsuccessful result save',async()=>{
 const source=fs.readFileSync(root+'/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const ast=ts.createSourceFile('visit.ts',source,ts.ScriptTarget.Latest,true)
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='completeVisit')
 let leaves=0;const state={busy:{value:false},ready:{value:true},submitted:{value:false},error:{value:''},status:{value:'CHECKED_IN'}}
 const ctx={...state,exports:{},saveResult:async()=>{state.error.value='保存失败'},leave:async()=>leaves++}
 vm.runInNewContext(compile(node.getText(ast)+'\nexports.complete=completeVisit;'),ctx)
 await ctx.exports.complete();assert.equal(leaves,0)
 ctx.saveResult=async()=>{state.submitted.value=true;state.error.value=''}
 await ctx.exports.complete();assert.equal(leaves,1)
})

test('historical capture summary survives a denied CRM customer-material request',async()=>{
 const source=fs.readFileSync(root+'/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const ast=ts.createSourceFile('visit.ts',source,ts.ScriptTarget.Latest,true)
 const node=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name.text==='reload')
 const fields=['loading','error','ready','baseLoaded','captureId','storeId','storeAddress','timeText','storeName','status','submitted','note','rules','ending']
 const state=Object.fromEntries(fields.map(k=>[k,{value:''}]))
 state.captureId.value='capture';state.storeId.value='old-store'
 let materialRequests=0,title=''
 const ctx={...state,exports:{},generation:0,Error,
   visitCaptureRules:async()=>({automaticRecording:false,automaticCheckout:false}),
   crmCall:async()=>object({targetSnapshot:{storeName:'历史门店',storeAddress:'北京市朝阳区'},checkedInAt:'start',checkedOutAt:'end',status:'CHECKED_OUT',resultSubmittedAt:'submitted',resultNote:'真实历史摘要'}),
   crmObject:r=>r,visitBoardTime:()=> '10:00–10:20 · 20分钟',crmEndingVisit:()=>false,
   crmContacts:async()=>{materialRequests++;throw new Error('forbidden')},
   crmMessage:e=>e.message,apiErrorMessage:()=> 'forbidden',uni:{setNavigationBarTitle:v=>title=v.title}}
 vm.runInNewContext(compile(node.getText(ast)+'\nexports.reload=reload;'),ctx)
 await ctx.exports.reload()
 assert.equal(materialRequests,1);assert.equal(title,'拜访详情')
 assert.equal(state.storeName.value,'历史门店');assert.equal(state.note.value,'真实历史摘要')
 assert.equal(state.baseLoaded.value,true);assert.equal(state.ready.value,false);assert.equal(state.loading.value,false)
 assert.match(state.error.value,/无权查看/)
})

test('history entry highlights matching quick periods without changing the query dates',()=>{
 for(const [from,to,expected] of [['2026-11-12','2026-11-12','today'],['2026-11-01','2026-11-12','month'],['2026-10-01','2026-10-31','lastMonth'],['2026-10-05','2026-10-09','range']]){
   const f=fixture();f.hooks.load({from,to});assert.equal(f.view.period.value,expected);f.hooks.show()
   assert.deepEqual(Array.from(f.calls[0].args).slice(0,2),[from,to])
 }
})
