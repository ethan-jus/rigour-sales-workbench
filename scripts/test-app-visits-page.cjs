const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript')
const {reactive,ref,computed,watch,nextTick,effectScope}=require('vue')
function object(value){
 if(value==null||typeof value!=='object')return value
 if(Array.isArray(value))return value.map(object)
 const out=Object.fromEntries(Object.entries(value).map(([k,v])=>[k,object(v)]))
 Object.defineProperties(out,{getString:{value:k=>typeof out[k]==='string'?out[k]:null},getNumber:{value:k=>typeof out[k]==='number'?out[k]:null},getJSON:{value:k=>out[k]??null},getArray:{value:k=>out[k]??null}})
 return out
}
const flush=()=>new Promise(setImmediate)
const day=status=>({id:'day',status,date:'2026-11-13',checkedInAt:'2026-11-13T01:02:00Z',checkedOutAt:status==='FINISHED'?'2026-11-13T10:12:00Z':'',workMinutes:450})
function fixture(t){
 const session=reactive({authenticated:true,revision:1,permissions:['sales:context:read','sales:work-day:write','sales:visit:own:read','crm:store:history-read','sales:visit-plan:own:read','crm:store:visit-write','sales:visit:own:write']})
 const attendance=reactive({day:null,businessDate:'2026-11-13',busy:false,pending:false,phase:'',serverOffset:0,captureUntil:0})
 const local=reactive({recording:false});const reads=[],boards=[],plans=[],writes=[],navigation=[],toasts=[],modals=[],hooks={}
 const owner=()=>session.revision+':'+session.authenticated+':'+session.permissions.join(',')
 const deferred=queue=>new Promise((resolve,reject)=>queue.push({resolve,reject}))
 const modules={
 '../../services/session.uts':{hasPermission:p=>session.authenticated&&session.permissions.includes(p),requireSession:()=>session.authenticated},
 '../../services/crm.uts':{crmOwner:owner,crmMessage:e=>e.message,crmObject:r=>r,crmCall:url=>new Promise((resolve,reject)=>plans.push({url,resolve,reject}))},
 '../../services/crm-media.uts':{crmRecording:()=>local.recording,crmUploadState:{pending:0},crmRunUploadQueue:async()=>{}},
 '../../services/visits.uts':{visitToday:()=> '2026-11-13',visitReadKey:owner,loadLocalVisits:()=>{},visitDraftCount:()=>0,hasActiveVisitRecording:()=>local.recording,resumeVisitPath:()=>'/active'},
 '../../services/attendance.uts':{attendance,attendanceClock:s=>s?new Date(Date.parse(s)+8*3600000).toISOString().substring(11,16):'—',refreshAttendance:async()=>{const identity=owner();const value=await deferred(reads);if(identity!==owner())throw Error('账号已变更');attendance.day=value;return value},punchAttendance:async(checkOut)=>{attendance.busy=true;const identity=owner();try{const value=await new Promise((resolve,reject)=>writes.push({checkOut,resolve,reject}));if(identity!==owner())throw Error('账号已变更');attendance.day=value;return value}finally{attendance.busy=false}}},
 '../../services/visit-workbench.uts':{visitNavigation:reactive({revision:0,tab:'plans',date:''}),parseVisitBoardRow:r=>r,loadVisitBoard:()=>deferred(boards),openVisitBoardRow:r=>navigation.push('/visit/'+r.id),showVisitRecords:(...args)=>navigation.push(args)}
 }
 const source=fs.readFileSync(__dirname+'/../app/pages/visits/visits.uvue','utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
 const code=ts.transpileModule(source+'\nexports.view={ready,working,finished,workDuration,workStateLabel,canPunch,visitDisabled,attendanceError,visitConflict,active,plans,visiblePlans,plansLoaded,planError,planDate};exports.actions={punch,start,history,loadAttendance,loadPlans,choosePlanDay,openPlan};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
 const context={exports:{},require:n=>modules[n],ref,computed,watch,setInterval:()=>1,clearInterval:()=>{},onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,uni:{showModal:v=>modals.push(v),showToast:v=>toasts.push(v.title),navigateTo:v=>navigation.push(v.url),showActionSheet:()=>{}}}
 const scope=effectScope();scope.run(()=>vm.runInNewContext(code,context));t.after(()=>scope.stop())
 return {...context.exports,attendance,session,local,reads,boards,plans,writes,navigation,toasts,modals,hooks}
}
test('opening visits only reads; unknown and failed attendance cannot create a punch',async(t)=>{
 const f=fixture(t);f.hooks.show();f.actions.punch()
 assert.equal(f.reads.length,1);assert.equal(f.writes.length,0);assert.equal(f.view.canPunch.value,false)
 f.reads[0].reject(Error('无法确认状态'));await flush();f.actions.punch()
 assert.equal(f.view.workStateLabel.value,'状态待确认');assert.equal(f.writes.length,0)
 const retry=f.actions.loadAttendance();f.reads[1].resolve(null);await retry
 assert.equal(f.view.workStateLabel.value,'未上班');assert.equal(f.view.canPunch.value,true)
})
test('sign-in changes to working only after success and rapid taps cannot duplicate it',async(t)=>{
 const f=fixture(t);f.hooks.show();f.reads[0].resolve(null);await flush()
 f.actions.punch();f.actions.punch();assert.equal(f.writes.length,1);assert.equal(f.writes[0].checkOut,false)
 assert.equal(f.view.working.value,false);f.writes[0].reject(Error('定位失败'));await flush()
 assert.equal(f.view.workStateLabel.value,'未上班');assert.equal(f.view.attendanceError.value,'定位失败')
 f.actions.punch();f.writes[1].resolve(day('ACTIVE'));await flush()
 assert.equal(f.view.workStateLabel.value,'工作中');assert.equal(f.view.visitDisabled.value,false)
 assert.deepEqual(f.toasts,['上班打卡成功'])
})
test('checkout needs confirmation and completed duration comes from accumulated server minutes',async(t)=>{
 const f=fixture(t);f.hooks.show();f.reads[0].resolve(day('ACTIVE'));await flush()
 f.actions.punch();f.actions.punch();assert.equal(f.modals.length,1);assert.equal(f.writes.length,0)
 f.modals[0].success({confirm:false});assert.equal(f.writes.length,0)
 f.actions.punch();f.modals[1].success({confirm:true});assert.equal(f.writes[0].checkOut,true)
 f.writes[0].resolve(day('FINISHED'));await flush()
 assert.equal(f.view.workDuration.value,'7小时30分');assert.equal(f.view.workStateLabel.value,'已下班')
 f.actions.punch();assert.equal(f.writes.length,1);assert.equal(f.view.canPunch.value,false)
})
test('ongoing visit or recording prevents checkout and resumes the same work',async(t)=>{
 const f=fixture(t);f.hooks.show();f.reads[0].resolve(day('ACTIVE'));f.boards[0].resolve(object({active:{id:'existing'}}));await flush()
 f.actions.punch();assert.equal(f.view.visitConflict.value,true);assert.equal(f.modals.length,0);assert.equal(f.writes.length,0)
 f.actions.start();assert.equal(f.navigation[0],'/visit/existing')
 f.view.active.value=null;f.local.recording=true;f.actions.punch();f.actions.start()
 assert.equal(f.modals.length,0);assert.equal(f.navigation[1],'/active')
})
test('account change discards old reads and invalidates an open checkout confirmation',async(t)=>{
 const f=fixture(t);f.hooks.show();f.reads[0].resolve(day('ACTIVE'));await flush();f.actions.punch()
 f.hooks.hide();f.session.revision++;await nextTick();f.modals[0].success({confirm:true})
 f.plans[0].resolve(object({items:[{planId:'old'}]}));await flush()
 assert.equal(f.writes.length,0);assert.equal(f.view.ready.value,false);assert.equal(f.view.plans.value.length,0)
})
test('plans preserve the selected date, reject malformed responses and retain actual completion status',async(t)=>{
 const f=fixture(t);f.hooks.show();f.plans[0].resolve(object({date:'2026-11-13'}));await flush()
 assert.equal(f.view.plansLoaded.value,false);assert.match(f.view.planError.value,/格式异常/)
 f.actions.choosePlanDay({detail:{value:'2026-11-14'}});assert.match(f.plans[1].url,/date=2026-11-14$/)
 f.plans[1].resolve(object({items:[{planId:'pending',status:'PLANNED'},{planId:'done',status:'COMPLETED'},{planId:'cancelled',status:'CANCELLED'}]}));await flush()
 assert.deepEqual(Array.from(f.view.visiblePlans.value,p=>p.id),['pending','done'])
 f.attendance.day=day('FINISHED');assert.equal(f.view.visiblePlans.value[0].status,'PLANNED')
})
test('permissions prevent attendance writes and history navigation',async(t)=>{
 const f=fixture(t);f.session.permissions=[];await nextTick();f.hooks.show();f.actions.punch();f.actions.history();f.actions.start()
 assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);assert.equal(f.navigation.length,0)
})

test('completed plans without a linked visit never initiate a new visit',async(t)=>{
 const f=fixture(t);f.hooks.show();f.reads[0].resolve(day('ACTIVE'));await flush()
 f.actions.openPlan({id:'completed',status:'COMPLETED',visitId:'',name:'门店'})
 assert.equal(f.navigation.length,0);assert.deepEqual(f.toasts,['该计划暂无关联拜访记录'])
})
