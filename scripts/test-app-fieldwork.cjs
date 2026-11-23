const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript')
const { reactive, ref, computed, watch, nextTick, effectScope } = require('vue')
function object(value) {
  if (value == null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(object)
  const result = Object.fromEntries(Object.entries(value).map(([key, item]) => [key, object(item)]))
  for (const [name, type] of [['getString', 'string'], ['getNumber', 'number'], ['getBoolean', 'boolean']]) {
    Object.defineProperty(result, name, { value: key => typeof result[key] === type ? result[key] : null })
  }
  return result
}
function fieldworkService() {
  const modules = { './crm.uts': {}, './attendance.uts': { attendanceClock: value => value.substring(11, 16) } }
  class NativeDate extends Date { static parse(value) { if (value.length == 0) throw new Error('Native Date.parse requires a timestamp'); return Date.parse(value) } }
  const context = { exports: {}, require: name => modules[name], Date: NativeDate }
  vm.createContext(context)
  vm.runInContext(ts.transpileModule(fs.readFileSync('app/services/track-motion.uts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  modules['./track-motion.uts'] = context.exports
  context.exports = {}
  vm.runInContext(ts.transpileModule(fs.readFileSync('app/services/fieldwork.uts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports
}
function parse(data, renderOnly = false) {
  const service = fieldworkService()
  return renderOnly ? service.visibleFieldLines(data) : service.parseFieldTrack(object(data))
}
test('route gaps remain separate legs and mileage uses server evidence', () => {
  const result = parse({
    legs: [
      { points: [{ latitude: 39, longitude: 116 }, { latitude: 39.01, longitude: 116.01 }] },
      { points: [{ latitude: 40, longitude: 117 }, { latitude: 40.01, longitude: 117.01 }] },
    ],
    gaps: [{ from: '2026-11-13T09:00:00', to: '2026-11-13T09:30:00', reason: 'TIME_GAP' }],
    distanceAvailable: true, totalDistanceMeters: 1250,
  })
  assert.equal(result.lines.length, 2)
  assert.equal(result.lines[0].points.length, 2)
  assert.equal(result.lines[1].points[0].latitude, 40)
  assert.equal(result.gaps, 1)
  assert.equal(result.distance, '1.3')
})
test('map marker IDs address records without inserting gaps into the timeline', () => {
  const result = parse({
    punches: [
      { eventType: 'CHECK_OUT', clientOccurredAt: '2026-11-13T18:00:00', latitude: 39.1, longitude: 116.1 },
      { eventType: 'CHECK_IN', clientOccurredAt: '2026-11-13T08:00:00', latitude: 39, longitude: 116 },
    ],
    visits: [{ visitId: 'visit-1', storeName: '验收门店', checkedInAt: '2026-11-13T10:00:00', latitude: 39.01, longitude: 116.01 }],
    gaps: [{ from: '2026-11-13T09:00:00', to: '2026-11-13T09:30:00' }],
    distanceAvailable: false, totalDistanceMeters: 0,
  })
  assert.equal(result.distance, '')
  assert.deepEqual(Array.from(result.markers, marker => marker.id), [1, 2, 3])
  for (const marker of result.markers) assert.ok(marker.eventIds.every(id => result.events[id - 1] != null))
})

function pageFixture(t, readCases = async () => []) {
  const session = reactive({ authenticated: true, tenantId: 'tenant', userId: 'sales', permissions: [] })
  const hooks = {}, calls = [], addressCalls = [], navigations = [], scope = effectScope(), timers = new Map()
  let timerId=0, clock=Date.now()
  class ClockDate extends Date { static now() { return clock } }
  const trackResult = { points: [], events: [], distance: '1.3', lines: [], markers: [], segments: [], pointCount: 0, lastPointAt: 0, rejected: 0, dwellMinutes: 0, dwellIncomplete: false, gaps: 0, available: true }
  const cached = { businessDate:'2026-11-13', sampleIntervalSeconds:5, maximumAccuracyMeters:50 }
  const local = reactive({ uploadRevision:0, uploadedDayId:'', points:[] })
  t.after(() => { hooks.unload?.(); scope.stop() })
  const owner = () => session.authenticated ? session.userId + ':' + session.permissions.join(',') : ''
  const modules = {
    '../../services/session.uts': { session, requireSession: () => session.authenticated, hasPermission: p => session.permissions.includes(p) },
    '../../services/config.uts': { appEnvironment: { environment: 'dev', gatewayOrigin: 'gateway' } },
    '../../services/crm.uts': { crmOwner: owner, crmToday: () => '2026-11-13', crmMessage: e => e.message },
    '../../services/attendance.uts': { attendance:cached,refreshAttendance:async()=>{},readWorkDay: date => new Promise((resolve, reject) => calls.push({ date, resolve, reject })), attendanceClock: value => value, workDurationLabel: () => Math.floor(clock/60000).toString() },
    '../../services/fieldwork-review.uts': { readOwnFieldCases: readCases, fieldCaseStatus: value => value },
    '../../services/fieldwork.uts': { fieldTrackPreview:fieldworkService().fieldTrackPreview, readFieldTrack: async () => ({...trackResult,events:trackResult.events.map(e=>({...e}))}), readPunchAddresses: () => new Promise(resolve => addressCalls.push(resolve)) },
    '../../services/field-tracking.uts': { fieldTracking:local, localTrackPoints:id=>local.points.filter(p=>p.day===id) },
    '../../services/visit-workbench.uts': {},
  }
  const context = {
    exports: {}, require: name => modules[name], ref, computed, watch, Date:ClockDate,
    setInterval:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id},clearInterval:id=>timers.delete(id),
    onLoad: f => hooks.load = f, onShow: f => hooks.show = f, onHide: f => hooks.hide = f, onUnload: f => hooks.unload = f, onBackPress: f => hooks.back = f,
    uni: { reLaunch: value => navigations.push(value.url) },
  }
  const source = fs.readFileSync('app/pages/fieldwork/fieldwork.uvue', 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  scope.run(() => vm.runInNewContext(ts.transpileModule(source + '\nexports.view = { loading, day, track, cases, error, mapFullscreen, workDuration, selected, preview }; exports.live = refreshLive; exports.toggle = toggleMapFullscreen;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context))
  return { ...context.exports, hooks, calls, addressCalls, trackResult, session, navigations, timers, cached, local, advance:ms=>clock+=ms }
}
const settle = () => new Promise(setImmediate)

const localFix = (seconds, longitude, extra = {}) => ({
  day:'today', session:'one', time:Date.parse('2026-11-13T02:00:00Z') + seconds * 1000,
  longitude, latitude:39, accuracy:4, source:'APP_GPS', ...extra,
})
test('offline view uses cached workday and continues drawing until server confirms the route', async t => {
  const f = pageFixture(t)
  f.session.permissions.push('sales:track:own:read')
  await nextTick()
  f.cached.day = { id:'today', date:'2026-11-13',status:'ACTIVE' }
  f.local.points.push(localFix(0,116),localFix(5,116.00013))
  f.hooks.show()
  await settle()
  f.calls[0].reject(new Error('网络连接失败'))
  await settle()
  assert.equal(f.view.preview.value.lines.length,1)
  f.toggle()
  assert.equal(f.view.mapFullscreen.value,true)
  f.local.uploadedDayId='today';f.local.uploadRevision++
  await settle()
  assert.equal(f.calls.length,2)
  f.trackResult.lastPointAt=f.local.points[1].time
  f.calls[1].resolve(f.cached.day)
  await settle()
  assert.equal(f.view.preview.value.lines.length,0)
  f.local.points.push(localFix(10,116.00026))
  assert.equal(f.view.preview.value.lines[0].points[0].longitude,116.00013)
})

test('local geometry ignores stationary jitter and coarse excursions and breaks across missing fixes', () => {
  const service = fieldworkService()
  const rows = [
    localFix(0,116),localFix(5,116.00003),localFix(10,116.00013),
    localFix(15,116.006,{accuracy:40}),localFix(20,116.00014),localFix(25,116.00026),
    localFix(30,116.01,{source:'APP_NETWORK'}),localFix(60,116.003),localFix(65,116.00313),
  ]
  const preview = service.fieldTrackPreview(rows,0,5,50)
  assert.deepEqual(Array.from(preview.lines,line=>Array.from(line.points,p=>p.longitude)),[[116,116.00013,116.00026],[116.003,116.00313]])
})
test('permission refresh reloads visible fieldwork and rejects the previous in-flight response', async t => {
  const f = pageFixture(t)
  f.hooks.show()
  await settle()
  f.session.permissions.push('sales:track:own:read')
  await nextTick()
  await settle()
  assert.equal(f.calls.length, 2)
  f.calls[0].resolve({ id: 'stale' })
  await settle()
  assert.equal(f.view.day.value, null)
  assert.equal(f.view.loading.value, true)
  f.calls[1].resolve({ id: 'current' })
  await settle()
  assert.equal(f.view.day.value.id, 'current')
  assert.equal(f.view.track.value.distance, '1.3')
  assert.equal(f.view.loading.value, false)
})
test('hidden account changes clear fieldwork without fetching and logout clears loading', async t => {
  const f = pageFixture(t)
  f.hooks.show()
  await settle()
  f.calls[0].resolve({ id: 'old-account' })
  await settle()
  f.hooks.hide()
  f.session.userId = 'another-sales'
  await nextTick()
  assert.equal(f.view.day.value, null)
  assert.equal(f.calls.length, 1)
  f.hooks.show()
  await settle()
  f.session.authenticated = false
  await nextTick()
  f.calls[1].resolve({ id: 'late-response' })
  await settle()
  assert.equal(f.view.day.value, null)
  assert.equal(f.view.loading.value, false)
  assert.deepEqual(f.navigations, ['/pages/login/login'])
})
function routeMapFixture(t, options = {}) {
  const source = fs.readFileSync('app/components/field-route-map/field-route-map.uvue', 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const props = reactive({ owner: 'owner', showCurrent: true, focus: null, markers: [], lines: [], localLines: [], localTail: null, points: [], ...options })
  const actions = []
  let granted = true
  const mounted = []
  const map = {
    includePoints({ points, success }) { actions.push(['fit', JSON.parse(JSON.stringify(points))]); success?.({}) },
    moveToLocation({ latitude, longitude, success }) { actions.push(['move', latitude, longitude]); success?.({}) },
  }
  const modules = {
    '../../uni_modules/uni-map-amap': { createAmapContext: () => map, convertGpsMapPoint: (latitude, longitude) => ({ latitude, longitude }) },
    '../../services/fieldwork.uts': { visibleFieldLines: lines => lines },
  }
  const context = {
    exports: {}, ref, computed, watch, require: name => modules[name] ?? {},
    defineProps: () => props, defineEmits: () => name => actions.push([name]),
    uni: {
      getStorageSync: () => true, getAppAuthorizeSetting: () => ({ locationAuthorized: granted ? 'authorized' : 'denied' }),
      showToast: ({ title }) => actions.push(['toast', title]),
    },
    onMounted: fn => mounted.push(fn),
  }
  const scope = effectScope()
  t.after(() => scope.stop())
  scope.run(() => vm.runInNewContext(ts.transpileModule(source + '\nexports.view = { initialCenter, initialBounds, fitOverview, moveToCurrent, locationAllowed };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context))
  mounted.forEach(fn => fn())
  return { props, actions, view: context.exports.view, revoke: () => { granted = false } }
}
const plain = value => JSON.parse(JSON.stringify(value))
test('a single map location retains street-level scale instead of fitting zero-sized bounds', t => {
  const f = routeMapFixture(t, { points: [{ latitude: 39, longitude: 116, time: 1 }, { latitude: 39, longitude: 116, time: 2 }] })
  assert.equal(f.view.initialBounds.value, null)
  assert.deepEqual(plain(f.view.initialCenter.value), { latitude: 39, longitude: 116 })
})
test('default and manual overview fit the whole route, including unsynced fixes, without jumping on updates', t => {
  const f = routeMapFixture(t, { points: [{ latitude: 39, longitude: 116, time: 1 }, { latitude: 39.15, longitude: 116.18, time: 2 }],
    localLines: [{ points: [{ latitude: 39.12, longitude: 116.1, time: 3 }, { latitude: 39.21, longitude: 116.13, time: 4 }] }] })
  const firstFit = [{ latitude: 39, longitude: 116 }, { latitude: 39.21, longitude: 116.18 }]
  assert.deepEqual(plain(f.view.initialBounds.value), firstFit)
  assert.equal(f.actions.length, 0)
  f.props.points.push({ latitude: 39.3, longitude: 116.25, time: 5 })
  assert.deepEqual(plain(f.view.initialBounds.value), firstFit)
  f.view.fitOverview()
  assert.deepEqual(f.actions, [['fit', [firstFit[0], { latitude: 39.3, longitude: 116.25 }]], ['clear-selection']])
})
test('map control views follow the fullscreen, overview and location order', () => {
  const template = fs.readFileSync('app/components/field-route-map/field-route-map.uvue', 'utf8').split('</template>')[0]
  const controls = Array.from(template.matchAll(/<(view|button)\b[^>]*class="route-control"[^>]*@click="([^"]+)"[^>]*>/g), ([, tag, action]) => [tag, action])
  assert.deepEqual(controls, [['view', 'toggleFullscreen'], ['view', 'fitOverview'], ['view', 'moveToCurrent']])
})
test('recenter uses the map’s current location and requests no permission automatically', async t => {
  const f = routeMapFixture(t, { points: [{ latitude: 39, longitude: 116, time: 1 }] })
  assert.equal(f.view.locationAllowed.value, true)
  f.view.moveToCurrent()
  assert.deepEqual(f.actions, [['move', undefined, undefined], ['clear-selection']])
  f.props.focus = { latitude: 40, longitude: 117, time: 0 }
  await nextTick()
  assert.deepEqual(f.actions.at(-1), ['move', 40, 117])
  const afterSelection = f.actions.length
  f.props.focus = { latitude: 40, longitude: 117, time: 0 }
  await nextTick()
  assert.equal(f.actions.length, afterSelection)
  f.revoke()
  f.view.moveToCurrent()
  assert.deepEqual(f.actions.at(-1), ['toast', '请在系统设置中允许定位'])
  f.props.showCurrent = false
  await nextTick()
  assert.equal(f.view.locationAllowed.value, false)
})
test('fullscreen reuses loaded data, back collapses first and account changes clear it', async t => {
  const f = pageFixture(t)
  f.toggle()
  assert.equal(f.view.mapFullscreen.value, false)
  f.view.track.value = { points: [{ latitude: 39, longitude: 116 }], events: [] }
  const track = f.view.track.value
  f.toggle()
  assert.equal(f.view.mapFullscreen.value, true)
  assert.equal(f.hooks.back(), true)
  assert.equal(f.view.mapFullscreen.value, false)
  assert.equal(f.hooks.back(), false)
  f.toggle(); f.toggle()
  assert.equal(f.view.mapFullscreen.value, false)
  assert.equal(f.view.track.value, track)
  assert.equal(f.calls.length, 0)
  f.toggle()
  f.session.userId = 'another-sales'
  await nextTick()
  assert.equal(f.view.mapFullscreen.value, false)
  assert.equal(f.view.track.value, null)
})

test('visits use chronological ordinals independent of punches, gaps and source sequence', () => {
  const result = parse({ punches: [{ eventType: 'CHECK_IN', clientOccurredAt: '2026-11-17T00:00:00Z', latitude: 30, longitude: 120 }], visits: [
    { visitId: 'second', sequence: 1, checkedInAt: '2026-11-17T09:30:00+08:00', checkedOutAt: '2026-11-17T10:10:00+08:00', dwellMinutes: 40, latitude: 30.2, longitude: 120.2, storeAddress: '地址二' },
    { visitId: 'first', sequence: 2, checkedInAt: '2026-11-17T01:00:00Z', checkedOutAt: '2026-11-17T01:20:00Z', dwellMinutes: 20, latitude: 30.1, longitude: 120.1, storeAddress: '地址一' },
  ], gaps: [{ from: '2026-11-17T01:25:00Z', to: '2026-11-17T01:26:00Z' }] })
  assert.deepEqual(Array.from(result.events.filter(e => e.kind === 'visit'), e => [e.key, e.sequence, e.badge]), [['first', 1, '1'], ['second', 2, '2']])
  assert.equal(result.events.find(e => e.key === 'second').dwell, '停留 40分钟')
  assert.equal(result.events.find(e => e.key === 'first').address, '地址一')
  assert.deepEqual(Array.from(result.markers, m => Array.from(m.sequences)), [[], [1], [2]])
  assert.equal('orderLines' in result, false)
  assert.equal(result.lines.length, 0)
  assert.equal(result.distance, '')
})
test('unknown position retains its ordinal without inventing a route', () => {
  const result = parse({ visits: [
    { visitId: 'a', checkedInAt: '2026-11-17T01:00:00Z', latitude: 30, longitude: 120, dwellMinutes: 0 },
    { visitId: 'b', checkedInAt: '2026-11-17T02:00:00Z' },
    { visitId: 'c', checkedInAt: '2026-11-17T03:00:00Z', latitude: 30.1, longitude: 120.1, dwellMinutes: 90 },
  ] })
  assert.deepEqual(Array.from(result.markers, m => Array.from(m.sequences)), [[1], [3]])
  assert.equal(result.lines.length, 0)
  assert.equal(result.events[0].dwell, '停留不足1分钟')
  assert.equal(result.events[1].dwell, '停留待确认')
  assert.equal(result.events[2].dwell, '停留 1小时30分钟')
  assert.match(result.events[2].timeRange, /进行中$/)
})

test('colocated visits keep every ordinal while punches stay separately identifiable', () => {
  const result = parse({ punches: [{ eventType: 'CHECK_IN', clientOccurredAt: '2026-11-17T00:00:00Z', latitude: 30, longitude: 120 }, { eventType: 'CHECK_OUT', clientOccurredAt: '2026-11-17T04:00:00Z', latitude: 30, longitude: 120 }], visits: [
    { visitId: 'a', checkedInAt: '2026-11-17T01:00:00Z', latitude: 30, longitude: 120 },
    { visitId: 'b', checkedInAt: '2026-11-17T02:00:00Z', latitude: 30, longitude: 120 },
    { visitId: 'c', checkedInAt: '2026-11-17T03:00:00Z', latitude: 30, longitude: 120 },
  ] })
  assert.deepEqual(Array.from(result.markers, m => m.kind), ['start', 'visit', 'end'])
  assert.deepEqual(Array.from(result.markers[1].sequences), [1, 2, 3])
  assert.deepEqual(Array.from(result.markers[1].eventIds), [2, 3, 4])
  assert.equal(result.markers[0].latitude, result.markers[2].latitude)
})

test('address hydration replaces the native track reference and rejects an old account response', async t => {
  const f = pageFixture(t)
  f.trackResult.events = [{ key: 'punch-0', kind: 'start', address: '地址加载中…' }]
  f.session.permissions.push('sales:track:own:read')
  await nextTick()
  f.hooks.show(); await settle(); f.calls[0].resolve({ id: 'day' }); await settle()
  const first = f.view.track.value
  f.addressCalls[0]([{ key: 'punch-0', address: '真实签到地址' }]); await settle()
  assert.notEqual(f.view.track.value, first)
  assert.equal(f.view.track.value.events[0].address, '真实签到地址')
  f.hooks.show(); await settle(); f.calls[1].resolve({ id: 'day' }); await settle()
  f.session.userId = 'another-account'; await nextTick()
  f.addressCalls[1]([{ key: 'punch-0', address: '旧账号地址' }]); await settle()
  assert.equal(f.view.track.value, null)
})


test('cancelled captures never take a number, contribute dwell, or create a marker', () => {
 const result=parse({visits:[
  {visitId:'cancelled',status:'CANCELLED',checkedInAt:'2026-11-17T01:00:00Z',dwellMinutes:500,latitude:30,longitude:120},
  {visitId:'real',status:'CHECKED_OUT',checkedInAt:'2026-11-17T02:00:00Z',dwellMinutes:20,latitude:31,longitude:121}
 ]});assert.deepEqual(Array.from(result.events,e=>[e.key,e.sequence]),[['real',1]]);assert.equal(result.dwellMinutes,20);assert.equal(result.markers.length,1);assert.equal(result.available,false);assert.equal(result.lines.length,0)
})
test('selected segments keep server gaps and never use store coordinates as route evidence', () => {
 const result=parse({visits:[
  {visitId:'a',checkedInAt:'2026-11-17T00:50:00Z',checkedOutAt:'2026-11-17T01:00:00Z',latitude:30,longitude:120},
  {visitId:'b',checkedInAt:'2026-11-17T01:20:00Z',latitude:31,longitude:121}],
  legs:[{points:[{latitude:30,longitude:120,clientOccurredAt:'2026-11-17T00:59:00Z'},{latitude:30.01,longitude:120,clientOccurredAt:'2026-11-17T01:01:00Z'},{latitude:30.02,longitude:120,clientOccurredAt:'2026-11-17T01:02:00Z'}]},
        {points:[{latitude:30.03,longitude:120,clientOccurredAt:'2026-11-17T01:18:00Z'},{latitude:30.04,longitude:120,clientOccurredAt:'2026-11-17T01:19:00Z'}]}],
  segments:[{fromVisitId:'a',toVisitId:'b',distanceSource:'OBSERVED_ESTIMATE',distanceMeters:1234}]});
 assert.equal(result.segments.length,1);assert.equal(result.segments[0].lines.length,2);assert.equal(result.segments[0].points.length,4);assert.equal(result.segments[0].distance,'1.2 km');assert.equal(result.segments[0].points[0].latitude,30.01)
})


test('live track refresh preserves map selection and hydrated addresses while updating the route',async t=>{
 const f=pageFixture(t);f.session.permissions.push('sales:track:own:read');await nextTick()
 f.trackResult.events=[{key:'punch-0',sortTime:'start',kind:'start',address:'地址加载中…'}]
 f.hooks.show();await settle();f.calls[0].resolve({id:'day',status:'ACTIVE'});await settle()
 f.addressCalls[0]([{key:'punch-0',address:'已解析地址'}]);await settle()
 f.view.mapFullscreen.value=true;f.view.selected.value='punch-0'
 const before=f.view.workDuration.value;f.advance(60000)
 Array.from(f.timers.values()).find(t=>t.delay===15000).fn()
 assert.notEqual(f.view.workDuration.value,before)
 f.trackResult.distance='2.1'
 const pending=f.live();await settle();assert.equal(f.calls.length,2)
 f.calls[1].resolve({id:'day',status:'ACTIVE'});await pending
 assert.equal(f.view.track.value.distance,'2.1');assert.equal(f.view.mapFullscreen.value,true)
 assert.equal(f.view.selected.value,'punch-0');assert.equal(f.view.track.value.events[0].address,'已解析地址')
 assert.equal(f.addressCalls.length,1)
})
test('live refresh stops when hidden and never installs a late response',async t=>{
 const f=pageFixture(t);f.session.permissions.push('sales:track:own:read');await nextTick()
 f.hooks.show();await settle();f.calls[0].resolve({id:'day',status:'ACTIVE'});await settle()
 const pending=f.live();await settle();f.hooks.hide();assert.equal(f.timers.size,0)
 f.calls[1].resolve({id:'late',status:'FINISHED'});await pending
 assert.equal(f.view.day.value.id,'day');await f.live();assert.equal(f.calls.length,2)
})
test('finished days do not poll and failed live reads retain the last route',async t=>{
 const f=pageFixture(t);f.hooks.show();await settle();f.calls[0].resolve({id:'day',status:'FINISHED'});await settle()
 await f.live();assert.equal(f.calls.length,1)
 f.view.day.value={id:'day',status:'ACTIVE'};f.view.track.value={points:[],distance:'1.3'}
 const pending=f.live();await settle();f.calls[1].reject(Error('离线'));await pending
 assert.equal(f.view.track.value.distance,'1.3');assert.match(f.view.error.value,/上次记录.*离线/)
})


test('a slow review-case query does not block track rendering and its late failure stays separate', async t => {
  let rejectCases
  const f = pageFixture(t, () => new Promise((_resolve, reject) => { rejectCases = reject }))
  f.session.permissions.push('sales:track:own:read')
  f.hooks.show(); await settle()
  f.calls.at(-1).resolve({ id: 'day', status: 'ACTIVE', periods: [] })
  await settle()
  assert.equal(f.view.loading.value, false)
  assert.equal(f.view.track.value.distance, '1.3')
  rejectCases(new Error('review temporarily unavailable')); await settle()
  assert.equal(f.view.error.value, '')
  assert.equal(f.view.track.value.distance, '1.3')
})

test('repeated forward and reverse edges render once without joining separate legs', () => {
  const a = {latitude:39,longitude:116,time:0}, b = {latitude:39.001,longitude:116,time:60}, c = {latitude:40,longitude:117,time:180}, d = {latitude:40.001,longitude:117,time:240}
  const style = {color:'#c64c1c',width:4,arrow:true}
  const routes = [{...style,points:[a,b,a,b]},{...style,points:[c,d]}]
  const drawn = parse(routes, true)
  assert.equal(drawn.length, 2); assert.deepEqual(Array.from(drawn[0].points), [a,b]); assert.deepEqual(Array.from(drawn[1].points), [c,d])
  assert.equal(routes[0].points.length, 4)
})
