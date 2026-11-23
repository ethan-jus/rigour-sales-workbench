const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const flush=()=>new Promise(setImmediate)
function fixture(storage=new Map()) {
 let owner='tenant:user';const calls=[],events=[],hooks={};let finish=async()=>{},photos=async()=>{},takePhoto=async()=>{}
 const modules={
  '../../services/crm.uts':{crmOwner:()=>owner,crmObject:r=>({getString:k=>r[k]??null}),crmMessage:e=>e.message,crmId:()=> 'completion-id',crmRecentVisitLocation:p=>p,crmCall:(url,method,body)=>new Promise((resolve,reject)=>calls.push({url,method,body,resolve,reject}))},
  '../../services/visit-workbench.uts':{rememberVisitReceipt:()=>{}},
  '../../services/customer-nearby.uts':{customerNearbyVisitLocation:()=>({longitude:120.1,latitude:30.2,accuracyMeters:10,source:'APP_NATIVE'}),customerNearbyLocation:()=>{throw Error('fresh cached point must be reused')}},
  '../../services/crm-media.uts':{crmTakePhoto:()=>{events.push('camera');return takePhoto()},crmMediaOwner:()=>owner,crmFinishRecording:()=>{events.push('stop');return finish()},crmUploadPhotos:()=>{events.push('photos');return photos()},crmUpload:()=>{throw Error('completion must not wait for the audio upload queue')},crmCompleteRecording:()=>events.push('queue'),crmEndingVisit:()=>true,crmRecorder:{},crmRecording:()=>false,crmMedia:()=>({photos:[],recordings:[]})},
  '../../services/crm-departure.uts':{crmDeparture:{},stopCrmDeparture:()=>events.push('stop-monitor')},
  '../../services/visit-fieldwork.uts':{emptyVisitFieldwork:()=>({}),visitFieldworkBody:d=>d,validateVisitFieldwork:()=>[],visitServerFieldError:m=>m==='请选择接待人'?{field:'contacts',message:m}:null},
  '../../services/visit-policy.uts':{emptyCaptureRules:()=>({maximumLocationAccuracyMeters:100})},
  '../../services/session.uts':{session:{authenticated:true}},'../../services/api.uts':{apiErrorMessage:code=>code},
  '../../services/customer-cache.uts':{invalidateCustomerCache:()=>events.push('invalidate')},'../../services/config.uts':{appEnvironment:{environment:'test'}}}
 const ctx={exports:{},require:n=>modules[n]??{},ref:value=>({value}),computed:f=>({get value(){return f()}}),watch:()=>{},nextTick:f=>f(),onBackPress:()=>{},onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,Promise,Error,Map,Date,console,setInterval,clearInterval,uni:{getStorageSync:k=>storage.get(k)??'',setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),showToast:v=>events.push(v.title),navigateBack:()=>events.push('back')}}
 const source=fs.readFileSync('app/pages/crm-visit/crm-visit.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 vm.runInNewContext(ts.transpileModule(source+'\npageVisible = true; exports.api={takePhoto,photoCaptureActive,completeVisit,cancelVisit,ready,busy,status,submitted,captureId,fieldwork,photoCount,note,outcome,fieldErrors,error,completionStage};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
 const a=ctx.exports.api;a.ready.value=true;a.status.value='CHECKED_IN';a.captureId.value='capture';a.photoCount.value=1;a.outcome.value='CONTACTED';a.fieldwork.value={businessStatus:'OPEN',nextAction:'PROPOSAL'}
 return{a,calls,events,storage,leave:()=>hooks.unload(),delayTakePhoto:f=>takePhoto=f,delayFinish:f=>finish=f,delayPhotos:f=>photos=f,switchOwner:()=>owner='other',invalid:()=>modules['../../services/visit-fieldwork.uts'].validateVisitFieldwork=()=>[{field:'contacts',message:'请选择接待人'}]}
}
test('complete prepares location, photos and recording concurrently, then sends one atomic command and blocks rapid taps',async()=>{
 const f=fixture();let finish,photos;f.delayFinish(()=>new Promise(r=>finish=r));f.delayPhotos(()=>new Promise(r=>photos=r))
 const pending=f.a.completeVisit();await f.a.completeVisit();assert.deepEqual(f.events,['stop','photos']);assert.equal(f.calls.length,0)
 finish();await flush();assert.equal(f.calls.length,0);photos();await flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].url,'/sales/me/visits/capture/complete');assert.equal(f.calls[0].body.checkout.location.longitude,120.1)
 f.calls[0].resolve({});await pending;assert.equal(f.a.status.value,'CHECKED_OUT');assert.equal(f.a.busy.value,false);assert.equal(f.events.filter(v=>v==='back').length,1);assert.ok(f.events.includes('queue'))
})
test('uncertain submission preserves the exact command across page recreation without stopping or locating twice',async()=>{
 const f=fixture();const pending=f.a.completeVisit();await flush();const body=JSON.stringify(f.calls[0].body);f.calls[0].reject(Error('网络中断'));await pending
 assert.equal(f.a.submitted.value,false);assert.ok(!f.events.includes('back'))
 const retry=fixture(f.storage);retry.a.note.value='用户重进页面';const p=retry.a.completeVisit();await flush();assert.deepEqual(retry.events,[]);assert.equal(JSON.stringify(retry.calls[0].body),body)
 retry.calls[0].resolve({});await p;assert.equal(retry.storage.size,0)
})
test('required-field rejection leaves form editable and focuses the exact field',async()=>{
 const f=fixture();f.invalid();await f.a.completeVisit();assert.equal(f.calls.length,0);assert.equal(f.a.fieldErrors.value[0].field,'contacts');assert.deepEqual(f.events,['请选择接待人'])
})
test('cancel ignores form requirements, stops recording, prevents duplicate requests and clears draft only after receipt',async()=>{
 const f=fixture();f.invalid();let finish;f.delayFinish(()=>new Promise(r=>finish=r));const p=f.a.cancelVisit();await f.a.cancelVisit();assert.deepEqual(f.events,['stop-monitor','stop']);assert.equal(f.calls.length,0)
 finish();await flush();assert.equal(f.calls[0].url,'/sales/me/visits/capture/cancel');f.calls[0].reject(Error('网络中断'));await p;assert.equal(f.a.submitted.value,false);assert.ok(!f.events.includes('back'))
 f.delayFinish(async()=>{});const retry=f.a.cancelVisit();await flush();f.calls[1].resolve({});await retry;assert.equal(f.a.status.value,'CANCELLED');assert.ok(f.events.includes('back'))
})
test('changing accounts during preparation does not submit old visit or clear the new account',async()=>{
 const f=fixture();let finish;f.delayFinish(()=>new Promise(r=>finish=r));const p=f.a.completeVisit();f.switchOwner();finish();await p;assert.equal(f.calls.length,0);assert.ok(!f.events.includes('invalidate'))
})

test('a late completion receipt clears the acknowledged command without navigating another page',async()=>{
 const f=fixture();const pending=f.a.completeVisit();await flush();f.leave();f.calls[0].resolve({});await pending
 assert.equal(f.storage.size,0);assert.ok(f.events.includes('queue'));assert.ok(!f.events.includes('back'))
})

test('photo button reports pending work, blocks duplicate taps and recovers after cancellation',async()=>{
 const f=fixture();let fail;f.delayTakePhoto(()=>new Promise((resolve,reject)=>fail=reject))
 const pending=f.a.takePhoto();await f.a.takePhoto()
 assert.deepEqual(f.events,['camera']);assert.equal(f.a.photoCaptureActive.value,true);assert.equal(f.a.busy.value,true)
 fail(Error('拍照未完成'));await pending
 assert.equal(f.a.photoCaptureActive.value,false);assert.equal(f.a.busy.value,false)
 assert.equal(f.a.error.value,'拍照未完成')
 f.delayTakePhoto(async()=>{});await f.a.takePhoto();assert.deepEqual(f.events,['camera','camera'])
 assert.equal(f.a.error.value,'');assert.equal(f.a.photoCaptureActive.value,false)
})
