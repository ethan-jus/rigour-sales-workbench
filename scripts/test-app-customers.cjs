const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
function json(value) {
 if (Array.isArray(value)) return value.map(json)
 if (!value || typeof value !== 'object') return value
 const result = Object.fromEntries(Object.entries(value).map(([key, value]) => [key, json(value)]))
 for (const [method, type] of [['getString','string'],['getNumber','number'],['getJSON','object']]) Object.defineProperty(result, method, { value: key => typeof result[key] === type ? result[key] : null })
 Object.defineProperty(result, 'getArray', {value:key=>Array.isArray(result[key])?result[key]:null})
 return result
}
function fixture() {
 const {reactive,watch}=require('vue')
 const requests=[]; let reply={data:{total:0,items:[]}}
 const session=reactive({authenticated:true,tenantId:'tenant',userId:'one',revision:1,permissions:['crm:pool:private-read','crm:pool:public-read']})
 const modules={
  vue:{watch}, './session.uts':{session}, './config.uts':{appEnvironment:{environment:'development',gatewayOrigin:'http://localhost:26880',issuer:'http://localhost:26881'}},
  './api.uts':{requestApi:(url,method,body,success,fail)=>{requests.push(url); if(reply instanceof Error) fail(reply.message); else success(json(reply))}},
  './workbench.uts':{workbenchMoney:value=>value==null?'—':String(value)},
  './sales-profile.uts':{}, './location.uts':{requestDeviceLocation:success=>success({longitude:120,latitude:30,accuracy:20,coordinateSystem:'WGS84',requestedAt:Date.now()-3000,receivedAt:Date.now()})}
 }
 for(const name of ['customer-cache','crm','customer-workbench','customer-nearby']) {
  const context={exports:{},require:name=>modules[name],uni:{navigateTo:({url})=>requests.push(url)}}
  vm.runInNewContext("Object.defineProperties(Object.prototype,{getNumber:{value:function(k){return typeof this[k]==='number'?this[k]:null}},getString:{value:function(k){return typeof this[k]==='string'?this[k]:null}}});\n" + ts.transpileModule(fs.readFileSync(path.join(__dirname,'../app/services/'+name+'.uts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
  modules['./'+name+'.uts']=context.exports
 }
 return {nearby:modules['./customer-nearby.uts'],api:modules['./customer-workbench.uts'],crm:modules['./crm.uts'],cache:modules['./customer-cache.uts'],requests,session,respond:value=>{reply=value}}
}
test('unavailable metrics and zero-denominator rates stay unknown instead of becoming zero', () => {
 const { api } = fixture()
 assert.equal(api.customerCount(null, 'contacts'), '—')
 assert.equal(api.customerRatio(json({purchasing:0,returning:0})), '—')
 assert.equal(api.customerRatio(json({purchasing:5,returning:null})), '—')
 assert.equal(api.customerRatio(json({purchasing:5,returning:3})), '60%')
 assert.equal(api.customerRatio(json({purchasing:5,returning:3,unknownHistory:1})), '—')
})
test('metric drilldown retains the exact cohort, period, filter and cursor with encoded input', async () => {
 const f=fixture(); f.respond({data:{total:31,items:[{id:'9',name:'测试店',address:'地址',relation:'TRANSFERRED',orderCount:2,lastOrderAt:'2026-11-12'}],nextCursor:'9'}})
 const result=await f.api.customerList('RETURNING','2026-11-01','2026-11-12','门店&extra=1','TRANSFERRED','42')
 const url=new URL('https://test'+f.requests[0]); assert.equal(url.pathname,'/crm/customer-workbench'); assert.equal(url.searchParams.get('kind'),'RETURNING'); assert.equal(url.searchParams.get('keyword'),'门店&extra=1');assert.equal(url.searchParams.get('cursor'),'42');assert.equal(url.searchParams.get('from'),'2026-11-01')
 assert.equal(result.total,31);assert.equal(result.items[0].source,'HISTORY');assert.equal(result.items[0].tag,'已转交')
 f.api.customerOpen(result.items[0]);assert.match(f.requests[1],/source=HISTORY&relation=TRANSFERRED/)
})
test('transport failure cannot turn into an empty customer or contact list', async () => {
 const f=fixture(); f.respond(new Error('无权限'))
 await assert.rejects(f.api.customerList('COOPERATED','2026-11-01','2026-11-12','','',''),/无权限/)
 await assert.rejects(f.api.customerPeople(true,'2026-11-01','2026-11-12','',''),/无权限/)
})
test('a person is counted once while all authorized store choices remain available', async () => {
 const f=fixture(); f.respond({data:{total:1,items:[{id:'7',name:'王老板',storeId:'1',storeName:'一店',stores:[{id:'1',name:'一店',role:'老板'},{id:'2',name:'二店',role:'老板'}]}]}})
 const result=await f.api.customerPeople(true,'2026-11-01','2026-11-12','','')
 assert.equal(result.total,1);assert.equal(result.items.length,1);assert.equal(result.items[0].stores.length,2);assert.equal(result.items[0].stores[1].id,'2')
})
test('contact maintenance opens current private detail without requiring order-history authorization', async () => {
 const f=fixture(); f.respond({data:{total:1,items:[{id:'9',name:'待补联系店',relation:'MINE',orderCount:0}]}})
 const result=await f.api.customerList('CONTACT_PENDING','2026-11-01','2026-11-12','','','')
 assert.equal(result.items[0].source,'MINE');f.api.customerOpen(result.items[0]);assert.match(f.requests[1],/source=MINE&relation=MINE/)
})
test('public page keeps geography in both cached and fresh list selections after native-list changes', () => {
 const source=fs.readFileSync(path.join(__dirname,'../app/pages/customer-list/customer-list.uvue'),'utf8')
 const method=source.match(/function filters\(\): string \{[^\n]+\}/)[0]
 const scope={exports:{},kind:{value:'PUBLIC'},phase:{value:''},protection:{value:''},business:{value:''},province:{value:'510000'},city:{value:'510100'},county:{value:'510107'}}
 vm.runInNewContext(ts.transpileModule(method+'\nexports.filters=filters',{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,scope)
 let q=new URLSearchParams(scope.exports.filters());assert.equal(q.get('province'),'510000');assert.equal(q.get('city'),'510100');assert.equal(q.get('county'),'510107')
 scope.kind.value='MINE';q=new URLSearchParams(scope.exports.filters());assert.equal(q.has('city'),false)
})


test('malformed successful lists cannot masquerade as empty data or enter the shared customer cache', async () => {
 const f=fixture()
 for(const data of [{},{total:0},{total:-1,items:[]},{total:0.5,items:[]},{total:'0',items:[]},{total:0,items:{}},{total:1,items:[{}]},{total:0,items:[],nextCursor:4}]) {
  f.respond({data})
  await assert.rejects(f.api.customerList('COOPERATED','2026-11-01','2026-11-12','','',''),/不完整/)
  await assert.rejects(f.crm.crmList('PUBLIC',''),/不完整/)
  assert.equal(f.api.customerListSnapshot('COOPERATED','2026-11-01','2026-11-12','',''),null)
  assert.equal(f.crm.crmListSnapshot('PUBLIC',''),null)
 }
 f.respond({data:{total:0,items:[],nextCursor:null}})
 assert.equal((await f.crm.crmList('PUBLIC','')).total,0)
 f.respond({data:{}}); await assert.rejects(f.crm.crmList('PUBLIC',''),/不完整/)
 assert.equal(f.crm.crmListSnapshot('PUBLIC',''),null)
})

test('summary validates core metrics before caching while legitimate nullable metrics remain unknown', async () => {
 const f=fixture(),valid={contacts:0,mine:0,dueSoon:0,dormant:0,contactPending:0,purchasing:null,publicPool:null}
 f.respond({data:valid}); await f.api.customerSummary('2026-11-12','2026-11-12')
 assert.equal(f.api.customerCount(f.api.customerSummarySnapshot('2026-11-12','2026-11-12'),'purchasing'),'—')
 for(const data of [{},{...valid,mine:null},{...valid,contacts:-1},{...valid,publicPool:'bad'},{...valid,purchasing:NaN}]) {
  f.respond({data}); await assert.rejects(f.api.customerSummary('2026-11-12','2026-11-12'),/不完整/)
  assert.equal(f.api.customerSummarySnapshot('2026-11-12','2026-11-12'),null)
 }
})

test('public counter requests only the count endpoint and rejects malformed results before caching', async () => {
 const f=fixture();f.respond({data:{total:2010}})
 assert.equal((await f.api.customerPublicCount()).total,2010)
 assert.equal(f.requests[0],'/crm/customer-workbench/public-count')
 assert.equal(f.api.customerPublicCountSnapshot().total,2010)
 f.respond({data:{}});await assert.rejects(f.api.customerPublicCount(),/不完整/)
 assert.equal(f.api.customerPublicCountSnapshot(),null)
})

const nearbyOrigin={gpsLongitude:120,gpsLatitude:30,gcjLongitude:120.005,gcjLatitude:30.002}
test('nearby API unwraps store projections, preserves distance and uses an encoded fixed origin cursor',async()=>{
 const f=fixture();f.respond({data:{total:170000,origin:nearbyOrigin,items:[{store:{id:'9',name:'近店',poolType:'PUBLIC'},distanceMeters:350,longitude:120.006,latitude:30.002,coordinateSystem:'GCJ02'},{store:{id:'10',name:'未知位置店',poolType:'PUBLIC'},distanceMeters:null}],nextCursor:'opaque'}})
 const page=await f.nearby.customerNearbyList('PUBLIC','2026-11-01','2026-11-13','门店&x=1','','&city=510100',nearbyOrigin,'opaque+next')
 assert.equal(page.items[0].id,'9');assert.equal(page.items[0].distanceText,'约350米');assert.equal(page.items[1].distanceText,'距离未知');assert.equal(page.total,170000)
 const url=new URL('https://test'+f.requests[0]);assert.equal(url.pathname,'/crm/stores/nearby');assert.equal(url.searchParams.get('nearCursor'),'opaque+next');assert.equal(url.searchParams.get('nearCoordinateSystem'),'WGS84');assert.equal(url.searchParams.get('city'),'510100');assert.equal(url.searchParams.get('keyword'),'门店&x=1')
 f.respond({data:{total:1,origin:nearbyOrigin,items:[{store:{id:'11',relation:'TRANSFERRED',orderCount:2},distanceMeters:1200,longitude:120.01,latitude:30,coordinateSystem:'GCJ02'}]}})
 const history=await f.nearby.customerNearbyList('COOPERATED','2026-11-01','2026-11-13','','TRANSFERRED','',nearbyOrigin,'');assert.equal(history.items[0].source,'HISTORY');assert.match(f.requests[1],/customer-workbench\/nearby/)
})
test('live distance uses the matching coordinate system and leaves list ordering unchanged',()=>{
 const f=fixture();const rows=[{id:'gcj',nearLongitude:120.005,nearLatitude:30.002,nearCoordinateSystem:'GCJ02'},{id:'gps',nearLongitude:120,nearLatitude:30,nearCoordinateSystem:'WGS84'},{id:'unknown',nearLongitude:null,nearLatitude:null,nearCoordinateSystem:''}]
 f.nearby.nearbyUpdateDistances(rows,nearbyOrigin);assert.deepEqual(rows.map(x=>x.id),['gcj','gps','unknown']);assert.deepEqual(rows.map(x=>x.distanceText),['约50米内','约50米内','距离未知'])
 assert.ok(f.nearby.nearbyDistance(120,30,120.01,30)>900);assert.equal(f.nearby.nearbyDistanceText(null),'距离未知')
})
test('malformed nearby receipts are rejected, and locating uses only the CRM read context',async()=>{
 const f=fixture();f.respond({data:nearbyOrigin});assert.equal((await f.nearby.customerNearbyLocation('PUBLIC')).gpsLongitude,120);assert.match(f.requests[0],/crm\/stores\/nearby\/origin\?view=PUBLIC/)
 for(const data of [{total:1,origin:nearbyOrigin,items:[{}]},{total:1,origin:nearbyOrigin,items:[{store:{}}]},{total:0,items:[]},{total:-1,origin:nearbyOrigin,items:[]}]){
  f.respond({data});await assert.rejects(f.nearby.customerNearbyList('MINE','2026-11-01','2026-11-13','','','',nearbyOrigin,''))
 }
})

test('nearby display caches first pages by selection and claim invalidation removes location and rows', async()=>{
 const f=fixture();const args=['PUBLIC','2026-11-01','2026-11-13','','','&city=510100']
 f.respond({data:nearbyOrigin});await f.nearby.customerNearbyLocation('PUBLIC');await f.nearby.customerNearbyLocation('MINE')
 assert.equal(f.requests.length,1);assert.equal(f.nearby.customerNearbyOriginSnapshot().gpsLongitude,120)
 f.respond({data:{total:21,origin:nearbyOrigin,items:[{store:{id:'first'}}],nextCursor:'next'}})
 await f.nearby.customerNearbyList(...args,nearbyOrigin,'')
 assert.equal(f.nearby.customerNearbySnapshot(...args).items[0].id,'first')
 assert.equal(f.nearby.customerNearbySnapshot(...args.slice(0,5),'&city=other'),null)
 f.respond({data:{total:21,origin:nearbyOrigin,items:[{store:{id:'second'}}],nextCursor:null}})
 await f.nearby.customerNearbyList(...args,nearbyOrigin,'next')
 assert.equal(f.nearby.customerNearbySnapshot(...args).items[0].id,'first')
 f.cache.invalidateCustomerCache();assert.equal(f.nearby.customerNearbySnapshot(...args),null);assert.equal(f.nearby.customerNearbyOriginSnapshot(),null)
})

test('nearby location shares timestamped, accurate normalized evidence with the visit entry only for its current owner',async()=>{
 const f=fixture();f.respond({data:nearbyOrigin});await f.nearby.customerNearbyLocation('MINE')
 const point=f.nearby.customerNearbyVisitLocation();assert.ok(point);assert.equal(point.owner,f.crm.crmOwner());assert.equal(point.location.getNumber('longitude'),120.005);assert.equal(point.location.getNumber('accuracyMeters'),20)
 assert.ok(point.requestedAt<=point.receivedAt);assert.ok(Date.now()-point.requestedAt<30000)
 f.session.userId='other';assert.equal(f.nearby.customerNearbyVisitLocation(),null)
})
test('display-only origin without accuracy or collection timestamps cannot become visit evidence',async()=>{
 const f=fixture();await f.cache.refreshCustomerSnapshot('customer-nearby:origin',async()=>json(nearbyOrigin))
 assert.ok(f.nearby.customerNearbyOriginSnapshot());assert.equal(f.nearby.customerNearbyVisitLocation(),null)
})
