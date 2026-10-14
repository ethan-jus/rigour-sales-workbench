// Executes the real visits service after TypeScript syntax transpilation, with
// mocked uni storage, capture/location callbacks and Vue owner-change delivery.
// This is not a UTS native build or a microphone/filesystem/background test.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const compiler = require('vue/compiler-sfc')
const appRoot = path.resolve(__dirname, '../app')

function transpile(source) {
  const output = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  assert.deepEqual(output.diagnostics, [], 'TypeScript-compatible syntax diagnostics')
  return output.outputText
}

function appBranch(source) {
  const enabled = [true]
  return source.split('\n').filter((line) => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef) APP$/)
    if (directive) { enabled.push(enabled.at(-1) && directive[1] === 'ifdef'); return false }
    if (/^\s*\/\/ #endif$/.test(line)) { enabled.pop(); return false }
    return enabled.at(-1)
  }).join('\n')
}
const serviceCode = transpile(appBranch(fs.readFileSync(path.join(appRoot, 'services/visits.uts'), 'utf8')))
const target = { projectionId: 'projection-1', storeId: 'store-1', customerId: 'customer-1', storeName: 'Test store', customerName: 'Test customer', address: 'Test address' }
const clip = { id: 'clip-1', fileName: 'clip-1.aac', createdAt: 1, savedAt: 2, activeDurationEstimateMs: 20000, interrupted: false }

function harness(storage = new Map()) {
  const session = { revision: 0, authenticated: true, tenantId: 'tenant-1', username: 'sales-a', userId: 'user-sales-a', permissions: ['sales:visit:own:write', 'sales:visit:own:read'] }
  let ownerWatcher, captureCallback, locationCallback, imageCallback
  let now = 100000, failStorage = false, captureCreates = 0, stopCount = 0
  let snapshot = { phase: 'idle', message: '', activeDurationEstimateMs: 0, temporaryPath: '', savedPath: '' }
  const network = [], copies = []
  const capture = {
    start() { snapshot = { ...snapshot, phase: 'recording' }; captureCallback(snapshot) },
    stop() { stopCount += 1; snapshot = { ...snapshot, phase: 'stopping' }; captureCallback(snapshot) },
    pause() { snapshot = { ...snapshot, phase: 'paused' }; captureCallback(snapshot) },
    resume() { snapshot = { ...snapshot, phase: 'recording' }; captureCallback(snapshot) },
    retrySave() {}, snapshot() { return snapshot },
  }
  const mockUni = {
    env: { USER_DATA_PATH: '/mock-sandbox' },
    setStorageSync(key, value) { if (failStorage) throw new Error('quota exceeded'); storage.set(key, value) },
    getStorageSync: key => storage.get(key),
    chooseImage(options) { imageCallback = options.success },
    getFileSystemManager() {
      return { access: options => options.success({}), copyFile: options => copies.push(options) }
    },
  }
  const dependencies = {
    vue: { reactive: value => value, watch: (_getter, callback) => { ownerWatcher = callback } },
    './session.uts': { session, hasPermission: value => session.authenticated && session.permissions.includes(value) },
    './api.uts': { requestApi: (...args) => network.push(args) },
    './capture.uts': {
      createCaptureSession: callback => { captureCreates += 1; captureCallback = callback; return capture },
      loadSavedClips: callback => callback([clip]), savedClipPath: value => '/saved/' + value.fileName,
    },
    './location.uts': { requestDeviceLocation: callback => { locationCallback = callback } },
  }
  class Clock extends Date { static now() { return now++ } }
  const module = { exports: {} }
  new Function('exports', 'module', 'require', 'uni', 'Date', 'setInterval', 'clearInterval', serviceCode)(
    module.exports, module, name => {
      assert.ok(dependencies[name], 'Only explicitly mocked imports are allowed: ' + name)
      return dependencies[name]
    }, mockUni, Clock, () => 1, () => {},
  )
  return {
    service: module.exports, session, storage, network, copies,
    setStorageFailure: value => { failStorage = value },
    captureCreates: () => captureCreates, stopCount: () => stopCount,
    saved() { snapshot = { ...snapshot, phase: 'saved', savedPath: '/saved/clip-1.aac' }; captureCallback(snapshot) },
    location(longitude = 116) { locationCallback({ longitude, latitude: 39, accuracy: 12, coordinateSystem: 'WGS84', requestedAt: 1, receivedAt: 2 }) },
    choosePhoto() { imageCallback({ tempFilePaths: ['/camera/photo.jpg'] }) },
    switchOwner(username, userId = 'user-' + username) {
      const previous = session.authenticated ? session.tenantId + ':' + session.userId : ''
      session.revision += 1
      session.authenticated = username.length > 0
      session.username = username
      session.userId = username.length > 0 ? userId : ''
      session.tenantId = username.length > 0 ? 'tenant-1' : ''
      const next = session.authenticated ? session.tenantId + ':' + session.userId : ''
      // Delivers the state change to the real registered callback; Vue scheduling is not under test.
      ownerWatcher(next, previous)
    },
  }
}

