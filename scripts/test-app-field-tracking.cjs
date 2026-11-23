const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const {reactive,watch,nextTick}=require('vue')
const drain=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate)}
function loadService(name, modules={}) {
 const context={exports:{},require:n=>modules[n]}
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(__dirname+'/../app/services/'+name+'.uts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 return context.exports
}
const motion = loadService('track-motion')
const fieldwork = loadService('fieldwork', {'./track-motion.uts':motion})
function wrap(x){if(x==null||typeof x!=='object')return x;if(Array.isArray(x))return x.map(wrap);const o=Object.fromEntries(Object.entries(x).map(([k,v])=>[k,wrap(v)]));for(const [n,t]of[['getString','string'],['getNumber','number'],['getBoolean','boolean'],['getJSON','object']])Object.defineProperty(o,n,{value:k=>typeof o[k]===t?o[k]:null});Object.defineProperty(o,'getArray',{value:k=>Array.isArray(o[k])?o[k]:null});return o}
const pending = (store, owner = 'one') => (store.get(owner+'|track:queue')?.batchIds ?? []).map(id => store.get(owner+'|track:batch:'+id))
function fixture(storage=new Map()) {
 let now=Date.parse('2026-11-12T02:00:00Z'), listener=null, errorListener=null, onNetwork=null, tick=null, stops=0, starts=0,id=0,network=true,ack=true,held=null
 const session=reactive({authenticated:true,userId:'one'}),owner=()=>session.authenticated?session.userId:'',scope=()=>session.userId
 const attendance=reactive({day:{id:'day',sessionId:'first',status:'ACTIVE'},pending:false,busy:false,serverOffset:0,captureUntil:now+3600000,sampleIntervalSeconds:60,uploadIntervalSeconds:60,offlineDeadline:120,locationEnabled:true})
 class Clock extends Date {static now(){return now}}
 const permissions=new Set(['sales:context:read','sales:location:write','sales:track:own:read'])
 const writes=[], modules={vue:{reactive,watch},'./attendance.uts':{attendance,refreshAttendance:async()=>{if(!network)throw Error('网络连接失败，请重试');return attendance.day}},'./session.uts':{session,hasPermission:p=>permissions.has(p)},'./field-storage.uts':{fieldStorageScope:scope,fieldStorageDurable:()=>true,readFieldValue:async(s,k)=>wrap(storage.get(s+'|'+k)??null),writeFieldValue:async(s,k,v)=>storage.set(s+'|'+k,JSON.parse(JSON.stringify(v))),clearFieldValue:async(s,k)=>storage.delete(s+'|'+k)},'./crm.uts':{crmOwner:owner,crmId:()=>`id-${++id}`,crmMessage:e=>e.message,crmObject:r=>wrap(r.data),crmCall:async(p,m,b)=>{writes.push({p,b:JSON.parse(JSON.stringify(b)),owner:owner()});if(held)await held;if(!network)throw Error('offline');return{data:{workDayId:b? 'day':'',acceptedCount:ack?b.points.length:0,duplicateCount:0,rejectedCount:ack?0:b.points.length}}}}}
 const uni={onNetworkStatusChange:callback=>{onNetwork=callback}}
 const idleChanges=[]
 modules['./track-motion.uts']=motion
 modules['./background-location.uts']={acquireBackgroundLocation:async(_key,point,error)=>{listener=point;errorListener=error;starts++},releaseBackgroundLocation:()=>{listener=null;errorListener=null;stops++},setFieldworkLocationIdle:idle=>idleChanges.push(idle)}
 const context={console:{log:()=>{},warn:()=>{}},exports:{},require:n=>modules[n],uni,Date:Clock,Promise,Error,Number,JSON:{...JSON,parse:JSON.parse,stringify:JSON.stringify,parseObject:s=>wrap(JSON.parse(s))},setInterval:f=>(tick=f,1),encodeURIComponent}
 vm.createContext(context);const source=fs.readFileSync(__dirname+'/../app/services/field-tracking.uts','utf8');vm.runInContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
 return{api:context.exports,attendance,session,storage,writes,permissions,idleChanges,
  point:(fields={})=>listener?.({longitude:116.4,latitude:39.9,accuracy:8,observedAt:now,gps:true,motion:-1,...fields}),
  tick:()=>tick?.(),advance:ms=>now+=ms,network:v=>network=v,connection:v=>{network=v;onNetwork?.({isConnected:v})},ack:v=>ack=v,hold:p=>held=p,starts:()=>starts,stops:()=>stops}
}
test('five-second fixes are visible locally and sent as one raw batch after sixty seconds', async () => {
 const f=fixture();f.attendance.sampleIntervalSeconds=5;f.api.startFieldTracking();await f.api.resumeFieldTracking()
 for(let index=0;index<12;index++){
   f.point({longitude:116.4+index*.00012});await drain()
   f.advance(4000);f.point({longitude:116.4+index*.00012+.00001});await drain();f.tick()
   f.advance(1000)
 }
 assert.equal(f.writes.length,0)
 assert.equal(f.api.localTrackPoints('day').length,12)
 assert.equal(f.api.localTrackPoints('other-day').length,0)
 f.tick();await drain()
 assert.equal(f.writes.length,1)
 const {p,b}=f.writes[0]
 assert.match(p,/location-points:batch$/)
 assert.equal(b.locationSessionId,'first')
 assert.equal(b.points.length,12)
 assert.equal(b.points[0].rawCoordinateSystem,'WGS84')
 assert.equal(b.points[0].rawLongitude,116.4)
 assert.equal(b.points[0].longitude,null)
 assert.equal(Date.parse(b.points[1].clientOccurredAt)-Date.parse(b.points[0].clientOccurredAt),5000)
 assert.equal(f.api.fieldTracking.pendingPoints,0)
 assert.equal(f.api.localTrackPoints('day').length,12)
})
test('offline sealed batch survives restart and preserves identifiers',async()=>{const store=new Map(),a=fixture(store);a.api.startFieldTracking();await a.api.resumeFieldTracking();a.network(false);a.point();await drain();a.advance(60000);a.tick();await drain();assert.equal(a.api.fieldTracking.pendingPoints,1);a.api.stopFieldTracking();const b=fixture(store);b.attendance.day.status='FINISHED';b.api.startFieldTracking();await b.api.resumeFieldTracking();await drain();assert.equal(b.starts(),0);assert.deepEqual(a.writes[0].b,b.writes[0].b);assert.equal(b.api.fieldTracking.pendingPoints,0)})
test('sign-out request and cutoff stop callbacks before another sample',async()=>{const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking();assert.equal(f.api.fieldTracking.active,true);f.attendance.busy=true;await nextTick();assert.equal(f.api.fieldTracking.active,false);f.point();await drain();assert.equal(f.writes.length,0);f.attendance.busy=false;await nextTick();await drain();f.advance(3600001);f.tick();assert.equal(f.api.fieldTracking.active,false)})
test('partial receipt retains original evidence for retry',async()=>{const f=fixture();f.ack(false);f.api.startFieldTracking();await f.api.resumeFieldTracking();f.point();await drain();f.advance(60000);f.tick();await drain();assert.equal(f.api.fieldTracking.pendingPoints,1);assert.match(f.api.fieldTracking.message,/待同步/);f.ack(true);f.advance(31000);f.tick();await drain();assert.equal(f.writes[0].b.idempotencyKey,f.writes[1].b.idempotencyKey);assert.equal(f.api.fieldTracking.pendingPoints,0)})
test('account change stops capture and late acknowledgement cannot erase old owner queue',async()=>{const f=fixture();let done;f.hold(new Promise(r=>done=r));f.api.startFieldTracking();await f.api.resumeFieldTracking();f.point();await drain();f.advance(60000);f.tick();await drain();f.session.userId='two';await nextTick();done();await drain();assert.equal(f.api.fieldTracking.active,false);assert.equal(f.api.fieldTracking.pendingPoints,0);assert.equal(pending(f.storage).length,1);assert.equal(f.storage.has('two|track:queue'),false)})

test('missing permission reports the actual reason without starting or uploading locations',async()=>{const f=fixture();f.permissions.delete('sales:location:write');f.api.startFieldTracking();await f.api.resumeFieldTracking();assert.match(f.api.fieldTracking.message,/没有轨迹记录权限/);assert.equal(f.starts(),0);assert.equal(f.writes.length,0)})
test('disabled rule and absent workday explain why capture is stopped',async()=>{const f=fixture();f.attendance.locationEnabled=false;await f.api.resumeFieldTracking();assert.match(f.api.fieldTracking.message,/规则未开启/);f.attendance.locationEnabled=true;f.attendance.day=null;await f.api.resumeFieldTracking();assert.match(f.api.fieldTracking.message,/签到后/);assert.equal(f.starts(),0)})

test('authorized active workday starts without an extra in-app consent prompt',async()=>{const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking();assert.equal(f.starts(),1);assert.equal(f.api.fieldTracking.active,true)})

test('recovery drains all queued batches without waiting another sampling interval',async()=>{
 const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking();f.network(false)
 f.point();await drain();f.advance(61000);f.point();await drain();f.advance(61000);f.point();await drain()
 assert.equal(f.api.fieldTracking.pendingPoints,3)
 const original=pending(f.storage).map(b=>b.id)
 f.network(true);f.advance(61000);f.tick();await drain();await drain()
 assert.equal(f.api.fieldTracking.pendingPoints,0)
 assert.deepEqual(f.writes.slice(-original.length).map(w=>w.b.idempotencyKey),original)
})

test('cold-start connection failure retries workday confirmation without another foreground event',async()=>{const f=fixture();f.network(false);f.api.startFieldTracking();await f.api.resumeFieldTracking();assert.equal(f.starts(),0);f.advance(15000);f.tick();await drain();assert.equal(f.starts(),0);f.network(true);f.advance(15000);f.tick();await drain();assert.equal(f.starts(),1);f.point();await drain();f.advance(60000);f.tick();await drain();assert.equal(f.api.fieldTracking.pendingPoints,0)})

test('known offline fixes persist before any upload, and reconnect drains them at their original times',async()=>{
 const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking();f.connection(false)
 f.point();await drain();f.advance(61000);f.point({longitude:116.401});await drain()
 assert.equal(f.writes.length,0)
 assert.equal(f.api.fieldTracking.pendingPoints,2)
 const saved=pending(f.storage)[0]
 assert.equal(saved.session,'first')
 assert.equal(f.starts(),1)
 f.connection(true);await drain()
 assert.equal(f.writes.length,1)
 assert.equal(f.writes[0].b.idempotencyKey,saved.id)
 assert.deepEqual(f.writes[0].b.points.map(p=>[p.deviceEventId,p.clientOccurredAt]),saved.points.map(p=>[p.id,p.observedAt]))
 assert.equal(f.api.fieldTracking.pendingPoints,0)
})

test('upgrading a sealed queue retries the previously submitted body with the same event IDs',async()=>{
 const observedAt='2026-11-12T01:59:55.000Z'
 const point={id:'old-fix',longitude:116.4,latitude:39.9,accuracy:8,observedAt}
 const normalized={deviceEventId:point.id,longitude:116.41,latitude:39.91,accuracyMeters:8,
   clientOccurredAt:observedAt,source:'APP_LOCATION_CALLBACK',
   rawLongitude:point.longitude,rawLatitude:point.latitude,rawCoordinateSystem:'WGS84'}
 const oldBatch={id:'old-batch',day:'day',session:'first',expiresAt:Date.parse('2026-11-12T03:00:00Z'),
   sealed:true,points:[point],normalized:[normalized]}
 const storage=new Map([['one|track:queue',{batches:[oldBatch]}]])
 const f=fixture(storage);f.api.startFieldTracking();await f.api.resumeFieldTracking();await drain()
 assert.equal(f.writes.length,1)
 assert.equal(f.writes[0].b.idempotencyKey,oldBatch.id)
 assert.deepEqual(f.writes[0].b.points,[normalized])
 assert.equal(f.api.fieldTracking.pendingPoints,0)
})

test('confirmed stationary GPS skips the intervening sample and retains a confirmation every two minutes',async()=>{
 const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking()
 f.point({gps:true});await drain()
 f.advance(30000);f.point({gps:true});f.point({gps:false});f.advance(30000);f.point({gps:true});f.tick();await drain()
 assert.deepEqual(f.idleChanges,[true])
 assert.equal(f.writes.length,1)
 f.advance(30000);f.point({gps:true});f.advance(30000);f.point({gps:true});await drain()
 assert.equal(f.api.fieldTracking.pendingPoints,1)
 f.advance(30000);f.point({gps:true})
 f.advance(31000);f.point({gps:true,longitude:116.401});await drain();f.tick();await drain()
 assert.deepEqual(f.idleChanges,[true,false])
 assert.equal(f.writes.length,2)
 assert.deepEqual(f.writes[1].b.points.map(point=>point.source),['APP_GPS_STILL','APP_GPS'])
})

test('a break in GPS fixes ends stationary mode without synthesizing a point',async()=>{
 const f=fixture();f.api.startFieldTracking();await f.api.resumeFieldTracking()
 f.point({gps:true});await drain()
 f.advance(30000);f.point({gps:true});f.advance(30000);f.point({gps:true})
 f.advance(45001);f.tick();await drain()
 assert.deepEqual(f.idleChanges,[true,false])
 assert.equal(f.writes.length,1)
})

test('offline L-shaped return uses sub-12m steps, backfills the start, and uploads one unduplicated path',async()=>{
 const f=fixture()
 f.attendance.day.confirmedTrack=true
 f.attendance.sampleIntervalSeconds=5
 f.api.startFieldTracking(); await f.api.resumeFieldTracking(); f.connection(false)
 const coordinates=[[0,0],[6,0],[12,0],[18,0],[18,5],[18,10],[18,15],[18,10],[18,5],[18,0],[12,0],[6,0],[0,0]]
 for (let i=0;i<coordinates.length;i++) {
   const [east,north]=coordinates[i]
   f.point({longitude:116.4+east/85300,latitude:39.9+north/111195,motion:1})
   await drain()
   if(i===1)assert.equal(fieldwork.fieldTrackPreview(f.api.localTrackPoints('day'),0,5,100).lines.length,0)
   if(i===3)assert.equal(fieldwork.fieldTrackPreview(f.api.localTrackPoints('day'),0,5,100).lines[0].points.length,3)
   f.advance(5000); f.tick()
 }
 f.point({motion:0});await drain();f.tick()
 const evidence=f.api.localTrackPoints('day')
 const local=fieldwork.fieldTrackPreview(evidence,0,5,100)
 assert.equal(local.lines.length,1)
 assert.equal(local.lines[0].points.length,coordinates.length)
 assert.equal(local.lines[0].arrow,false)
 assert.equal(Math.round(local.distanceMeters),66)
 assert.equal(f.writes.length,0)
 const beforeLast=evidence.at(-2).time
 const unsynced=fieldwork.fieldTrackPreview(evidence,beforeLast,5,100)
 assert.equal(Math.round(unsynced.distanceMeters),6,'the last witness confirms an earlier fix')
 f.connection(true);await drain()
 assert.equal(f.writes.length,1)
 assert.equal(f.api.fieldTracking.pendingPoints,0)
 assert.deepEqual(f.writes[0].b.points.filter(p=>p.routePath).map(p=>p.routePath),
   Array.from(evidence.filter(p=>p.routePath.length>0),p=>Array.from(p.routePath)))
 assert.equal(fieldwork.fieldTrackPreview(f.api.localTrackPoints('day'),evidence.at(-1).time,5,100).lines.length,0)
})

test('stationary sensor ignores accurate-looking indoor drift and lowers recording frequency',async()=>{
 const f=fixture()
 f.attendance.day.confirmedTrack=true
 f.attendance.sampleIntervalSeconds=5
 f.api.startFieldTracking(); await f.api.resumeFieldTracking(); f.connection(false)
 for (let i=0;i<30;i++) {
   f.point({longitude:116.4+(i%7-3)*.0001,accuracy:7,motion:0})
   await drain()
   f.advance(5000); f.tick()
 }
 const evidence=f.api.localTrackPoints('day')
 assert.deepEqual(f.idleChanges,[true])
 assert.ok(evidence.length<=13)
 assert.ok(evidence.every(p=>p.source==='APP_GPS_STILL' && p.routePath.length===0))
 assert.equal(fieldwork.fieldTrackPreview(evidence,0,5,100).distanceMeters,0)
})

test('unknown motion requires corroborating displacements and keeps a genuine short corner',()=>{
 const filter=new motion.TrackMotion()
 const fixes=[[0,0],[6,0],[13,0],[13,7],[13,14],[13,21]]
 const routes=fixes.map(([x,y],i)=>filter.push({id:String(i),time:5000*(i+1),longitude:x/111195,latitude:y/111195,accuracy:6,source:'APP_GPS',motion:-1},5))
 assert.deepEqual(routes.map(r=>Array.from(r)),[[],[],[],['0','1','2','3'],[],['3','4']])
})
