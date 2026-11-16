// Executes the native CRM orchestration with deterministic transport and device adapters.
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
function object(value) {
  if (Array.isArray(value)) return value.map(object)
  if (!value || typeof value !== 'object') return value
  const result = Object.fromEntries(Object.entries(value).map(([key, val]) => [key, object(val)]))
  for (const [name, type] of [['getString', 'string'], ['getNumber', 'number'], ['getBoolean', 'boolean'], ['getJSON', 'object']]) Object.defineProperty(result, name, { value: key => typeof result[key] === type ? result[key] : null })
  return result
}
const plain = value => JSON.parse(JSON.stringify(value))
function fixture(storage = new Map(), date = Date) {
  const requests = [], locations = [], session = { authenticated: true, tenantId: 'tenant', userId: 'user', revision: 1, permissions: [] }
  let handler = () => ({ code: 'OK', data: {} })
  const apiErrorMessage = code => code === 'SALES_VISIT_NOT_FOUND' ? '拜访记录不存在' : code === 'SALES_WORK_DAY_NOT_FOUND' ? '当天尚未上班签到' : code
  const modules = {
    './customer-cache.uts': { refreshCustomerSnapshot: (_path, load) => load(), invalidateCustomerCache: () => {}, readCustomerSnapshot: () => null },
    './session.uts': { session }, './customer-cache.uts': { readCustomerSnapshot: () => null, refreshCustomerSnapshot: (_path, load) => load(), invalidateCustomerCache: () => {} }, './api.uts': { apiErrorMessage, requestApi: (url, method, body, success, fail) => {
      requests.push({ url, method, body: plain(body) })
      Promise.resolve().then(() => handler(url, method, body)).then(result => success(object(result)), e => fail(e.message))
    } },
    './sales-profile.uts': { requestSalesApi: (_url, success) => success(object({ data: {} })) },
    './location.uts': { requestDeviceLocation: success => { locations.push(true); success({ longitude: 120, latitude: 30, accuracy: 12, coordinateSystem: 'WGS84' }) } },
  }
  const source = fs.readFileSync(path.join(__dirname, '../app/services/crm.uts'), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const ctx = { exports: {}, require: name => modules[name], JSON: { parse: text => object(JSON.parse(text)), stringify: JSON.stringify }, uni: { getStorageSync: key => storage.get(key) ?? '', setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key) }, Error }
  ctx.Date = date
  vm.runInNewContext(compiled, ctx)
  return { crm: ctx.exports, requests, locations, session, storage, respond: next => { handler = next }, apiErrorMessage }
}
test('empty or invalid deadlines do not crash native rendering when switching pools', () => {
  class AndroidDate extends Date {
    static parse(value) { if (!value || value === 'invalid') throw new Error('native date parse'); return Date.parse(value) }
  }
  const f = fixture(new Map(), AndroidDate)
  assert.equal(f.crm.crmTime(''), '暂无')
  assert.equal(f.crm.crmTime('invalid'), '暂无')
  assert.equal(f.crm.crmTime('2026-11-11T06:32:30.123456Z'), '11-11 14:32')
})
test('CRM pending review stays distinct from effective and explains server reasons', async () => {
  const f = fixture()
  f.respond(() => ({ data: [{ id: '300', captureRef: 'capture', ownershipId: '200', salespersonId: '20', status: 'SUBMITTED', reviewReason: 'RECORDING_TOO_SHORT,AI_PENDING' }] }))
  const [record] = await f.crm.crmVisitRecords('100')
  assert.equal(f.requests[0].url, '/crm/stores/100/visits?view=MINE')
  assert.equal(record.captureId, 'capture')
  assert.equal(f.crm.crmVisitStatus(record.status), '已提交，待核验')
  assert.equal(f.crm.crmVisitReason(record.reviewReason), '录音时长不足；AI 核验待完成')
  assert.equal(f.crm.crmVisitStatus('EFFECTIVE'), '有效拜访')
  assert.equal(f.crm.crmVisitStatus('future-status'), '核验状态待刷新')
})
function visitHandler(url) {
  const data = url.includes('/context') ? { employeeId: '20' }
    : url === '/crm/stores/100' ? { id: '100', poolType: 'PRIVATE', currentOwnershipId: '200', ownerEmployeeId: '20' }
      : url.endsWith('/visits?view=MINE') ? []
        : url.includes('/work-days/') ? { id: 'day', status: 'ACTIVE' }
          : url.endsWith('/location/normalize') ? { longitude: 120.004, latitude: 30.002, coordinateSystem: 'GCJ02' }
            : { visitId: '300', captureId: 'capture' }
  // The store detail route carries the scope as a query string.
  if (url === '/crm/stores/100?view=MINE') return { data: { id: '100', poolType: 'PRIVATE', currentOwnershipId: '200', ownerEmployeeId: '20' } }
  return { data }
}
test('contact retries keep request id; successful later edits get a new id', async () => {
  const f = fixture(); let attempt = 0
  f.respond(() => { if (++attempt === 1) throw new Error('network'); return { data: { id: 'contact' } } })
  const body = object({ name: '前台', phone: '13800000001' })
  await assert.rejects(f.crm.crmMutation('/crm/stores/100/contacts', 'POST', body), /network/)
  await f.crm.crmMutation('/crm/stores/100/contacts', 'POST', body)
  await f.crm.crmMutation('/crm/stores/100/contacts', 'POST', body)
  assert.equal(f.requests[0].body.requestId, f.requests[1].body.requestId)
  assert.notEqual(f.requests[1].body.requestId, f.requests[2].body.requestId)
  assert.equal(body.requestId, undefined)
})
test('account change rejects delayed contact data', async () => {
  const f = fixture(); let finish
  f.respond(() => new Promise(resolve => { finish = resolve }))
  const pending = f.crm.crmContacts('100'); await Promise.resolve(); f.session.revision++
  finish({ data: [{ id: 'private-person' }] })
  await assert.rejects(pending, /账号已变更/)
})
test('native GPS must be normalized before being sent as visit evidence', async () => {
  const f = fixture(); f.respond(visitHandler)
  const result = await f.crm.crmLocation()
  assert.deepEqual(f.requests[0].body, { longitude: 120, latitude: 30, coordinateSystem: 'WGS84' })
  assert.deepEqual(plain(result), { longitude: 120.004, latitude: 30.002, accuracyMeters: 12, source: 'APP_NATIVE' })
  f.respond(() => ({ data: { longitude: 120, latitude: 30, coordinateSystem: 'WGS84' } }))
  await assert.rejects(f.crm.crmLocation(), /坐标转换/)
})
test('partially created CRM visit reuses the persisted whole command after restart', async () => {
  const storage = new Map(), first = fixture(storage)
  first.respond(url => { if (url === '/sales/work/store-visits') throw new Error('network'); return visitHandler(url) })
  await assert.rejects(first.crm.crmStartVisit('100'), /network/)
  const second = fixture(storage)
  second.respond(url => {
    if (url.endsWith('/visits?view=MINE')) return { data: [{ id: '300', ownershipId: '200', captureRef: 'capture' }] }
    if (url === '/sales/me/visits/capture') throw new Error(second.apiErrorMessage('SALES_VISIT_NOT_FOUND'))
    return visitHandler(url)
  })
  const result = await second.crm.crmStartVisit('100')
  assert.equal(result.captureId, 'capture')
  assert.deepEqual(first.requests.find(r => r.url === '/sales/work/store-visits').body, second.requests.find(r => r.url === '/sales/work/store-visits').body)
  assert.equal(second.locations.length, 0)
  assert.equal(storage.size, 0)
})
test('active capture resumes without collecting location or creating another visit', async () => {
  const f = fixture(); f.respond(url => {
    if (url.endsWith('/visits?view=MINE')) return { data: [{ id: '300', ownershipId: '200', captureRef: 'capture' }] }
    if (url === '/sales/me/visits/capture') return { data: { status: 'CHECKED_IN', resultSubmittedAt: '2026-11-11' } }
    return visitHandler(url)
  })
  assert.equal((await f.crm.crmStartVisit('100')).captureId, 'capture')
  assert.equal(f.locations.length, 0)
  assert.equal(f.requests.some(r => r.method === 'POST'), false)
})
test('resuming a capture after a lost response retires the old request before the next visit', async () => {
  const f = fixture(); f.respond(url => { if (url === '/sales/work/store-visits') throw new Error('network'); return visitHandler(url) })
  await assert.rejects(f.crm.crmStartVisit('100'), /network/)
  f.respond(url => {
    if (url.endsWith('/visits?view=MINE')) return { data: [{ id: '300', ownershipId: '200', captureRef: 'capture' }] }
    if (url === '/sales/me/visits/capture') return { data: { status: 'CHECKED_IN', workDayId: 'day' } }
    return visitHandler(url)
  })
  await f.crm.crmStartVisit('100'); assert.equal(f.storage.size, 0)
  f.respond(visitHandler); await f.crm.crmStartVisit('100')
  const writes = f.requests.filter(r => r.url === '/sales/work/store-visits')
  assert.notEqual(writes[0].body.requestId, writes[1].body.requestId)
})
test('missing original request for an orphan capture stops instead of creating a duplicate CRM visit', async () => {
  const f = fixture(); f.respond(url => {
    if (url.endsWith('/visits?view=MINE')) return { data: [{ id: '300', ownershipId: '200', captureRef: 'capture' }] }
    if (url === '/sales/me/visits/capture') throw new Error(f.apiErrorMessage('SALES_VISIT_NOT_FOUND'))
    return visitHandler(url)
  })
  await assert.rejects(f.crm.crmStartVisit('100'), /原设备重试/)
  assert.equal(f.requests.some(r => r.method === 'POST'), false)
})
test('lost ownership or denied history never creates a new capture', async () => {
  for (const denial of ['owner', 'history']) {
    const f = fixture(); f.respond(url => {
      if (denial === 'owner' && url === '/crm/stores/100?view=MINE') return { data: { poolType: 'PRIVATE', currentOwnershipId: '200', ownerEmployeeId: 'other' } }
      if (denial === 'history' && url.endsWith('/visits?view=MINE')) throw new Error('无权限')
      return visitHandler(url)
    })
    await assert.rejects(f.crm.crmStartVisit('100'), /不属于本人|无权限/)
    assert.equal(f.locations.length, 0)
    assert.equal(f.requests.some(r => r.method === 'POST'), false)
  }
})