for (const relative of ['pages/visits/visits.uvue', 'pages/visit/visit.uvue']) {
  test(relative + ': SFC/template/script syntax only', () => {
    const parsed = compiler.parse(fs.readFileSync(path.join(appRoot, relative), 'utf8'))
    assert.deepEqual(parsed.errors, [])
    const template = compiler.compileTemplate({ source: parsed.descriptor.template.content, filename: relative, id: 'visits-check', compilerOptions: { expressionPlugins: ['typescript'] } })
    assert.deepEqual(template.errors, [])
    transpile(parsed.descriptor.scriptSetup.content)
  })
}

test('draft content survives a new service instance through storage', () => {
  const first = harness()
  first.service.loadLocalVisits()
  const id = first.service.createVisitDraft(target)
  first.service.updateVisitText('店长', '下周继续跟进')
  const restored = harness(first.storage)
  restored.service.loadLocalVisits()
  assert.equal(restored.service.activeVisitDraft().id, id)
  assert.equal(restored.service.activeVisitDraft().note, '下周继续跟进')
  assert.equal(restored.service.activeVisitDraft().contact, '店长')
})

test('unauthenticated or unauthorized sessions cannot create a draft', () => {
  const h = harness()
  h.session.permissions = []
  assert.equal(h.service.createVisitDraft(target), '')
  assert.equal(h.storage.size, 0)
  h.switchOwner('')
  assert.equal(h.service.createVisitDraft(target), '')
  assert.equal(h.service.visitDraftCount(), 0)
})

test('select-page location never overwrites an existing draft; draft refresh targets the captured draft', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); const first = v.createVisitDraft(target)
  v.locateForVisit(false); h.location()
  assert.equal(v.activeVisitDraft().location, null)
  v.locateForVisit(true)
  const second = v.createVisitDraft({ ...target, storeId: 'store-2' })
  h.location(117)
  assert.notEqual(first, second)
  assert.equal(v.visitState.drafts.find(item => item.id === first).location.longitude, 117)
  assert.equal(v.visitState.drafts.find(item => item.id === second).location.longitude, 116, 'new draft must not receive an earlier draft refresh')
  assert.equal(v.visitState.activeId, second)
})

test('one service capture session owns a recording and blocks a second draft until saved', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); v.createVisitDraft(target); v.startVisitRecording()
  assert.equal(v.hasActiveVisitRecording(), true)
  assert.equal(v.createVisitDraft(target), '')
  v.pauseVisitRecording(); assert.equal(v.visitState.capture.phase, 'paused')
  v.resumeVisitRecording(); assert.equal(v.visitState.capture.phase, 'recording')
  v.stopVisitRecording(); assert.equal(h.stopCount(), 1)
  h.saved(); assert.equal(v.activeVisitDraft().clips.length, 1)
  h.saved(); assert.equal(v.activeVisitDraft().clips.length, 1, 'duplicate save delivery must not duplicate a clip')
  v.startVisitRecording(); assert.equal(h.captureCreates(), 1, 'the same service owns the recorder')
})

