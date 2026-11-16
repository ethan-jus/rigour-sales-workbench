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
function parse(data) {
  const modules = { './crm.uts': {}, './attendance.uts': { attendanceClock: value => value.substring(11, 16) } }
  const context = { exports: {}, require: name => modules[name] }
  vm.createContext(context)
  vm.runInContext(ts.transpileModule(fs.readFileSync('app/services/fieldwork.uts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  return context.exports.parseFieldTrack(object(data))
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
  assert.equal(result.distance, '1.3 km')
})
test('map marker IDs still address the sorted timeline including unlocated gaps', () => {
  const result = parse({
    punches: [
      { eventType: 'CHECK_OUT', clientOccurredAt: '2026-11-13T18:00:00', latitude: 39.1, longitude: 116.1 },
      { eventType: 'CHECK_IN', clientOccurredAt: '2026-11-13T08:00:00', latitude: 39, longitude: 116 },
    ],
    visits: [{ visitId: 'visit-1', storeName: '验收门店', checkedInAt: '2026-11-13T10:00:00', latitude: 39.01, longitude: 116.01 }],
    gaps: [{ from: '2026-11-13T09:00:00', to: '2026-11-13T09:30:00' }],
    distanceAvailable: false, totalDistanceMeters: 0,
  })
  assert.equal(result.distance, '无法计算')
  assert.deepEqual(Array.from(result.markers, marker => marker.id), [1, 3, 4])
  for (const marker of result.markers) {
    assert.ok(marker.title.includes(result.events[marker.id - 1].title))
    const icon = fs.readFileSync('app' + marker.iconPath)
    assert.equal(icon.subarray(1, 4).toString(), 'PNG')
  }
})

function pageFixture(t) {
  const session = reactive({ authenticated: true, tenantId: 'tenant', userId: 'sales', permissions: [] })
  const hooks = {}, calls = [], navigations = [], scope = effectScope()
  t.after(() => scope.stop())
  const owner = () => session.authenticated ? session.userId + ':' + session.permissions.join(',') : ''
  const modules = {
    '../../services/session.uts': { session, requireSession: () => session.authenticated, hasPermission: p => session.permissions.includes(p) },
    '../../services/config.uts': { appEnvironment: { environment: 'dev', gatewayOrigin: 'gateway' } },
    '../../services/crm.uts': { crmOwner: owner, crmToday: () => '2026-11-13', crmMessage: e => e.message },
    '../../services/attendance.uts': { readWorkDay: date => new Promise((resolve, reject) => calls.push({ date, resolve, reject })), attendanceClock: value => value },
    '../../services/fieldwork-review.uts': { readOwnFieldCases: async () => [], fieldCaseStatus: value => value },
    '../../services/fieldwork.uts': { readFieldTrack: async () => ({ points: [], events: [], distance: '1.3 km' }) },
    '../../services/visit-workbench.uts': {},
  }
  const context = {
    exports: {}, require: name => modules[name], ref, computed, watch,
    onLoad: f => hooks.load = f, onShow: f => hooks.show = f, onHide: f => hooks.hide = f, onUnload: f => hooks.unload = f, onBackPress: f => hooks.back = f,
    uni: { reLaunch: value => navigations.push(value.url) },
  }
  const source = fs.readFileSync('app/pages/fieldwork/fieldwork.uvue', 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  scope.run(() => vm.runInNewContext(ts.transpileModule(source + '\nexports.view = { loading, day, track, cases, error, mapFullscreen }; exports.toggle = toggleMapFullscreen;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context))
  return { ...context.exports, hooks, calls, session, navigations }
}
const settle = () => new Promise(setImmediate)
test('permission refresh reloads visible fieldwork and rejects the previous in-flight response', async t => {
  const f = pageFixture(t)
  f.hooks.show()
  f.session.permissions.push('sales:track:own:read')
  await nextTick()
  assert.equal(f.calls.length, 2)
  f.calls[0].resolve({ id: 'stale' })
  await settle()
  assert.equal(f.view.day.value, null)
  assert.equal(f.view.loading.value, true)
  f.calls[1].resolve({ id: 'current' })
  await settle()
  assert.equal(f.view.day.value.id, 'current')
  assert.equal(f.view.track.value.distance, '1.3 km')
  assert.equal(f.view.loading.value, false)
})
test('hidden account changes clear fieldwork without fetching and logout clears loading', async t => {
  const f = pageFixture(t)
  f.hooks.show()
  f.calls[0].resolve({ id: 'old-account' })
  await settle()
  f.hooks.hide()
  f.session.userId = 'another-sales'
  await nextTick()
  assert.equal(f.view.day.value, null)
  assert.equal(f.calls.length, 1)
  f.hooks.show()
  f.session.authenticated = false
  await nextTick()
  f.calls[1].resolve({ id: 'late-response' })
  await settle()
  assert.equal(f.view.day.value, null)
  assert.equal(f.view.loading.value, false)
  assert.deepEqual(f.navigations, ['/pages/login/login'])
})
test('a single map location retains the configured scale instead of fitting zero-sized bounds', () => {
  const source = fs.readFileSync('app/components/field-route-map/field-route-map.uvue', 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const ast = ts.createSourceFile('map.ts', source, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'amapPoints'))
  const props = reactive({ points: [{ latitude: 39, longitude: 116 }] })
  const context = { exports: {}, props, computed }
  vm.runInNewContext(ts.transpileModule(node.getText(ast) + '\nexports.points = amapPoints;', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context)
  assert.equal(context.exports.points.value, null)
  props.points.push({ latitude: 39, longitude: 116 })
  assert.equal(context.exports.points.value, null)
  props.points.push({ latitude: 39.1, longitude: 116.1 })
  assert.equal(context.exports.points.value.length, 3)
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