function mediaFixture(storage = new Map()) {
  const uploads = [], commands = [], session = { authenticated: true, tenantId: 'tenant', userId: 'one', revision: 1, permissions: [] }
  let onChange, loadClips, uploadFails = false, locationFails = false, cameras = 0
  const intervals = new Map(), delayed = [], starts = []; let nextTimer = 0
  const clip = { id: 'clip-one', fileName: 'clip-one.aac', createdAt: 1000, savedAt: 62000, activeDurationEstimateMs: 61000, interrupted: false }
  let state = { phase: 'idle', message: '', activeDurationEstimateMs: 0, temporaryPath: '', savedPath: '' }
  const crm = {
    crmOwner: () => session.tenantId + ':' + session.userId + ':' + session.revision,
    crmId: () => 'photo-one',
    crmCall: async (url, method, body) => { commands.push({ url, method, body }); return object({ code: 'OK' }) },
    crmLocation: async () => { if (locationFails) throw new Error('坐标转换失败'); return object({ longitude: 120, latitude: 30, accuracyMeters: 10 }) },
  }
  const modules = {
    vue: { reactive: v => v, watch: () => {} }, './customer-cache.uts': { refreshCustomerSnapshot: (_path, load) => load(), invalidateCustomerCache: () => {}, readCustomerSnapshot: () => null },
    './session.uts': { session }, './crm.uts': crm,
    './auth.uts': { ensureAccessToken: (_retry, success) => success('test-token') },
    './config.uts': { appEnvironment: { gatewayOrigin: 'https://dev.invalid' } },
    './json.uts': { parseApiJson: s => object(JSON.parse(s)) },
    './visit-policy.uts': { visitCaptureRules: async () => ({ maximumLocationAccuracyMeters: 100, allowPhotoImport: false, allowRecordingImport: false }) },
    './capture.uts': {
      savedClipPath: c => '/files/' + c.fileName,
      loadSavedClips: success => { loadClips = success },
      createCaptureSession: (callback, binding, maximumDuration) => { onChange = callback; starts.push({ binding, maximumDuration }); return {
        start: () => { state = { ...state, phase: 'recording' }; callback(state) },
        snapshot: () => state, stop: () => {}, retrySave: () => {}, dispose: () => {},
      } },
    },
  }
  const source = fs.readFileSync(path.join(__dirname, '../app/services/crm-media.uts'), 'utf8')
    .replace(/\/\/ #ifndef APP[\s\S]*?\/\/ #endif/g, '')
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const ctx = { exports: {}, require: name => modules[name], Error, setInterval: (fn, delay) => { const id = ++nextTimer; intervals.set(id, { fn, delay }); return id }, clearInterval: id => intervals.delete(id), setTimeout: fn => delayed.push(fn), uni: {
    env: { USER_DATA_PATH: '/files' }, getStorageSync: key => storage.get(key) ?? '', getStorageInfoSync: () => ({ keys: [...storage.keys()] }), setStorageSync: (key, value) => storage.set(key, value), removeStorageSync: key => storage.delete(key),
    chooseImage: request => { cameras++; assert.deepEqual(plain(request.sourceType), ['camera']); request.fail({}) },
    uploadFile: request => { uploads.push(request); if (uploadFails) request.fail({}); else request.success({ statusCode: 200, data: '{"code":"OK"}' }) },
  } }
  vm.runInNewContext(compiled, ctx)
  return { media: ctx.exports, storage, uploads, commands, session, clip, starts, delayed, tick: () => { for (const { fn, delay } of [...intervals.values()]) if (delay === 100) fn() },
    failedUpload: value => { uploadFails = value }, failedLocation: () => { locationFails = true }, cameras: () => cameras,
    saveRecording: () => { state = { ...state, phase: 'saved', savedPath: '/files/clip-one.aac' }; onChange(state) },
    finishIndex: clips => loadClips(clips),
  }
}
test('recording completed after an account switch stays with its original owner', () => {
  const f = mediaFixture(); f.media.crmStartRecording('capture'); f.media.crmStopRecording(); f.media.crmRecorder.phase = 'saved'; f.saveRecording()
  f.session.userId = 'two'; f.session.revision++; f.finishIndex([f.clip])
  assert.equal(f.media.crmMedia('capture').recordings.length, 0)
  f.session.userId = 'one'; assert.equal(f.media.crmMedia('capture').recordings[0].clip.id, 'clip-one')
  assert.equal(f.media.crmRecorder.mediaRevision, 1)
})
test('failed recording association blocks new recordings and preserves the saved file for retry', () => {
  const f = mediaFixture(); f.media.crmStartRecording('capture'); f.saveRecording(); f.finishIndex([])
  assert.throws(() => f.media.crmStartRecording('next-capture'), /上一段录音尚未关联/)
  f.media.crmRetryRecording(); f.finishIndex([f.clip]); assert.equal(f.media.crmMedia('capture').recordings.length, 1)
})
test('audio upload retry keeps the clip id and local original; short audio sends metadata only', async () => {
  const f = mediaFixture(); f.failedUpload(true); f.media.crmStartRecording('capture'); f.saveRecording(); f.finishIndex([f.clip])
  await assert.rejects(f.media.crmUpload('capture', 30), /本机文件已保留/)
  assert.equal(f.media.crmMedia('capture').recordings[0].uploaded, false)
  f.failedUpload(false); await f.media.crmUpload('capture', 30)
  assert.equal(f.uploads[0].formData.clientClipId, f.uploads[1].formData.clientClipId)
  assert.equal(f.media.crmMedia('capture').recordings[0].clip.fileName, 'clip-one.aac')
  const short = mediaFixture(); short.media.crmStartRecording('capture'); short.saveRecording(); short.finishIndex([{ ...short.clip, activeDurationEstimateMs: 5000 }]); await short.media.crmUpload('capture', 30)
  assert.equal(short.uploads.length, 0); assert.equal(short.commands[0].body.reason, 'TOO_SHORT')
  assert.equal(short.media.crmMedia('capture').recordings.length, 1)
})
test('failed coordinate normalization stops before camera acquisition', async () => {
  const f = mediaFixture(); f.failedLocation()
  await assert.rejects(f.media.crmTakePhoto('capture'), /坐标转换失败/)
  assert.equal(f.cameras(), 0); assert.equal(f.storage.size, 0)
})

test('definite outside-radius rejection takes fresh GPS on retry while unknown failures retain the command', async () => {
  const f = fixture(); let failed = true
  f.respond(url => { if (url === '/sales/work/store-visits' && failed) throw new Error(f.apiErrorMessage('CRM_STORE_VISIT_OUTSIDE_RADIUS')); return visitHandler(url) })
  await assert.rejects(f.crm.crmStartVisit('100'), /CRM_STORE_VISIT_OUTSIDE_RADIUS/)
  assert.equal(f.storage.size, 0)
  failed = false
  await f.crm.crmStartVisit('100')
  assert.equal(f.locations.length, 2)
  const writes = f.requests.filter(r => r.url === '/sales/work/store-visits')
  assert.notEqual(writes[0].body.requestId, writes[1].body.requestId)
})


function accountPageFixture() {
  let oldRecording = false, crmRecording = false, logoutCount = 0
  const toasts = []
  const source = fs.readFileSync(path.join(__dirname, '../app/pages/work/work.uvue'), 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const code = ts.transpileModule(source + '\nexports.logout = logout;', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const modules = {
    '../../services/session.uts': { session: { authenticated: true } },
    '../../services/auth.uts': { logoutCompany: () => logoutCount++ },
    '../../services/visits.uts': { hasActiveVisitRecording: () => oldRecording, loadLocalVisits: () => {} },
    '../../services/crm-media.uts': { crmRecording: () => crmRecording },
    '../../services/commerce.uts': { loadDrafts: () => {} },
    '../../services/sales-profile.uts': {},
  }
  const ctx = { exports: {}, require: name => modules[name], ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }), onLoad: () => {}, onShow: () => {}, uni: { showToast: value => toasts.push(value.title) } }
  vm.runInNewContext(code, ctx)
  return { page: ctx.exports, toasts, logoutCount: () => logoutCount, recording: (old, crm) => { oldRecording = old; crmRecording = crm } }
}
test('account logout preserves unsaved recordings in both visit flows', () => {
  const f = accountPageFixture()
  for (const recording of [[true, false], [false, true]]) {
    f.recording(...recording); f.page.logout(); assert.equal(f.logoutCount(), 0)
  }
  assert.equal(f.toasts.length, 2)
  f.recording(false, false); f.page.logout(); assert.equal(f.logoutCount(), 1)
})
test('photo capture opens only the camera and cancellation leaves no evidence', async () => {
  const f = mediaFixture()
  await assert.rejects(f.media.crmTakePhoto('capture'), /拍照未完成/)
  assert.equal(f.cameras(), 1); assert.equal(f.uploads.length, 0)
  assert.equal(f.media.crmMedia('capture').photos.length, 0)
})
test('saving a recording starts automatic upload with explicit native source', async () => {
  const f = mediaFixture(); f.media.crmStartRecording('capture'); f.saveRecording(); f.finishIndex([f.clip])
  await f.media.crmUpload('capture')
  assert.equal(f.uploads.length, 1); assert.equal(f.uploads[0].formData.captureSource, 'APP_RECORDER')
  assert.equal(f.uploads[0].formData.durationMs, undefined)
  assert.equal(f.uploads[0].formData.recordedFrom, new Date(f.clip.createdAt).toISOString())
  assert.equal(f.uploads[0].formData.recordedTo, new Date(f.clip.savedAt).toISOString())
  assert.equal(f.media.crmMedia('capture').recordings[0].uploaded, true)
  assert.equal(f.media.crmMedia('capture').recordings[0].clip.fileName, f.clip.fileName)
})

test('persistent upload queue survives a process restart and stays isolated to its owner', async () => {
  const first = mediaFixture(); first.failedUpload(true); first.media.crmStartRecording('capture'); first.saveRecording(); first.finishIndex([first.clip])
  await first.media.crmUpload('capture').catch(() => {}); await new Promise(setImmediate)
  const second = mediaFixture(first.storage); second.session.userId = 'two'; await second.media.crmRunUploadQueue()
  assert.equal(second.uploads.length, 0)
  second.session.userId = 'one'; await second.media.crmRunUploadQueue()
  assert.equal(second.uploads.length, 1); assert.equal(second.uploads[0].formData.clientClipId, first.clip.id)
  assert.equal(second.media.crmMedia('capture').recordings[0].uploaded, true)
})
test('Android storage type metadata never prevents recovery of later pending visit materials', async () => {
  const prefix = 'rigour.crm.media.v1.tenant%3Aone.'
  const storage = new Map([
    [prefix + 'old', JSON.stringify({ photos: [], recordings: [] })],
    [prefix + 'old__TYPE', 'string'],
    [prefix + 'pending', JSON.stringify({ photos: [{ id: 'photo', fileName: 'photo.jpg', capturedAt: '', longitude: 120, latitude: 30, accuracyMeters: 10, uploaded: false }], recordings: [] })],
    [prefix + 'pending__TYPE', 'string'],
  ])
  const f = mediaFixture(storage); f.media.resumeCrmUploadQueue(); f.finishIndex([])
  await new Promise(setImmediate)
  assert.equal(f.uploads.length, 1)
  assert.equal(f.uploads[0].formData.clientEvidenceId, 'photo')
  assert.equal(f.media.crmMedia('pending').photos[0].uploaded, true)
  assert.equal(storage.get(prefix + 'pending__TYPE'), 'string')
  assert.equal(storage.has(prefix + 'old'), true)
})
test('automatic recorder uses bounded segments and completion waits for durable association', async () => {
  const f = mediaFixture(); f.media.crmStartRecording('capture', true)
  assert.equal(f.starts[0].maximumDuration, 300000)
  assert.deepEqual(plain(f.starts[0].binding), { owner: 'tenant:one', captureId: 'capture' })
  let completed = false; const finishing = f.media.crmFinishRecording('capture').then(() => { completed = true })
  f.saveRecording(); f.tick(); await Promise.resolve(); assert.equal(completed, false)
  f.finishIndex([f.clip]); f.tick(); await finishing
  assert.equal(completed, true); assert.equal(f.delayed.length, 0)
  assert.equal(f.media.crmEndingVisit('capture'), true)
  assert.equal(f.media.crmMedia('capture').recordings.length, 1)
})
test('customer addresses preserve province city county without duplicate prefixes', () => {
 const {crm} = fixture()
 assert.equal(crm.crmDisplayAddress(object({provinceName:'四川省',cityName:'成都市',countyName:'武侯区',address:'人民南路12号'})), '四川省 · 成都市 · 武侯区 · 人民南路12号')
 assert.equal(crm.crmDisplayAddress(object({provinceName:'四川省',cityName:'成都市',countyName:'武侯区',address:'四川省成都市武侯区人民南路12号'})), '四川省 · 成都市 · 武侯区 · 人民南路12号')
 assert.equal(crm.crmDisplayAddress(object({provinceName:'北京市',cityName:'北京市',countyName:'朝阳区',address:'测试路1号'})), '北京市 · 朝阳区 · 测试路1号')
 assert.equal(crm.crmDisplayAddress(object({address:'待核实地址'})), '待核实地址')
})
test('public region options come only from the authorized context and preserve hierarchy', async () => {
 const f=fixture();f.respond(() => ({data:{areas:[{code:'510000',name:'四川省',level:'PROVINCE',parentCode:null},{code:'510100',name:'成都市',level:'PREFECTURE',parentCode:'510000'},{code:'510107',name:'武侯区',level:'COUNTY',parentCode:'510100'}]}}))
 const areas=await f.crm.crmPublicAreas();assert.equal(f.requests[0].url,'/crm/stores/context?view=PUBLIC')
 assert.deepEqual(plain(f.crm.crmAreaChildren(areas,'COUNTY','510100')).map(a=>a.code),['510107'])
 assert.equal(f.crm.crmAreaChildren(areas,'COUNTY','330100').length,0)
})
test('public pagination and count use the same server-side region filters', async () => {
 const f=fixture();f.respond(() => ({data:{total:42,items:[],nextCursor:'81'}}))
 const result=await f.crm.crmList('PUBLIC','&keyword','95','&province=510000&city=510100&county=510107')
 const url=new URL('https://test'+f.requests[0].url)
 assert.equal(url.searchParams.get('view'),'PUBLIC');assert.equal(url.searchParams.get('city'),'510100');assert.equal(url.searchParams.get('county'),'510107');assert.equal(url.searchParams.get('cursor'),'95');assert.equal(url.searchParams.get('keyword'),'&keyword');assert.equal(result.total,42)
})

test('recent same-account normalized location avoids a second GPS request but server still receives visit command',async()=>{
 const f=fixture();f.respond(visitHandler)
 const point={owner:f.crm.crmOwner(),requestedAt:Date.now()-5000,receivedAt:Date.now()-2000,location:object({longitude:120.004,latitude:30.002,accuracyMeters:12,source:'APP_NATIVE'})}
 const stages=[];await f.crm.crmStartVisit('100',100,point,s=>stages.push(s))
 assert.equal(f.locations.length,0);assert.equal(f.requests.some(r=>r.url.endsWith('/location/normalize')),false)
 assert.deepEqual(f.requests.find(r=>r.url==='/sales/work/store-visits').body.location,plain(point.location))
 assert.ok(stages.includes('核对拜访…'));assert.ok(stages.includes('正在进入…'))
})
test('stale, clock-invalid, inaccurate or foreign-account prepared locations cannot be reused',async()=>{
 const f=fixture();const now=Date.now(),base={owner:f.crm.crmOwner(),requestedAt:now-5000,receivedAt:now-2000,location:object({longitude:120.004,latitude:30.002,accuracyMeters:12,source:'APP_NATIVE'})}
 for(const bad of [{...base,owner:'other'},{...base,requestedAt:now-31000},{...base,receivedAt:now+60000},{...base,requestedAt:NaN},{...base,location:object({longitude:120,latitude:30,accuracyMeters:200,source:'APP_NATIVE'})}]) assert.equal(f.crm.crmRecentVisitLocation(bad,100),null)
 f.respond(visitHandler);await f.crm.crmStartVisit('100',100,{...base,requestedAt:now-31000});assert.equal(f.locations.length,1)
})
test('visit preparation fetches independent context in parallel and stops before any write after cancellation',async()=>{
 const f=fixture();let current=true;const finish=[]
 f.respond(url=>new Promise(resolve=>finish.push(()=>resolve(visitHandler(url)))))
 const pending=f.crm.crmStartVisit('100',100,null,null,()=>current);await new Promise(setImmediate)
 assert.equal(finish.length,3);current=false;finish.forEach(resolve=>resolve())
 await assert.rejects(pending,/作业已取消/);assert.equal(f.locations.length,0);assert.equal(f.requests.some(r=>r.method==='POST'),false)
})