test('expiry stops old recording; late file receipt belongs to old owner after another login', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); const original = v.createVisitDraft(target); v.startVisitRecording()
  h.switchOwner('')
  assert.equal(h.stopCount(), 1)
  assert.equal(v.visitDraftCount(), 0)
  h.switchOwner('sales-b')
  assert.equal(v.visitDraftCount(), 0)
  h.saved()
  assert.equal(v.visitDraftCount(), 0, 'no old account draft leaks into the current account')
  h.switchOwner('sales-a')
  assert.equal(v.activeVisitDraft().id, original)
  assert.equal(v.activeVisitDraft().clips.length, 1)
  assert.equal(v.activeVisitDraft().clips[0].id, clip.id)
})

test('photo metadata is added only after the native file copy succeeds', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); v.createVisitDraft(target); v.addVisitPhotos(true); h.choosePhoto()
  assert.equal(v.activeVisitDraft().photos.length, 0)
  assert.equal(h.copies.length, 1)
  assert.equal(h.copies[0].srcPath, '/camera/photo.jpg')
  assert.ok(h.copies[0].destPath.startsWith('/mock-sandbox/rigour-visit-photos/'))
  h.copies[0].success({})
  assert.equal(v.activeVisitDraft().photos.length, 1)
  assert.equal(v.activeVisitDraft().photos[0].fileName.includes('/'), false, 'stored reference must not pin an iOS sandbox prefix')
  v.removeVisitPhoto(0)
  assert.equal(v.activeVisitDraft().photos.length, 0)
})

test('storage failure returns false and retains unsaved content in memory', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); v.createVisitDraft(target); h.setStorageFailure(true)
  v.updateVisitText('店长', '不可丢失的草稿')
  assert.equal(v.saveLocalVisits(), false)
  assert.equal(v.visitState.storageHealthy, false)
  assert.equal(v.activeVisitDraft().note, '不可丢失的草稿')
  assert.match(v.visitState.notice, /保存失败/)
})

test('read API preserves permissions and rejects an absent data envelope', () => {
  const h = harness(), v = h.service
  let failure = '', response = null
  v.getVisitData('/sales/me/visits', 'sales:visit:own:read', data => { response = data }, message => { failure = message })
  assert.equal(h.network.length, 1)
  assert.equal(h.network[0][0], '/sales/me/visits')
  assert.equal(h.network[0][1], 'GET')
  h.network[0][3]({ data: { items: [], total: 0 } })
  assert.deepEqual(response, { items: [], total: 0 })
  h.network[0][3]({})
  assert.match(failure, /有效数据/)
  h.session.permissions = []
  v.getVisitData('/sales/me/visits', 'sales:visit:own:read', () => assert.fail('unauthorized success'), message => { failure = message })
  assert.equal(h.network.length, 1, 'permission failure must not dispatch another request')
  assert.match(failure, /权限/)
})

test('stable user ID survives account rename and prevents reused names from inheriting drafts', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); const original = v.createVisitDraft(target)
  h.switchOwner('renamed-sales', 'user-sales-a')
  assert.equal(v.activeVisitDraft().id, original, 'renaming the same IAM user preserves its draft')
  h.switchOwner('sales-a', 'different-user')
  assert.equal(v.visitDraftCount(), 0, 'reusing a login name does not inherit the original IAM user draft')
  h.switchOwner('sales-a', 'user-sales-a')
  assert.equal(v.activeVisitDraft().id, original)
})

test('failed initial save keeps the new draft editable and explicitly marks it as unsaved', () => {
  const h = harness(), v = h.service
  v.loadLocalVisits(); h.setStorageFailure(true)
  const id = v.createVisitDraft(target)
  assert.ok(id)
  assert.equal(v.activeVisitDraft().id, id)
  assert.equal(v.visitState.storageHealthy, false)
  assert.equal(h.storage.size, 0)
  assert.match(v.visitState.notice, /尚未保存到本机/)
  v.updateVisitText('店长', '仍可继续填写')
  assert.equal(v.activeVisitDraft().note, '仍可继续填写')
  h.setStorageFailure(false)
  assert.equal(v.saveLocalVisits(), true)
  assert.equal(v.visitState.storageHealthy, true)
})

