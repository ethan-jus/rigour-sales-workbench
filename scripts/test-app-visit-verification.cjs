const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const flush=()=>new Promise(setImmediate)
function fixture(page='visit-appeal'){
 const hooks={},requests=[],navigation=[];let owner='tenant:user',value={state:'FAILED',label:'核验未通过',reason:'录音不足',revision:4,canAppeal:true,appeals:[]},readError=null
 const modules={'../../services/crm.uts':{crmOwner:()=>owner,crmMessage:e=>e.message},'../../services/visit-verification.uts':{readVisitVerification:async()=>{if(readError)throw readError;return value},appealVisit:(...args)=>new Promise((resolve,reject)=>requests.push({args,resolve,reject}))}}
 const ctx={exports:{},require:n=>modules[n],ref:value=>({value}),computed:f=>({get value(){return f()}}),onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onUnload:f=>hooks.unload=f,Promise,Error,encodeURIComponent,uni:{navigateTo:q=>navigation.push(q.url),navigateBack:()=>navigation.push('back'),showToast:()=>{}}}
 const source=fs.readFileSync(`app/pages/${page}/${page}.uvue`,'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const exposed=page==='visit-appeal'?'result,reason,reasonError,error,busy,submit,evidence,load':'result,error,openAppeal,load'
 vm.runInNewContext(ts.transpileModule(source+`\nexports.api={${exposed}}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,ctx)
 return {api:ctx.exports.api,hooks,requests,navigation,setResult:v=>value=v,setReadError:v=>readError=v,switchOwner:()=>owner='tenant:other',async enter(){hooks.load({store:'store',visit:'visit',capture:'capture',name:'示例门店'});hooks.show();await flush()}}
}
test('appeal rejects whitespace and sends the server revision only once during rapid taps',async()=>{
 const f=fixture();await f.enter();f.api.reason.value='  ';await f.api.submit();assert.equal(f.requests.length,0);assert.equal(f.api.reasonError.value,'请填写申诉原因')
 f.api.reason.value='请复核原始录音';const pending=f.api.submit();await f.api.submit();assert.equal(f.requests.length,1);assert.deepEqual(f.requests[0].args,['store','visit',4,'请复核原始录音'])
 f.requests[0].resolve({state:'APPEALED',canAppeal:false,revision:5});await pending;assert.equal(f.api.busy.value,false);assert.equal(f.api.reason.value,'');assert.deepEqual(f.navigation,['back'])
})
test('return from evidence keeps the appeal draft while refreshing permission and revision',async()=>{
 const f=fixture();await f.enter();f.api.reason.value='已写好的说明';f.api.evidence();assert.match(f.navigation[0],/visit-evidence.*capture/)
 f.setResult({state:'FAILED',canAppeal:true,revision:7});f.hooks.show();await flush();assert.equal(f.api.reason.value,'已写好的说明');assert.equal(f.api.result.value.revision,7)
 f.setResult({state:'APPEALED',canAppeal:false,revision:8});f.hooks.show();await flush();await f.api.submit();assert.equal(f.requests.length,0)
})
test('failed appeal preserves text and requires a successful permission refresh before retry',async()=>{
 const f=fixture();await f.enter();f.api.reason.value='保留这段说明';const pending=f.api.submit();f.requests[0].reject(Error('核验状态已更新'));await pending;assert.equal(f.api.reason.value,'保留这段说明');await f.api.submit();assert.equal(f.requests.length,1)
 f.setResult({state:'FAILED',canAppeal:true,revision:9});await f.api.load();const retry=f.api.submit();assert.equal(f.requests[1].args[2],9);f.requests[1].resolve({canAppeal:false});await retry
})
test('account switch prevents a late appeal receipt from navigating or clearing another page',async()=>{
 const f=fixture();await f.enter();f.api.reason.value='旧账号说明';const pending=f.api.submit();f.switchOwner();f.hooks.show();assert.equal(f.api.reason.value,'');assert.equal(f.api.result.value,null);assert.deepEqual(f.navigation,['back']);f.requests[0].resolve({canAppeal:false});await pending;assert.deepEqual(f.navigation,['back'])
})
test('verification entry obeys canAppeal and reloads after returning from the child page',async()=>{
 const f=fixture('visit-verification');await f.enter();f.api.openAppeal();assert.match(f.navigation[0],/visit-appeal.*store=store.*capture=capture/)
 f.setResult({state:'APPEALED',canAppeal:false,revision:5,appeals:[]});f.hooks.show();await flush();f.api.openAppeal();assert.equal(f.navigation.length,1)
 f.setReadError(Error('暂时无法读取'));await f.api.load();assert.equal(f.api.error.value,'暂时无法读取');f.api.openAppeal();assert.equal(f.navigation.length,1)
})
