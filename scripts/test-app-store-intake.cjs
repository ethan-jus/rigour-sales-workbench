const fs=require('node:fs'), vm=require('node:vm'), path=require('node:path'), ts=require('typescript')
const test=require('node:test'), assert=require('node:assert/strict')
function object(v) {
 if(Array.isArray(v))return v.map(object)
 if(!v||typeof v!=='object')return v
 const r=Object.fromEntries(Object.entries(v).map(([k,v])=>[k,object(v)]))
 for(const [n,t] of [['getString','string'],['getNumber','number'],['getJSON','object'],['getArray','object']]) Object.defineProperty(r,n,{value:k=>typeof r[k]===t?r[k]:null})
 return r
}
function fixture(module='store-intake'){
 let owner='tenant:user', handler=()=>({data:{}}), sequence=0, invalidations=0
 const calls=[],navigation=[],gps=[]
 const call=async(...args)=>{calls.push(args);return object(await handler(...args))}
 const modules={
 './crm.uts':{crmCall:call,crmMutation:call,crmObject:r=>r.data,crmId:()=>String(++sequence),crmOwner:()=>owner},
 './customer-cache.uts':{invalidateCustomerCache:()=>invalidations++},
 './location.uts':{requestDeviceLocation:success=>gps.push(success)},
 './customer-nearby.uts':{nearbyDistanceText:d=>d==null?'':d+'米'},
 'vue':{reactive:v=>v}}
 const ctx={exports:{},require:n=>modules[n],JSON:{stringify:JSON.stringify,parse:s=>object(JSON.parse(s))},uni:{navigateTo:o=>navigation.push(o),switchTab:o=>navigation.push(o)}}
 const source=fs.readFileSync(path.join(__dirname,'../app/services/'+module+'.uts'),'utf8')
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
 return {api:ctx.exports,calls,navigation,gps,respond:f=>handler=f,owner:v=>owner=v,invalidations:()=>invalidations}
}
const poi={id:'B001',name:'门店',address:'真实地址',publicPhone:null,typeCode:'080113',areaCode:'330105',longitude:120.1,latitude:30.2}
const lead={id:'22',...poi,coordinateSystem:'GCJ02',storeTypeCode:'POI_080113',status:'PENDING_REVIEW',revision:1}
test('discovery preserves server classification and rejects unknown state, missing store identity and invalid coordinates',()=>{
 const f=fixture()
 for(const state of ['NEW','REVIEW','PUBLIC','MINE','UNAVAILABLE']){
 const row=f.api.parseIntakeCandidate(object({poi,state,storeId:['PUBLIC','MINE'].includes(state)?'123':null,distanceMeters:25}))
 assert.equal(row.state,state);assert.equal(row.poi.phone,'');assert.equal(row.distance,'25米')
 }
 for(const row of [{poi,state:'FUTURE'},{poi,state:'MINE'},{poi:{...poi,longitude:null},state:'NEW'}])assert.throws(()=>f.api.parseIntakeCandidate(object(row)))
})
test('discovery sends GCJ02 coordinates and the selected radius without changing location values',async()=>{
 const f=fixture();f.respond(()=>({data:{items:[{poi,state:'NEW'}],coordinateSystem:'GCJ02'}}))
 await f.api.intakeDiscover(' 测试门店 ','330105',{longitude:120.1,latitude:30.2},1000)
 assert.match(f.calls[0][0],/longitude=120.1&latitude=30.2&coordinateSystem=GCJ02&radiusMeters=1000/)
 f.respond(()=>({data:{items:[],coordinateSystem:'WGS84'}}));await assert.rejects(()=>f.api.intakeDiscover('店','330105',null,1000))
})
test('Amap admission posts only the POI identity to the existing backend intake rule',async()=>{
 const f=fixture();f.respond(()=>({data:{storeId:'123'}}));assert.equal(await f.api.intakeAdmit('B001'),'123')
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0])),['/crm/stores/intake/amap','POST',{poiId:'B001'}])
 f.api.openIntakeStore('123','MINE',false);assert.equal(f.navigation[0].url,'/pages/customer-detail/customer-detail?id=123&source=MINE')
})
test('manual retry reuses request identity, resubmission preserves revision and a new account gets a new identity',async()=>{
 const f=fixture(),draft={name:'门店',address:'地址',areaCode:'330105',longitude:120.1,latitude:30.2,coordinateSystem:'GCJ02',publicPhone:null,storeTypeCode:'POI_080113'}
 f.respond(()=>{throw new Error('网络中断')});await assert.rejects(()=>f.api.intakeSubmit(draft,'22',3))
 f.respond(()=>({data:lead}));await f.api.intakeSubmit(draft,'22',3)
 assert.equal(f.calls[0][2].proposal.requestId,f.calls[1][2].proposal.requestId);assert.equal(f.calls[1][2].revision,3);assert.equal(f.calls[1][1],'PUT');assert.equal(f.invalidations(),1)
 f.owner('tenant:other');await f.api.intakeSubmit(draft,'',0);assert.notEqual(f.calls[2][2].requestId,f.calls[1][2].proposal.requestId)
})
test('device fix uses WGS84 conversion and account changes discard a pending fix before any lookup',async()=>{
 const f=fixture();f.respond(()=>({data:{status:'RESOLVED',formattedAddress:'地址',adcode:'330105',amapLongitude:120.105,amapLatitude:30.202}}))
 let pending=f.api.intakeDevicePoint();f.gps[0]({longitude:120.1,latitude:30.2,accuracy:15});assert.equal((await pending).longitude,120.105);assert.match(f.calls[0][0],/coordinateSystem=WGS84/)
 pending=f.api.intakeDevicePoint();f.owner('tenant:other');f.gps[1]({longitude:120.1,latitude:30.2,accuracy:15});await assert.rejects(pending,/账号已变更/);assert.equal(f.calls.length,1)
})
test('manual seed is consumed once and never crosses accounts',()=>{
 const f=fixture();f.api.intakeManual(poi);assert.equal(f.api.takeIntakeSeed().id,'B001');assert.equal(f.api.takeIntakeSeed(),null)
 f.api.intakeManual(poi);f.owner('other');assert.equal(f.api.takeIntakeSeed(),null)
})
test('attendance return uses the existing detail with plan context, clears only after navigation and rejects a different account',()=>{
 const f=fixture('visit-return');f.api.signInForStore('123','门店','plan-1');assert.match(f.navigation[0].url,/pages\/visits\/visits$/)
 f.api.returnToVisitStore();assert.match(f.navigation[1].url,/customer-detail\?id=123&source=MINE&plan=plan-1$/);assert.equal(f.api.visitReturnReady(),true)
 f.navigation[1].success({});assert.equal(f.api.visitReturnReady(),false)
 f.api.signInForStore('123','门店','');f.owner('other');f.api.returnToVisitStore();assert.equal(f.navigation.length,3);assert.equal(f.api.visitReturn.store,'')
})