test('visit navigation reuses an exact view/id entry and never reuses another draft page', () => {
  const file = path.join(appRoot, 'pages/visit/visit.uvue')
  const script = compiler.parse(fs.readFileSync(file, 'utf8')).descriptor.scriptSetup.content
  const ast = ts.createSourceFile('visit.ts', script, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name.text === 'openView')
  assert.ok(node)
  const page = (view, id = '') => ({ route: 'pages/visit/visit', options: { getString: field => ({ view, id })[field] } })
  const pages = [{ route: 'pages/home/home' }, page('select'), page('active', 'draft-a'), page('evidence', 'draft-a'), page('uploads')]
  const calls = []
  const navigate = new Function('getCurrentPages', 'uni', 'view', 'recordId', transpile(node.getText(ast)) + '\nreturn openView;')(
    () => pages,
    { navigateBack: options => calls.push(['back', options.delta]), navigateTo: options => calls.push(['to', options.url]) },
    { value: 'uploads' }, { value: '' },
  )
  navigate('active', 'draft-a')
  assert.deepEqual(calls.pop(), ['back', 2])
  navigate('active', 'draft-b')
  assert.deepEqual(calls.pop(), ['to', '/pages/visit/visit?view=active&id=draft-b'])
  navigate('uploads')
  assert.equal(calls.length, 0, 'clicking the current destination does not add another page')
})


// Executes real page setup/lifecycle and read callbacks against the same mocked
// uni/HTTP service. DOM rendering, native widgets and a live backend are not under test.
function jsonObject(value) {
  const object = Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    Array.isArray(item) ? item.map(row => row != null && typeof row === 'object' ? jsonObject(row) : row)
      : item != null && typeof item === 'object' ? jsonObject(item) : item]))
  Object.defineProperties(object, {
    getString: { value: key => typeof object[key] === 'string' ? object[key] : null },
    getNumber: { value: key => typeof object[key] === 'number' ? object[key] : null },
  })
  return object
}
function pageHarness(h, relative) {
  const script = compiler.parse(fs.readFileSync(path.join(appRoot, relative), 'utf8')).descriptor.scriptSetup.content
  const hooks = {}, watchers = []
  const dependencies = {
    '../../services/session.uts': { session: h.session, hasPermission: permission => h.session.authenticated && h.session.permissions.includes(permission) },
    '../../services/visits.uts': h.service,
    '../../services/capture.uts': { savedClipPath: value => '/saved/' + value.fileName },
  }
  const visit = relative.includes('/visit/')
  const exposed = visit ? 'targets, targetsLoaded, plans, plansLoaded, remote, error, loading, reload, loadTargets, planLabel'
    : 'records, loaded, error, loading, total, loadRecords'
  const setup = new Function('exports', 'require', 'ref', 'computed', 'watch', 'onLoad', 'onShow', 'onHide', 'onUnload', 'uni',
    transpile(appBranch(script)) + '\nreturn { ' + exposed + ' };')
  const state = setup({}, name => { assert.ok(dependencies[name], name); return dependencies[name] }, value => ({ value }), getter => ({ get value() { return getter() } }),
    (getter, callback) => { watchers.push({ getter, callback }) },
    callback => { hooks.load = callback }, callback => { hooks.show = callback }, callback => { hooks.hide = callback }, callback => { hooks.unload = callback },
    {})
  return { ...state, hooks, changed: () => watchers.forEach(item => item.callback(item.getter())) }
}

test('read callbacks from an earlier login or revoked permission cannot repopulate the current session', () => {
  const h = harness(), v = h.service
  let deliveries = 0
  const request = () => v.getVisitData('/sales/me/visits', 'sales:visit:own:read', () => deliveries++, () => deliveries++)
  request(); h.session.revision++
  h.network[0][3]({ data: { items: [] } }); h.network[0][4]('Old response')
  assert.equal(deliveries, 0)
  request(); h.session.permissions = []
  h.network[1][3]({ data: { items: [] } }); h.network[1][4]('Old failure')
  assert.equal(deliveries, 0)
})

