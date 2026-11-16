const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
function object(value) {
  const result = { ...value }
  for (const [name, type] of [['getString','string'],['getNumber','number'],['getBoolean','boolean'],['getJSON','object']])
    Object.defineProperty(result,name,{value:key => typeof result[key] === type ? (type === 'object' ? object(result[key]) : result[key]) : null})
  return result
}
function fixture(storage = new Map()) {
  let account='tenant:user', revision=1, now=100000, onPoint=null, accountChanged=null, permission='authorized', failCheckout=false, ended=false
  const requests=[], calls=[], intervals=[]
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [now])) } static now() { return now } }
  const modules={
    vue:{reactive:x=>x,watch:(_get,cb)=>{accountChanged=cb}},
    './crm.uts':{crmOwner:()=>account+':'+revision,crmId:()=> 'key',crmMessage:e=>e.message,crmObject:r=>object(r.data),crmCall:async(url,method,body)=>{
      requests.push({url,method,body})
      if(url.endsWith('/auto-departure-context')) return {data:{enabled:true,status:'CHECKED_IN',radiusMeters:500,maximumLocationAccuracyMeters:100,longitude:120,latitude:30}}
      if(url.endsWith('/normalize')) return {data:{longitude:body.longitude,latitude:body.latitude,coordinateSystem:'GCJ02'}}
      if(url.endsWith('/auto-check-out')) { calls.push('checkout'); if(failCheckout) throw new Error('offline'); ended=true; return {data:{status:'CHECKED_OUT'}} }
      return {data:{status:ended?'CHECKED_OUT':'CHECKED_IN'}}
    }},
    './crm-media.uts':{crmMediaOwner:()=>account,crmEndingVisit:()=>false,crmFinishRecording:async()=>calls.push('stop'),crmCompleteRecording:()=>calls.push('queue')}
  }
  const uni={ getStorageSync:k=>storage.get(k)??'',setStorageSync:(k,v)=>storage.set(k,v),removeStorageSync:k=>storage.delete(k),
    onLocationChange:cb=>{onPoint=cb;return 1},offLocationChange:()=>{onPoint=null},onLocationChangeError:()=>2,offLocationChangeError:()=>{},
    startLocationUpdateBackground:o=>{calls.push('listen');o.success()},stopLocationUpdate:()=>calls.push('unlisten'),getAppAuthorizeSetting:()=>({locationAuthorized:permission}) }
  modules['./background-location.uts']={acquireBackgroundLocation:async(_key,point,error)=>{onPoint=point;calls.push('listen')},releaseBackgroundLocation:()=>{if(onPoint!=null)calls.push('unlisten');onPoint=null}}
  const source=fs.readFileSync('app/services/crm-departure.uts','utf8')
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
  const ctx={exports:{},require:n=>modules[n],uni,Date:Clock,Math,Number,Error,JSON:{parse:s=>object(JSON.parse(s)),stringify:JSON.stringify},setInterval:fn=>{intervals.push(fn);return intervals.length}}
  vm.runInNewContext(compiled,ctx)
  return {api:ctx.exports,requests,calls,storage,fail:value=>{failCheckout=value},permission:value=>{permission=value},switchAccount:()=>{account='tenant:other';revision++;accountChanged()},
    point:async(longitude,accuracy=20,advance=20000)=>{now+=advance;onPoint?.({longitude,latitude:30,accuracy}); await new Promise(resolve=>setImmediate(resolve))},
    retry:async()=>{for(const fn of intervals)fn();await new Promise(resolve=>setImmediate(resolve))}}
}
test('departure ignores boundary jitter and poor accuracy, then stops before checkout and queues uploads',async()=>{
 const f=fixture();f.api.startCrmDeparture();await f.api.ensureCrmDeparture('visit')
 await f.point(120.0053,40); await f.point(120.02,200)
 assert.equal(f.calls.includes('stop'),false)
 await f.point(120.02); assert.equal(f.calls.includes('stop'),false)
 await f.point(120.02)
 assert.deepEqual(f.calls.slice(-3),['stop','checkout','queue'])
 assert.ok(f.calls.indexOf('stop')<f.calls.indexOf('checkout'))
 assert.equal(f.api.crmDeparture.completedRevision,1)
 assert.equal(f.requests.find(r=>r.url.endsWith('/auto-check-out')).body.location.source,'APP_NATIVE')
})
test('failed automatic checkout survives restart with the same body and owner',async()=>{
 const f=fixture();f.api.startCrmDeparture();await f.api.ensureCrmDeparture('visit');f.fail(true)
 await f.point(120.02);await f.point(120.02)
 const first=f.requests.find(r=>r.url.endsWith('/auto-check-out')).body
 const next=fixture(f.storage);next.api.startCrmDeparture();await next.api.resumeCrmDeparture()
 assert.equal(JSON.stringify(next.requests.find(r=>r.url.endsWith('/auto-check-out')).body),JSON.stringify(first))
 assert.equal(next.api.crmDeparture.completedRevision,1)
})
test('switching accounts removes active location listeners without completing another user visit',async()=>{
 const f=fixture();f.api.startCrmDeparture();await f.api.ensureCrmDeparture('visit');await f.point(120.02);f.switchAccount();await f.point(120.02)
 assert.equal(f.calls.includes('checkout'),false)
 assert.ok(f.calls.includes('unlisten'))
})
test('cold resume does not request location without prior permission',async()=>{
 const f=fixture();await f.api.ensureCrmDeparture('visit')
 const next=fixture(f.storage);next.permission('denied');await next.api.resumeCrmDeparture()
 assert.equal(next.calls.includes('listen'),false)
})
