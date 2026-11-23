const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), test = require('node:test'), assert = require('node:assert/strict')
const plain = value => JSON.parse(JSON.stringify(value))
function object(value) {
  if (Array.isArray(value)) return value.map(object)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([k,v]) => [k, object(v)]))
  for (const [name,check] of Object.entries({getString:v=>typeof v==='string',getNumber:v=>typeof v==='number',getBoolean:v=>typeof v==='boolean',getJSON:v=>v&&typeof v==='object'&&!Array.isArray(v),getArray:Array.isArray})) Object.defineProperty(result,name,{value:k=>check(result[k])?result[k]:null})
  return result
}
function load(file, modules={}) { const ctx={exports:{},require:n=>modules[n]??{}, Map, Error}; vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx);return ctx.exports }
const form = load('app/services/visit-fieldwork.uts'), recording = load('app/services/visit-recording-time.uts')
const dictionaries = Object.entries({CRM_STORE_BUSINESS_STATUS:['OPEN','TEMP_CLOSED','CLOSED','UNKNOWN'],STORE_BUSINESS_TYPE:['TYPE'],VISIT_CONTACT_OUTCOME:['CONTACTED','OTHER_NO_CONTACT'],VISIT_NO_CONTACT_REASON:['BUSY','OTHER'],BUSINESS_LINE:['LINE','SECOND'],CUSTOMER_INTENTION_LEVEL:['HIGH','MEDIUM','LOW','NONE'],CUSTOMER_COOP_STATUS:['COOPERATED'],VISIT_NEXT_ACTION:['CONTACT']}).map(([code,values])=>({code,options:values.map(code=>({code,name:code}))}))
const valid = () => ({...form.emptyVisitFieldwork(),storeRevision:3,businessStatus:'OPEN',businessTypeCode:'TYPE',contactOutcome:'CONTACTED',contactIds:['person'],noIntention:true})
test('missing fields identify the first field and every required omission',()=>{
  const errors=plain(form.validateVisitFieldwork(form.emptyVisitFieldwork(),dictionaries,0,2))
  assert.deepEqual(errors.map(e=>e.field),['status','type','outcome','photos']);assert.equal(errors[3].message,'请拍摄至少2张门头照')
})
test('conditional requirements match contacted, closed, and no-contact scenarios',()=>{
  let d=valid();assert.deepEqual(plain(form.validateVisitFieldwork(d,dictionaries,1,1)),[])
  d.businessStatus='CLOSED';assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1)[0].message,'请填写停业依据')
  d={...valid(),contactOutcome:'OTHER_NO_CONTACT',contactIds:[],noIntention:false,noContactReason:'BUSY'};assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1).length,0)
  d.noContactReason='OTHER';assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1)[0].field,'reason-detail')
  d.noContactDetail='没有接待';assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1).length,0)
})
test('each business needs progress and cooperation remains separate from intention',()=>{
 const d={...valid(),noIntention:false,businesses:[{businessLineCode:'LINE',intentionLevel:'',cooperationStatus:''}]}
 assert.match(form.validateVisitFieldwork(d,dictionaries,1,1)[0].message,/LINE.*合作进展/)
 d.businesses[0].cooperationStatus='COOPERATED';assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1).length,0)
 assert.equal(form.visitFieldworkBody(d).businesses[0].intentionLevel,'')
 d.businesses[0].businessLineCode='DISABLED';assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1)[0].message,'请重新选择有效业务')
})
test('switching contact outcome excludes hidden selections and follow-up fields are paired',()=>{
 const d={...valid(),contactOutcome:'OTHER_NO_CONTACT',noContactReason:'BUSY',businesses:[{businessLineCode:'LINE',intentionLevel:'HIGH',cooperationStatus:''}],nextAction:'CONTACT'}
 const body=plain(form.visitFieldworkBody(d));assert.deepEqual(body.contactIds,[]);assert.deepEqual(body.businesses,[]);assert.equal(body.noIntention,false);assert.equal(body.nextContactDate,null)
 assert.equal(form.validateVisitFieldwork(d,dictionaries,1,1).at(-1).message,'请选择下次跟进日期')
})
test('recording clock continues through five-minute rollover, upload, resume and restart',()=>{
 const clip={id:'first',durationMs:300000}
 assert.equal(recording.visitRecordingTotal([],[],299000),299000)
 assert.equal(recording.visitRecordingTotal([clip],[],0),300000)
 assert.equal(recording.visitRecordingTotal([clip],[clip],17000),317000)
 assert.equal(recording.visitRecordingTotal([clip,clip],[clip],17000),317000)
 assert.equal(recording.visitRecordingTotal([],[clip],0),300000)
 assert.equal(recording.visitRecordingTotal([clip,{id:'short-tail',durationMs:12000}],[],0),312000)
 // Interruptions contribute no wall-clock time; only recorded samples are accumulated.
 assert.equal(recording.visitRecordingTotal([clip],[],17000),317000)
})
test('inline receptionist creation stays in place, preserves draft, selects result and prevents duplicate requests',async()=>{
 const storage=new Map(), requests=[];let finish
 const crm={crmOwner:()=> 'tenant:user',crmMessage:e=>e.message,crmObject:r=>r.getJSON('data'),crmContact:r=>({id:r.getString('id'),name:r.getString('name'),role:r.getString('role'),status:'ACTIVE'}),crmMutation:(...args)=>{requests.push(args);return new Promise(resolve=>finish=resolve)}}
 const modules={'../../services/crm.uts':crm,'../../services/visit-fieldwork.uts':form,'../../services/visit-recording-time.uts':recording,'../../services/visit-policy.uts':{emptyCaptureRules:()=>({})},'../../services/session.uts':{session:{authenticated:true}},'../../services/crm-media.uts':{crmMediaOwner:()=> 'tenant:user'},'../../services/crm-departure.uts':{crmDeparture:{}}}
 const source=fs.readFileSync('app/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const ctx={exports:{},require:n=>modules[n]??{},ref:value=>({value}),computed:f=>({get value(){return f()}}),watch:()=>{},onBackPress:()=>{},onLoad:()=>{},onShow:()=>{},onHide:()=>{},onUnload:()=>{},nextTick:f=>f(),setTimeout:f=>f(),uni:{getElementById:()=>null,getStorageSync:k=>storage.get(k)??'',setStorageSync:(k,v)=>storage.set(k,v),navigateTo:()=>{throw Error('must stay on visit page')}},Promise,Error,Map}
 vm.runInNewContext(ts.transpileModule(source+'\nexports.api={ready,note,outcome,fieldwork,dictionaries,selected,storeId,captureId,sheet,contactName,contactRole,contactBusy,manageContacts,openPeople,closeSheet,chooseRole,addContact};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx)
 const a=ctx.exports.api;a.ready.value=true;a.storeId.value='store';a.captureId.value='visit';a.note.value='已写好的沟通内容';a.outcome.value='CONTACTED';a.fieldwork.value=valid();a.dictionaries.value=[...dictionaries,{code:'STORE_CONTACT_ROLE',options:[{code:'MANAGER',name:'店长'}]}]
 a.openPeople();assert.equal(a.sheet.value,'people');a.manageContacts();assert.equal(a.sheet.value,'contact');a.contactName.value='未保存称呼';a.closeSheet();assert.equal(a.sheet.value,'people');a.manageContacts();assert.equal(a.contactName.value,'未保存称呼');a.contactName.value='陈店长';a.chooseRole({detail:{value:0}});assert.equal(a.contactRole.value,'MANAGER')
 const pending=a.addContact();await a.addContact();assert.equal(requests.length,1);assert.equal(a.contactBusy.value,true)
 finish(object({data:{id:'new-person',name:'陈店长',role:'店长'}}));await pending
 assert.deepEqual(plain(a.selected.value),['new-person']);assert.equal(a.note.value,'已写好的沟通内容');assert.equal(a.fieldwork.value.businessTypeCode,'TYPE');assert.equal(a.sheet.value,'');assert.equal(a.contactBusy.value,false)
 assert.match([...storage.values()].at(-1),/已写好的沟通内容/)
})

test('server rejections focus the precise field without hiding non-field failures',()=>{
 assert.deepEqual(plain(form.visitServerFieldError('接待人已变更，请重新选择')),{field:'contacts',message:'接待人已变更，请重新选择'})
 assert.equal(form.visitServerFieldError('请选择下次跟进日期').field,'followup')
 assert.equal(form.visitServerFieldError('请补充未接触原因').field,'reason-detail')
 assert.equal(form.visitServerFieldError('门店资料已更新，请刷新后确认'),null)
 assert.equal(form.visitServerFieldError('网络不可用'),null)
})
