const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),vm=require('node:vm')
function androidSource(source){return source.replace(/\/\/ #ifndef APP-ANDROID[\s\S]*?\/\/ #endif/g,'')}
function fixture(){
 let now=100000,starts=0,stops=0,onPoint=null,idle=false
 const native={startNativeLocation:f=>{starts++;onPoint=f},stopNativeLocation:()=>{onPoint=null;stops++},setNativeFieldMotion:()=>{},setNativeLocationIdle:value=>{idle=value}}
 const ctx={exports:{},Date:{now:()=>now},Promise,Map,Array,Error,require:()=>native}
 const source=androidSource(fs.readFileSync('app/services/background-location.uts','utf8'))
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
 return{api:ctx.exports,advance:ms=>now+=ms,starts:()=>starts,stops:()=>stops,idle:()=>idle,networkStops:()=>stops,networkPoint:()=>onPoint?.(116,40,40,now,false),start:()=>{},point:()=>onPoint?.(116,40,8,now,true)}
}
test('two consumers share a native subscription; ending a visit does not stop workday tracking',async()=>{const f=fixture();let work=0,visit=0;const a=f.api.acquireBackgroundLocation('work',()=>work++,()=>{}),b=f.api.acquireBackgroundLocation('visit',()=>visit++,()=>{});assert.equal(f.starts(),1);f.start();await Promise.all([a,b]);f.point();assert.equal(work,1);assert.equal(visit,1);f.api.releaseBackgroundLocation('visit');assert.equal(f.stops(),0);f.point();assert.equal(work,2);assert.equal(visit,1);f.api.releaseBackgroundLocation('work');assert.equal(f.stops(),1)})
test('sign-out before start completion releases the subscription',async()=>{const f=fixture();const p=f.api.acquireBackgroundLocation('work',()=>{throw Error('late point')},()=>{});f.api.releaseBackgroundLocation('work');f.start();await p;assert.equal(f.stops(),1);f.point()})

test('network fixes reach the same consumers when GPS is silent and stop with the last consumer',async()=>{const f=fixture();let received=0;const p=f.api.acquireBackgroundLocation('work',point=>{assert.equal(point.accuracy,40);received++},()=>{});f.start();await p;f.networkPoint();assert.equal(received,1);f.api.releaseBackgroundLocation('work');assert.equal(f.networkStops(),1);f.networkPoint();assert.equal(received,1)})

test('active departure tracking keeps the shared GPS at normal cadence',async()=>{
 const f=fixture()
 await f.api.acquireBackgroundLocation('fieldwork',()=>{},()=>{})
 f.api.setFieldworkLocationIdle(true)
 assert.equal(f.idle(),true)
 await f.api.acquireBackgroundLocation('departure',()=>{},()=>{})
 assert.equal(f.idle(),false)
 f.api.releaseBackgroundLocation('departure')
 assert.equal(f.idle(),true)
 assert.equal(f.starts(),1)
})

function nativeFixture(){
  let current=null,removed=0,now=120000000000,service=0,deviceMotion=-1
  const intervals=[]
  const manager={getAllProviders:()=>({contains:()=>true}),requestLocationUpdates:(provider,interval,_distance,listener)=>{current=listener;intervals.push([provider,interval])},removeUpdates:()=>removed++}
  const modules={'android.content.Context':{LOCATION_SERVICE:'location'},'android.location.LocationManager':{NETWORK_PROVIDER:'network',GPS_PROVIDER:'gps'},'android.location.LocationListener':class{},'android.os.Looper':{getMainLooper:()=>null},'android.os.SystemClock':{elapsedRealtimeNanos:()=>now},'android.os.Build':{VERSION:{SDK_INT:33}}}
  const context={exports:{},require:n=>n.includes('rigour-location-service')?{startFieldLocationService:()=>service++,stopFieldLocationService:()=>service=0,readFieldMotion:()=>deviceMotion}:n==='./track-motion.uts'?{motionUnknown:-1,motionStill:0,motionMoving:1}:{default:modules[n]},UTSAndroid:{getAppContext:()=>({getSystemService:()=>manager})},Number,Error}
  const source=fs.readFileSync('app/services/native-location.uts','utf8').replaceAll('0.0.toFloat()','0').replaceAll('.toDouble()','').replace('onLocationChanged(locations: List<Location>)', 'onBatchLocationChanged(locations: List<Location>)')
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,context)
  return{api:context.exports,listener:()=>current,removed:()=>removed,requests:()=>intervals.length,intervals,setMotion:value=>{deviceMotion=value},point:(age=0,mock=false,accuracy=40,provider='network',speed=null,error=null)=>({getProvider:()=>provider,getTime:()=>1700000000000+now/1000000-age,getElapsedRealtimeNanos:()=>now-age*1000000,hasAccuracy:()=>accuracy>0,isFromMockProvider:()=>mock,getAccuracy:()=>accuracy,getLongitude:()=>116,getLatitude:()=>40,hasSpeed:()=>speed!=null,hasSpeedAccuracy:()=>error!=null,getSpeed:()=>speed,getSpeedAccuracyMetersPerSecond:()=>error}),advance:ms=>now+=ms*1000000}
}
test('network evidence rejects stale, duplicate, mock and accuracy-less fixes',()=>{const f=nativeFixture();let count=0;f.api.startNativeLocation(()=>count++);const listener=f.listener();listener.onLocationChanged(f.point(60001));listener.onLocationChanged(f.point(0,true));listener.onLocationChanged(f.point(0,false,0));assert.equal(count,0);listener.onLocationChanged(f.point());listener.onLocationChanged(f.point());assert.equal(count,1);f.advance(10000);listener.onLocationChanged(f.point());assert.equal(count,2)})
test('queued native callbacks cannot leak into a stopped or restarted subscription',()=>{const f=nativeFixture();let count=0;f.api.startNativeLocation(()=>count++);const old=f.listener();f.api.stopNativeLocation();old.onLocationChanged(f.point());assert.equal(count,0);f.api.startNativeLocation(()=>count++);old.onLocationChanged(f.point());f.listener().onLocationChanged(f.point());assert.equal(count,1);assert.equal(f.removed(),1)})

test('Android batch callback delivers fresh fixes through the same validation',()=>{const f=nativeFixture();let count=0;f.api.startNativeLocation(()=>count++);f.listener().onBatchLocationChanged([f.point(70000),f.point(1000),f.point()]);assert.equal(count,2)})

test('fresh precise GPS suppresses coarse network jumps but network resumes when GPS goes silent',async()=>{const f=fixture(),points=[];const p=f.api.acquireBackgroundLocation('work',x=>points.push(x),()=>{});f.start();await p;f.point();f.networkPoint();assert.deepEqual(points.map(x=>x.accuracy),[8]);f.advance(30001);f.networkPoint();assert.deepEqual(points.map(x=>x.accuracy),[8,40])})

test('GPS batch callbacks preserve original observation time and do not get deduplicated by network fixes',()=>{
 const f=nativeFixture(),points=[];f.api.startNativeLocation((...p)=>points.push(p));
 f.listener().onLocationChanged(f.point(0,false,40,'network'));
 f.listener().onBatchLocationChanged([f.point(0,false,8,'gps')]);
 assert.equal(points.length,2);assert.equal(points[1][4],true);assert.equal(points[1][3],f.point().getTime());assert.equal(f.requests(),2);
})

test('cadence changes replace the GPS request while keeping the listener and network request',()=>{
 const f=nativeFixture()
 f.api.startNativeLocation(()=>{})
 const listener=f.listener()
 f.api.setNativeLocationIdle(true)
 f.api.setNativeLocationIdle(true)
 f.api.setNativeLocationIdle(false)
 assert.equal(f.listener(),listener)
 assert.equal(f.removed(),0)
 assert.deepEqual(f.intervals,[['gps',1000],['network',10000],['gps',15000],['gps',1000]])
})

test('fresh accelerometer evidence complements GPS speed; older fixes never borrow current motion',()=>{
 const f=nativeFixture(), motions=[]
 f.api.startNativeLocation((_lng,_lat,_accuracy,_stamp,_gps,motion)=>motions.push(motion))
 f.setMotion(0)
 f.listener().onLocationChanged(f.point(0,false,9,'gps'))
 f.advance(5000)
 f.listener().onLocationChanged(f.point(3000,false,9,'gps'))
 f.advance(5000)
 f.listener().onLocationChanged(f.point(0,false,9,'gps',4,0.2))
 f.advance(5000); f.setMotion(1)
 f.listener().onLocationChanged(f.point(0,false,9,'gps',0.2,0.2))
 assert.deepEqual(motions,[0,-1,1,0])
})