test('formal Sales DTO retains UUIDs and uses the submitted store snapshot and Beijing time', () => {
  const h = harness()
  const storeId = '019fb000-0000-7000-8000-000000000101'
  const customerId = '019fb000-0000-7000-8000-000000000102'
  const parsed = h.service.parseVisitTarget(jsonObject({ projectionId: storeId, storeId, customerId, storeName: '正式门店', storeAddress: '正式地址' }))
  assert.equal(parsed.storeId, storeId); assert.equal(parsed.customerId, customerId)
  const record = h.service.parseVisitItem(jsonObject({ id: storeId, checkedInAt: '2026-10-14T02:30:00Z', status: 'CHECKED_IN', targetSnapshot: { storeName: '拜访时门店', storeAddress: '拜访时地址' } }))
  assert.equal(record.storeName, '拜访时门店'); assert.equal(record.time, '2026-10-14 10:30')
})

test('returning from login loads real target data; logout clears cached data without a temporary-system fallback', () => {
  const h = harness(); h.switchOwner('')
  const page = pageHarness(h, 'pages/visit/visit.uvue')
  page.hooks.load({ view: 'select' }); page.hooks.show()
  assert.equal(h.network.length, 0); assert.equal(page.targetsLoaded.value, false)
  page.hooks.hide(); h.switchOwner('sales-a'); h.session.permissions.push('sales:visit-target:read'); page.changed(); page.hooks.show()
  assert.equal(h.network.length, 1); assert.match(h.network[0][0], /^\/sales\/me\/visit-targets\?/)
  h.network[0][3]({ data: jsonObject({ items: [{ projectionId: 'p', storeId: 's', customerId: 'c', storeName: '本人门店' }], total: 1 }) })
  assert.equal(page.targets.value[0].storeName, '本人门店')
  h.switchOwner(''); page.changed()
  assert.equal(page.targets.value.length, 0); assert.equal(page.targetsLoaded.value, false)
  assert.equal(h.network.length, 1, 'no temporary-system request may occur')
})

test('plans distinguish malformed payload, official setup failure and a valid empty list', () => {
  const h = harness(); h.session.permissions.push('sales:visit-plan:own:read')
  const page = pageHarness(h, 'pages/visit/visit.uvue')
  page.hooks.load({ view: 'plan' }); page.hooks.show()
  h.network[0][3]({ data: jsonObject({ date: '2026-10-14' }) })
  assert.match(page.error.value, /格式异常/); assert.equal(page.plansLoaded.value, false)
  page.reload(); h.network[1][4]('销售身份尚未完成绑定（SALES_IDENTITY_UNBOUND）')
  assert.match(page.error.value, /身份尚未完成绑定/); assert.equal(page.plansLoaded.value, false)
  page.reload(); h.network[2][3]({ data: jsonObject({ date: '2026-10-14', items: [] }) })
  assert.equal(page.error.value, ''); assert.equal(page.plansLoaded.value, true)
  assert.equal(page.planLabel('CANCELLED'), '已取消')
})

test('records refresh supersedes pending results, and an account change clears old records while hidden', () => {
  const h = harness(), page = pageHarness(h, 'pages/visits/visits.uvue')
  page.hooks.show(); page.loadRecords(true)
  h.network[1][3]({ data: jsonObject({ items: [{ id: 'new', checkedInAt: '2026-10-14T02:30:00Z', targetSnapshot: { storeName: '新记录' } }], total: 1 }) })
  h.network[0][3]({ data: jsonObject({ items: [{ id: 'old' }], total: 1 }) })
  assert.equal(page.records.value.length, 1); assert.equal(page.records.value[0].id, 'new')
  page.hooks.hide(); h.switchOwner('sales-b'); page.changed()
  assert.equal(page.records.value.length, 0); assert.equal(page.loaded.value, false); assert.equal(page.total.value, 0)
  assert.equal(h.network.length, 2, 'hidden page must not fetch another user until shown')
  page.hooks.show(); assert.equal(h.network.length, 3)
})
