const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
function object(x){if(x==null||typeof x!=='object')return x;if(Array.isArray(x))return x.map(object);const o=Object.fromEntries(Object.entries(x).map(([k,v])=>[k,object(v)]));for(const[n,t]of[['getString','string'],['getNumber','number'],['getBoolean','boolean']])Object.defineProperty(o,n,{value:k=>typeof o[k]===t?o[k]:null});return o}
function fixture(){const session={revision:1},deleted=[],requests=[];let failed=false;const modules={'./crm.uts':{crmOwner:()=>String(session.revision),crmObject:r=>object(r.data),crmMessage:e=>e.message,crmCall:async p=>{if(p.endsWith('/recordings'))return{data:{clips:[{clipId:'clip',clipIndex:1,clientDurationMs:null,durationMs:10000,durationEstimated:false}]}};if(failed)throw Error('转写服务暂不可用');return{data:{processingEnabled:true,clips:[{clipId:'clip',status:'SUCCEEDED',transcript:'实际原文',summary:'摘要',segments:[{startMs:2400,endMs:5600,text:'实际原文',speakerId:null}]}]}}}},'./session.uts':{session},'./auth.uts':{ensureAccessToken:(_renew,done)=>done('private-token')},'./config.uts':{appEnvironment:{gatewayOrigin:'https://api.example.test'}},'./api.uts':{apiErrorMessage:(_,status)=>'HTTP '+status}};const ctx={exports:{},require:n=>modules[n],Promise,Error,uni:{downloadFile:o=>requests.push(o),getFileSystemManager:()=>({unlink:o=>deleted.push(o.filePath)})}};vm.createContext(ctx);vm.runInContext("Object.prototype.getBoolean=function(k){return typeof this[k]==='boolean'?this[k]:null}",ctx);vm.runInContext(ts.transpileModule(fs.readFileSync('app/services/recording-review.uts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);return{api:ctx.exports,session,deleted,requests,fail:()=>failed=true}}
test('transcript keeps provider time offsets and does not invent speaker identity',async()=>{const f=fixture(),r=await f.api.readRecordingReview('visit');assert.equal(r.clips[0].lines[0].startMs,2400);assert.equal(r.clips[0].lines[0].clock,'00:02');assert.equal(r.clips[0].lines[0].speaker,'')})
test('analysis metadata failure does not remove original recording list',async()=>{const f=fixture();f.fail();const r=await f.api.readRecordingReview('visit');assert.equal(r.clips[0].id,'clip');assert.equal(r.analysisError,'转写服务暂不可用')})
test('late private audio download is deleted after switching accounts',async()=>{const f=fixture(),p=f.api.downloadRecording('visit','clip');assert.equal(f.requests.length,1);f.session.revision=2;f.requests[0].success({statusCode:200,tempFilePath:'/private/audio.tmp'});await assert.rejects(p,/账号已变更/);assert.deepEqual(f.deleted,['/private/audio.tmp'])})
test('one token renewal retries a denied download without putting credentials in URL',async()=>{const f=fixture(),p=f.api.downloadRecording('visit','clip');f.requests[0].success({statusCode:401,tempFilePath:'/private/error.tmp'});assert.equal(f.requests.length,2);assert.equal(f.requests[1].url.includes('token'),false);f.requests[1].success({statusCode:200,tempFilePath:'/private/audio.tmp'});assert.equal(await p,'/private/audio.tmp');assert.deepEqual(f.deleted,['/private/error.tmp'])})

test('whole-visit timeline crosses the five-minute boundary and transcript times never restart',()=>{
 const f=fixture(),clips=[{id:'a',index:1,durationMs:300000,lines:[{startMs:299000,endMs:300000,text:'前段',speaker:'',clock:''}]},{id:'b',index:2,durationMs:120000,lines:[{startMs:500,endMs:2000,text:'后段',speaker:'',clock:''}]}]
 assert.equal(f.api.recordingDuration(clips),420000)
 assert.deepEqual(JSON.parse(JSON.stringify(f.api.recordingPosition(clips,300000))),{index:1,offsetMs:300000,localMs:0})
 assert.equal(f.api.recordingPosition(clips,340000).localMs,40000);assert.equal(f.api.recordingPosition(clips,-1).index,0);assert.equal(f.api.recordingPosition([],0),null)
 assert.equal(f.api.recordingTranscript(clips)[1].clock,'05:00');assert.equal(f.api.recordingTranscript(clips)[1].startMs,300500)
})
function playerFixture(){
 const api=fixture().api,requests=[],deleted=[],players=[],hooks={};const clips=[{id:'a',index:1,durationMs:300000,summary:'一',transcript:'原文一',lines:[]},{id:'b',index:2,durationMs:120000,summary:'二',transcript:'原文二',lines:[]}];let owner='one'
 const modules={'../../services/recording-review.uts':{...api,readRecordingReview:async()=>({clips,enabled:true,analysisError:''}),downloadRecording:(_visit,id)=>new Promise((resolve,reject)=>requests.push({id,resolve,reject})),removePlaybackFile:path=>{if(path)deleted.push(path)}},'../../services/crm.uts':{crmOwner:()=>owner,crmMessage:e=>e.message}}
 const ctx={exports:{},require:n=>modules[n],ref:value=>({value}),computed:f=>({get value(){return f()}}),watch:()=>{},onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,Promise,Error,uni:{createInnerAudioContext:()=>{const handlers={},p={handlers,seek:v=>p.seekValue=v,play:()=>handlers.Play?.(),pause:()=>handlers.Pause?.(),stop:()=>{},destroy:()=>p.destroyed=true};for(const key of ['Canplay','Play','Pause','Ended','TimeUpdate','Error'])p['on'+key]=cb=>handlers[key]=cb;players.push(p);return p}}}
 const source=fs.readFileSync('app/pages/visit-evidence/visit-evidence.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 vm.runInNewContext(ts.transpileModule(source+'\nexports.api={playAt,togglePlay,position,duration,playing,plain,transcriptEmpty,tab,tabs,error};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
 return{...ctx.exports,hooks,requests,deleted,players,switchOwner:()=>owner='two'}
}
const playerFlush=()=>new Promise(setImmediate)
test('five-minute playback automatically continues using one prefetched next segment',async()=>{
 const f=playerFixture();f.hooks.load({visit:'v'});await playerFlush();assert.equal(f.api.duration.value,420000)
 const p=f.api.playAt(299000);f.requests[0].resolve('/a');await p;f.players[0].handlers.Canplay();assert.equal(f.players[0].seekValue,299);assert.equal(f.requests[1].id,'b')
 f.requests[1].resolve('/b');await playerFlush();f.players[0].handlers.Ended();await playerFlush();f.players[1].handlers.Canplay();assert.equal(f.players[1].seekValue,0);assert.equal(f.players[1].src,'/b');assert.equal(f.requests.length,2)
 f.players[1].currentTime=1.5;f.players[1].handlers.TimeUpdate();assert.equal(f.api.position.value,301500);assert.equal(f.api.playing.value,true);assert.deepEqual(f.deleted,['/a']);f.hooks.hide();assert.deepEqual(f.deleted,['/a','/b'])
})
test('seeking across segments uses the global clock, and leaving deletes late prefetched private audio',async()=>{
 const f=playerFixture();f.hooks.load({visit:'v'});await playerFlush();const p=f.api.playAt(0);f.requests[0].resolve('/a');await p
 const seek=f.api.playAt(340000);f.requests[1].resolve('/b');await seek;f.players[1].handlers.Canplay();assert.equal(f.players[1].seekValue,40)
 const back=f.api.playAt(12000);f.requests[2].resolve('/a-again');await back;f.players[2].handlers.Canplay();assert.equal(f.players[2].seekValue,12)
 f.hooks.hide();f.requests[3].resolve('/late-b');await playerFlush();assert.ok(f.deleted.includes('/late-b'));assert.equal(f.api.playing.value,false)
})

test('speech-only page opens original text without an unimplemented summary tab',async()=>{
 const f=playerFixture();f.hooks.load({visit:'v'});await playerFlush();assert.equal(f.api.tab.value,'原文');assert.deepEqual(Array.from(f.api.tabs),['原文','录音']);assert.equal(f.api.plain.value,'原文一\n原文二')
})


test('server speaker IDs keep the same display letters across clips without client inference',()=>{
 const f=fixture(),speakers=object([{id:0,name:'陈小明',role:'SALESPERSON'},{id:1,name:'B',role:'UNKNOWN'}]);assert.equal(f.api.recordingSpeaker(0,speakers),'陈小明');assert.equal(f.api.recordingSpeaker(1,speakers),'B');assert.equal(f.api.recordingSpeaker(26,speakers),'');assert.equal(f.api.recordingSpeaker(null,speakers),'')
 const clips=[{durationMs:300000,lines:[{startMs:100,endMs:1000,text:'前段',speaker:f.api.recordingSpeaker(1,speakers)}]},{durationMs:300000,lines:[{startMs:100,endMs:1000,text:'后段',speaker:f.api.recordingSpeaker(1,speakers)}]}]
 const lines=f.api.recordingTranscript(clips);assert.equal(lines[0].speaker,'B');assert.equal(lines[1].speaker,'B');assert.equal(lines[1].startMs,300100)
})
