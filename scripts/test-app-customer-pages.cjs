const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
const { reactive, ref, computed, watch, nextTick } = require('vue')

function fixture(page, nearby = false, deferAreas = false) {
  const session = reactive({ authenticated: true, revision: 1, permissions: ['crm:pool:private-read', 'crm:pool:public-read', 'crm:pool:claim'] })
  const requests = [], hooks = {}, snapshots = new Map(), modals = [], locations = [], nearbyRequests = [], timers = [], areaRequests = [], nearbySnapshots = new Map()
  const request = (...args) => new Promise((resolve, reject) => requests.push({ args, resolve, reject }))
  const owner = () => session.authenticated ? session.revision + ':' + session.permissions.join(',') : ''
  const modules = {
    '../../services/config.uts': {appEnvironment:{environment:'test'}},
    '../../services/session.uts': { session, hasPermission: p => session.authenticated && session.permissions.includes(p), requireSession: () => session.authenticated },
    '../../services/crm.uts': { crmOwner: owner, crmToday: () => '2026-11-12', crmMessage: e => e.message,
      crmList: request, crmListSnapshot: (kind, term, filters) => snapshots.get(kind + (filters ?? '')) ?? null,
      crmPublicAreas: () => deferAreas ? new Promise(resolve => areaRequests.push(resolve)) : Promise.resolve([]), crmAreaChildren: () => [], crmMutation: request },
    '../../services/customer-workbench.uts': { customerPublicCount: () => request('public-count'), customerPublicCountSnapshot: () => snapshots.get('public-count') ?? null, customerSummary: request, customerSummarySnapshot: from => snapshots.get(from) ?? null,
      customerCount: (data, field) => data?.[field]?.toString() ?? '—', customerRatio: () => '—', customerPeriodQuery: () => '',
      customerList: request, customerListSnapshot: () => null, customerStoreRow: row => row, customerOpen: () => {} },
    '../../services/customer-nearby.uts': {
      customerNearbySnapshot: kind => nearbySnapshots.get(kind) ?? null,
      customerNearbyOriginSnapshot: () => null,
      customerNearbyLocation: () => nearby ? new Promise((resolve, reject) => locations.push({resolve,reject})) : Promise.reject(new Error('定位未授权')),
      customerNearbyList: (...args) => new Promise((resolve, reject) => nearbyRequests.push({args,resolve,reject})),
      nearbyDistance: (a,b,c,d) => Math.hypot(a-c,b-d)*111000,
      nearbyUpdateDistances: (rows,point) => rows.forEach(row=>row.distanceText='distance@'+point.gpsLongitude)
    },
    '../../services/workbench.uts': { workbenchPeriod: period => ({ from: period == 'today' ? '2026-11-12' : '2026-11-01', to: '2026-11-12' }) }
  }
  const state = page == 'customers' ? 'data, publicCount, loading, period, error' : 'rows, total, cursor, loading, kind, province, city, county, error, nearAnchor, nearCurrent, nearChanged, locationError, nearDisplayed'
  const actions = page == 'customers' ? 'reload, selectPeriod' : 'load, switchView, more, claim, refreshLocation'
  const source = fs.readFileSync(path.join(__dirname, '../app/pages/' + page + '/' + page + '.uvue'), 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const context = { exports: {}, require: name => modules[name], ref, computed, watch, setInterval: callback => {timers.push(callback);return timers.length}, clearInterval: () => {},
    onLoad: callback => hooks.load = callback, onShow: callback => hooks.show = callback, onHide: callback => hooks.hide = callback, onUnload: callback => hooks.unload = callback,
    uni: { showModal: value => modals.push(value), navigateTo: () => {}, showToast: () => {} } }
  vm.runInNewContext(ts.transpileModule(source + '\nexports.view = {' + state + '}; exports.actions = {' + actions + '};', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context.exports, session, requests, hooks, snapshots, modals, locations, nearbyRequests, timers, areaRequests, nearbySnapshots }
}
const flush = () => new Promise(setImmediate)

test('overview renders a matching snapshot immediately, deduplicates refresh and replaces it with fresh counts', async () => {
  const f = fixture('customers'); f.snapshots.set('2026-11-12', { mine: 1, publicPool: 2 })
  f.hooks.show(); assert.equal(f.view.data.value.mine, 1); assert.equal(f.view.loading.value, true)
  f.actions.reload(); f.actions.selectPeriod('today'); assert.equal(f.requests.length, 1)
  f.requests[0].resolve({ mine: 3, publicPool: 4 }); await flush()
  assert.equal(f.view.data.value.mine, 3); assert.equal(f.view.publicCount.value, '4'); assert.equal(f.view.loading.value, false)
})
test('period changes and leaving overview ignore stale responses; read errors clear cached counts', async () => {
  const f = fixture('customers'); f.hooks.show(); f.actions.selectPeriod('month')
  f.requests[1].resolve({ mine: 2 }); await flush(); f.requests[0].resolve({ mine: 99 }); await flush()
  assert.equal(f.view.data.value.mine, 2)
  f.snapshots.set('2026-11-01', { mine: 5 }); f.actions.reload(); assert.equal(f.view.data.value.mine, 5)
  f.requests[2].reject(new Error('无权限')); await flush()
  assert.equal(f.view.data.value, null); assert.equal(f.view.publicCount.value, '—'); assert.equal(f.view.error.value, '无权限')
  f.actions.reload(); f.hooks.hide(); f.requests[3].resolve({ mine: 99 }); await flush()
  assert.equal(f.view.data.value.mine, 5); assert.equal(f.view.loading.value, false)
})
test('revoking access while overview is hidden clears the previously rendered customer counts', async () => {
  const f = fixture('customers'); f.hooks.show(); f.requests[0].resolve({ mine: 3 }); await flush(); f.hooks.hide()
  f.session.permissions = []; await nextTick()
  assert.equal(f.view.data.value, null); assert.equal(f.view.publicCount.value, '—')
})
test('pool switching hydrates the exact filtered snapshot and stale responses cannot replace the current pool', async () => {
  const f = fixture('customer-list'); f.hooks.load({ kind: 'MINE' }); f.hooks.show(); await flush()
  f.view.province.value = '510000'; f.view.city.value = '510100'; f.view.county.value = '510107'
  f.snapshots.set('PUBLIC&phase=&protection=&activity=&businessStatus=&province=510000&city=510100&county=510107', { items: [{ id: 'public', blocked: '' }], total: 8, cursor: '' })
  await f.actions.switchView('PUBLIC'); await flush(); assert.equal(f.view.rows.value[0].id, 'public'); assert.equal(f.view.total.value, 8)
  assert.match(f.requests[1].args[3], /county=510107/)
  await f.actions.claim(f.view.rows.value[0]); assert.equal(f.modals.length, 0)
  f.requests[0].resolve({ items: [{ id: 'old' }], total: 1, cursor: '' }); await flush()
  assert.equal(f.view.rows.value[0].id, 'public')
  f.requests[1].resolve({ items: [{ id: 'fresh' }], total: 9, cursor: 'next' }); await flush()
  assert.equal(f.view.rows.value[0].id, 'fresh'); assert.equal(f.view.loading.value, false)
  f.actions.more(); f.actions.more(); assert.equal(f.requests.length, 3); assert.equal(f.requests[2].args[2], 'next')
  f.requests[2].resolve({ items: [{ id: 'page2' }], total: 9, cursor: '' }); await flush()
  assert.deepEqual(Array.from(f.view.rows.value, r => r.id), ['fresh', 'page2'])
})
test('customer-list hides stale rows on a refresh failure and ignores responses after navigation away', async () => {
  const f = fixture('customer-list'); f.hooks.load({ kind: 'MINE' }); f.hooks.show(); await flush()
  f.requests[0].resolve({ items: [{ id: 'one' }], total: 1, cursor: '' }); await flush()
  f.actions.load(false); f.requests[1].reject(new Error('权限已更新')); await flush()
  assert.equal(f.view.rows.value.length, 0); assert.equal(f.view.total.value, null); assert.equal(f.view.error.value, '权限已更新')
  f.actions.load(false); f.hooks.hide(); f.requests[2].resolve({ items: [{ id: 'late' }], total: 1, cursor: '' }); await flush()
  assert.equal(f.view.rows.value.length, 0); assert.equal(f.view.loading.value, false)
})


test('public-only overview uses a date-independent count and no list, private or order request', async () => {
  const f=fixture('customers'); f.session.permissions=['crm:pool:public-read']; await nextTick()
  f.snapshots.set('public-count',{total:2010}); f.hooks.show()
  assert.equal(f.view.publicCount.value,'2010'); assert.deepEqual(f.requests[0].args,['public-count'])
  f.actions.selectPeriod('month'); assert.equal(f.requests.length,1)
  f.requests[0].resolve({total:2011}); await flush()
  f.actions.selectPeriod('today'); assert.equal(f.requests.length,1); assert.equal(f.view.publicCount.value,'2011')
  f.hooks.hide(); f.hooks.show(); assert.equal(f.requests.length,2)
  f.requests[1].reject(new Error('权限已收回')); await flush(); assert.equal(f.view.publicCount.value,'—')
})

const center = (lng=120) => ({gpsLongitude:lng,gpsLatitude:30,gcjLongitude:lng+.005,gcjLatitude:30.002})
test('nearby updates distance without moving rows; pagination retains its original anchor until refresh', async()=>{
 const f=fixture('customer-list',true);f.hooks.load({kind:'PUBLIC'});f.hooks.show();await flush();assert.equal(f.requests.length,1)
 f.locations[0].resolve(center());await flush();assert.equal(f.nearbyRequests.length,1)
 f.nearbyRequests[0].resolve({items:[{id:'a'},{id:'b'}],total:40,cursor:'next',origin:center()});await flush()
 f.timers[0]();f.locations[1].resolve(center(120.01));await flush()
 assert.deepEqual(Array.from(f.view.rows.value,r=>r.id),['a','b']);assert.equal(f.view.rows.value[0].distanceText,'distance@120.01');assert.equal(f.view.nearChanged.value,true)
 assert.equal(f.nearbyRequests.length,1);f.actions.more();assert.equal(f.nearbyRequests[1].args[6].gpsLongitude,120);assert.equal(f.nearbyRequests[1].args[7],'next')
 f.nearbyRequests[1].resolve({items:[{id:'c'}],total:40,cursor:'after',origin:center()});await flush()
 f.actions.refreshLocation(true);f.locations[2].resolve(center(120.02));await flush();assert.equal(f.nearbyRequests[2].args[6].gpsLongitude,120.02);assert.equal(f.nearbyRequests[2].args[7],'');assert.equal(f.view.nearChanged.value,false)
})
test('nearby errors fall back visibly; location results after hide or account change are discarded',async()=>{
 const f=fixture('customer-list',true);f.hooks.load({kind:'MINE'});f.hooks.show();f.locations[0].reject(new Error('定位未授权'));await flush()
 assert.match(f.view.locationError.value,/默认顺序/);assert.equal(f.requests.length,1);assert.equal(f.nearbyRequests.length,0)
 f.actions.refreshLocation(true);f.hooks.hide();f.locations[1].resolve(center());await flush();assert.equal(f.view.nearAnchor.value,null);assert.equal(f.nearbyRequests.length,0)
 f.hooks.show();f.session.revision=2;await nextTick();f.locations[2].resolve(center());await flush();assert.equal(f.view.nearAnchor.value,null);assert.equal(f.nearbyRequests.length,0)
})

test('switching to public discards the former list while area filters are still loading', async () => {
  const f = fixture('customer-list', true, true); f.hooks.load({kind:'MINE'}); f.hooks.show()
  f.locations[0].resolve(center()); await flush()
  const switching = f.actions.switchView('PUBLIC')
  f.nearbyRequests[0].resolve({items:[{id:'private'}],total:1,cursor:'',origin:center()}); await flush()
  assert.equal(f.view.rows.value.length, 0); assert.equal(f.view.total.value, null)
  f.areaRequests[0]([]); await switching; await flush()
  assert.equal(f.nearbyRequests[1].args[0], 'PUBLIC')
})

test('first visit loads customers before GPS resolves and preserves them during nearby replacement', async () => {
 const f=fixture('customer-list',true);f.hooks.load({kind:'MINE'});f.hooks.show()
 assert.equal(f.requests.length,1);assert.equal(f.locations.length,1)
 f.requests[0].resolve({items:[{id:'visible'}],total:1,cursor:''});await flush()
 assert.equal(f.view.rows.value[0].id,'visible')
 f.locations[0].resolve(center());await flush()
 assert.equal(f.nearbyRequests.length,1);assert.equal(f.view.rows.value[0].id,'visible');assert.equal(f.view.nearDisplayed.value,false)
 f.nearbyRequests[0].resolve({items:[{id:'nearest'}],total:1,cursor:'',origin:center()});await flush()
 assert.equal(f.view.rows.value[0].id,'nearest');assert.equal(f.view.nearDisplayed.value,true)
})
test('nearby snapshots render before network and manual refresh never blanks existing rows', async () => {
 const f=fixture('customer-list',true)
 f.nearbySnapshots.set('MINE',{items:[{id:'cached'}],total:1,cursor:'',origin:center()})
 f.hooks.load({kind:'MINE'});f.hooks.show()
 assert.equal(f.view.rows.value[0].id,'cached');assert.equal(f.requests.length,0);assert.equal(f.nearbyRequests.length,1)
 f.nearbyRequests[0].resolve({items:[{id:'fresh'}],total:1,cursor:'',origin:center()});await flush()
 f.locations[0].resolve(center());await flush();assert.equal(f.nearbyRequests.length,1)
 f.actions.refreshLocation(true);f.locations[1].resolve(center(120.02));await flush()
 assert.equal(f.view.rows.value[0].id,'fresh');assert.equal(f.nearbyRequests.length,2)
 f.nearbyRequests[1].reject(new Error('无法连接公司服务，请检查网络后重试。'));await flush()
 assert.equal(f.view.rows.value[0].id,'fresh');assert.match(f.view.error.value,/显示上次资料/)
 f.actions.load(false,true);f.nearbyRequests[2].reject(new Error('暂无此功能或数据的权限'));await flush()
 assert.equal(f.view.rows.value.length,0)
})

test('cold public list starts while area metadata and GPS are pending', async () => {
 const f=fixture('customer-list',true,true);f.hooks.load({kind:'PUBLIC'});f.hooks.show()
 assert.equal(f.areaRequests.length,1);assert.equal(f.requests.length,1);assert.equal(f.locations.length,1)
 f.requests[0].resolve({items:[{id:'available'}],total:1,cursor:'next'});await flush()
 assert.equal(f.view.rows.value[0].id,'available');assert.equal(f.view.cursor.value,'next')
 f.areaRequests[0]([{code:'110000',name:'北京市',level:'PROVINCE',parent:''}]);await flush()
 assert.equal(f.requests.length,1);assert.equal(f.view.province.value,'');assert.equal(f.view.cursor.value,'next')
})

function visitEntryFixture() {
  const session = reactive({ authenticated: true, revision: 1 })
  const owner = () => 'tenant:user:' + session.revision
  const hooks = {}, modals = [], navigations = [], starts = [], checks = [], locationCalls = []
  const origin = { gpsLongitude: 120, gpsLatitude: 30, gcjLongitude: 120.005, gcjLatitude: 30.002 }
  const policy = { radiusMeters: 200, captureRules: { maximumLocationAccuracyMeters: 100, automaticRecording: false } }
  let prepared = { owner: owner(), requestedAt: Date.now(), receivedAt: Date.now(), location: { getNumber: () => 15 } }
  let policyLoad = () => Promise.resolve(policy), locate = () => Promise.resolve(origin)
  let start = () => Promise.resolve({ storeId: '100', visitId: 'visit', captureId: 'capture' })
  const modules = {
    '../../services/api.uts': { apiErrorMessage: () => '请到店后再开始拜访' },
    '../../services/session.uts': { hasPermission: () => true },
    '../../services/attendance.uts': { attendanceStatus: async () => { checks.push('attendance'); return 'ACTIVE' }, checkInAttendance: async () => checks.push('checkin') },
    '../../services/crm.uts': { crmOwner: owner, crmMessage: e => e.message, crmStartVisit: (...args) => { starts.push(args); return start(...args) } },
    '../../services/customer-workbench.uts': {}, '../../services/workbench.uts': {},
    '../../services/visit-policy.uts': { currentVisitEntryPolicy: () => policyLoad(), validateLocationAccuracy: (a,m) => { if(a > m) throw new Error('定位误差超过范围') }, requestVisitMicrophone: async () => checks.push('microphone') },
    '../../services/customer-nearby.uts': { customerNearbyOriginSnapshot: () => origin, customerNearbyVisitLocation: () => prepared,
      customerNearbyLocation: (...args) => { locationCalls.push(args); return locate() }, nearbyDistance: (a,b,c,d) => Math.hypot(a-c,b-d)*100000 }
  }
  const source = fs.readFileSync(path.join(__dirname, '../app/pages/customer-detail/customer-detail.uvue'), 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const exports = '\nexports.view={busy,loading,visitPhase,entryOrigin,detail,activeVisit}; exports.visit=visit; exports.ready=()=>{visible=true; own.value=true; id.value="100"; entryOrigin.value=origin;detail.value={longitude:120.005,latitude:30.002,coordinateSystem:"GCJ02",businessStatus:"OPEN"};};'
  const ctx = { exports:{}, require:n=>modules[n], origin, policy, ref, computed, watch, Error, setInterval:()=>1,clearInterval:()=>{},
    onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,
    uni:{showModal:o=>modals.push(o),navigateTo:o=>navigations.push(o)} }
  vm.runInNewContext(ts.transpileModule(source+exports,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx)
  ctx.exports.ready()
  return {...ctx.exports,session,hooks,modals,navigations,starts,checks,locationCalls,policy,
    setPrepared:p=>prepared=p,setPolicyLoad:f=>policyLoad=f,setLocate:f=>locate=f,setStart:f=>start=f}
}

test('visit click immediately locks, shows progress, coalesces clicks and keeps lock until navigation completes',async()=>{
  const f=visitEntryFixture();let finish
  f.setStart(()=>new Promise(resolve=>finish=resolve))
  const first=f.visit();assert.equal(f.view.busy.value,true);assert.equal(f.view.visitPhase.value,'准备拜访…')
  await f.visit();await flush();assert.equal(f.starts.length,1);assert.equal(f.locationCalls.length,0)
  assert.ok(f.starts[0][2],'recent normalized location is forwarded')
  f.starts[0][3]('核对拜访…');assert.equal(f.view.visitPhase.value,'核对拜访…')
  finish({storeId:'100',visitId:'visit',captureId:'capture'});await flush()
  assert.equal(f.navigations.length,1);assert.equal(f.view.busy.value,true)
  await f.visit();assert.equal(f.starts.length,1)
  f.navigations[0].success({});await first;assert.equal(f.view.busy.value,false)
})
test('known outside-radius visit prompts arrival without exposing distances before attendance, microphone, location or creation',async()=>{
  const f=visitEntryFixture();f.view.detail.value.longitude=120.015
  const pending=f.visit();await flush()
  assert.equal(f.modals.length,1);assert.equal(f.modals[0].content,'请到店后再开始拜访')
  assert.equal(f.modals[0].cancelText,'我已到店');assert.equal(f.modals[0].confirmText,'知道了')
  assert.equal(f.starts.length,0);assert.equal(f.locationCalls.length,0);assert.equal(f.checks.length,0)
  assert.equal(f.view.busy.value,true);await f.visit();assert.equal(f.modals.length,1)
  f.modals[0].success({confirm:true});await pending;assert.equal(f.view.busy.value,false)
})
test('arrival action forces one new fix despite a cached location and keeps the lock while still outside',async()=>{
  const f=visitEntryFixture();f.view.detail.value.longitude=120.015
  let finish;f.setLocate(()=>new Promise(resolve=>finish=resolve))
  const pending=f.visit();await flush();f.modals[0].success({cancel:true,confirm:false});await flush()
  assert.equal(f.view.visitPhase.value,'更新位置…');assert.equal(f.view.busy.value,true)
  assert.deepEqual(Array.from(f.locationCalls[0]),['MINE',true]);await f.visit();assert.equal(f.locationCalls.length,1)
  finish(f.view.entryOrigin.value);await flush()
  assert.equal(f.modals.length,2);assert.equal(f.starts.length,0);assert.equal(f.checks.length,0)
  f.modals[1].success({confirm:true,cancel:false});await pending;assert.equal(f.view.busy.value,false)
})
test('arrival retry continues normal checks with the fresh location only after reaching the store',async()=>{
  const f=visitEntryFixture();f.view.detail.value.longitude=120.015
  const fresh={owner:'fresh',requestedAt:Date.now(),receivedAt:Date.now(),location:{getNumber:()=>10}}
  f.setLocate(async()=>{const point=f.view.entryOrigin.value;point.gcjLongitude=120.015;f.setPrepared(fresh);return point})
  const pending=f.visit();await flush();f.modals[0].success({cancel:true,confirm:false});await flush()
  assert.equal(f.locationCalls.length,1);assert.equal(f.starts.length,1);assert.equal(f.starts[0][2],fresh)
  assert.deepEqual(f.checks,['attendance']);assert.equal(f.navigations.length,1)
  f.navigations[0].success({});await pending;assert.equal(f.view.busy.value,false)
})
test('leaving during arrival refresh cancels continuation and refresh failure gets one ordinary error prompt',async()=>{
  for(const mode of ['leave','fail']){
    const f=visitEntryFixture();f.view.detail.value.longitude=120.015;let finish,fail
    f.setLocate(()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject}))
    const pending=f.visit();await flush();f.modals[0].success({cancel:true,confirm:false});await flush()
    if(mode==='leave'){f.hooks.hide();finish(f.view.entryOrigin.value);await pending;assert.equal(f.modals.length,1)}
    else{fail(new Error('定位权限被拒绝'));await flush();assert.equal(f.modals.length,2);assert.equal(f.modals[1].showCancel,false);f.modals[1].success({confirm:true,cancel:false});await pending}
    assert.equal(f.starts.length,0);assert.equal(f.checks.length,0);assert.equal(f.view.busy.value,false)
  }
})
test('missing recent location has explicit progress; permission failure is visible and permits retry',async()=>{
  const f=visitEntryFixture();f.setPrepared(null);let fail
  f.setLocate(()=>new Promise((resolve,reject)=>fail=reject))
  const pending=f.visit();await flush();assert.equal(f.view.visitPhase.value,'获取位置…');assert.equal(f.view.busy.value,true)
  fail(new Error('定位权限被拒绝'));await flush();assert.equal(f.modals.length,1);assert.match(f.modals[0].content,/权限被拒绝/)
  assert.equal(f.starts.length,0);f.modals[0].success({});await pending;assert.equal(f.view.busy.value,false)
})
test('leaving or switching accounts during visit preparation cannot check in, create or navigate',async()=>{
  for(const leave of ['hide','account']) {
    const f=visitEntryFixture();let finish
    f.setPolicyLoad(()=>new Promise(resolve=>finish=resolve));const pending=f.visit();await flush()
    if(leave==='hide')f.hooks.hide();else {f.session.revision++;await nextTick()}
    finish(f.policy);await pending
    assert.equal(f.checks.length,0);assert.equal(f.starts.length,0);assert.equal(f.navigations.length,0);assert.equal(f.modals.length,0)
  }
})
test('existing active visit can resume from outside radius without an unnecessary new GPS fix',async()=>{
  const f=visitEntryFixture();f.view.activeVisit.value=true;f.view.detail.value.longitude=125;f.setPrepared(null)
  f.setPolicyLoad(()=>{throw new Error('new policy must not block resuming the existing capture')})
  const pending=f.visit();await flush();assert.equal(f.starts.length,1);assert.equal(f.locationCalls.length,0);assert.equal(f.checks.length,0)
  assert.equal(f.navigations.length,1);f.navigations[0].success({});await pending
})
test('server rejection and navigation failure appear in one dismissible visit prompt',async()=>{
  for(const mode of ['server','navigation']) {
    const f=visitEntryFixture();if(mode==='server')f.setStart(()=>Promise.reject(new Error('门店归属已变化')))
    const pending=f.visit();await flush();if(mode==='navigation'){f.navigations[0].fail({});await flush()}
    assert.equal(f.modals.length,1);assert.match(f.modals[0].content,mode==='server'?/归属已变化/:/页面打开失败/)
    f.modals[0].success({});await pending;assert.equal(f.view.busy.value,false)
  }
})

