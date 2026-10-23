// Executes UTS service logic with mocked API callbacks; native compile is separate.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const source = fs.readFileSync(path.resolve(__dirname, '../app/services/sales-profile.uts'), 'utf8')
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
function harness() {
  const session = { authenticated: true, tenantId: 'tenant-1', userId: 'user-1', revision: 0, permissions: ['sales:context:read'] }
  const network = []
  let watcher
  const dependencies = {
    vue: { reactive: v => v, watch: (_get, fn) => { watcher = fn } },
    './session.uts': { session, hasPermission: p => session.authenticated && session.permissions.includes(p) },
    './api.uts': { requestApi: (...args) => network.push(args) },
  }
  const module = { exports: {} }
  new Function('exports', 'require', js)(module.exports, name => dependencies[name])
  const service = module.exports
  return { service, session, network,
    notifyLogin() { watcher('current-owner') },
    reply(index, status, profileId = '') { network[index][3]({ getJSON: () => ({ getString: key => ({ status, hrEmployeeId: '9007199254740993', employeeCode: 'EMP-01', employeeName: '员工一', salesProfileId: profileId })[key] ?? null }) }) },
    logout() { session.authenticated = false; session.revision++; watcher('') },
  }
}
test('login automatically synchronizes identity without client supplied employee fields', () => {
  const h = harness(); h.service.startSalesProfileSync(); h.service.startSalesProfileSync()
  assert.deepEqual(h.network[0].slice(0, 3), ['/sales/me/profile', 'POST', null])
  assert.equal(h.network.length, 1)
  h.reply(0, 'ACTIVE', 'profile-1')
  assert.equal(h.service.salesProfile.status, 'ACTIVE')
})
test('first visit reads share and wait for automatic identity synchronization', () => {
  const h = harness(); h.service.startSalesProfileSync()
  const errors = []
  h.service.requestSalesApi('/sales/me/visits', () => {}, e => errors.push(e))
  h.service.requestSalesApi('/sales/me/visit-targets', () => {}, e => errors.push(e))
  assert.equal(h.network.length, 1)
  h.reply(0, 'ACTIVE', 'profile-1')
  assert.equal(h.network.length, 3)
  assert.deepEqual(h.network.slice(1).map(r => r.slice(0, 3)), [
    ['/sales/me/visits', 'GET', null], ['/sales/me/visit-targets', 'GET', null],
  ])
  assert.deepEqual(errors, [])
})
test('a late login watcher does not cancel the already queued first visit read', () => {
  const h = harness(); h.service.startSalesProfileSync(); const errors = []
  h.service.requestSalesApi('/sales/me/visits', () => {}, e => errors.push(e))
  h.notifyLogin()
  assert.equal(h.network.length, 1)
  h.reply(0, 'ACTIVE', 'profile-1')
  assert.equal(h.network.length, 2)
  assert.deepEqual(errors, [])
})
test('failed identity synchronization blocks waiting business reads and permits explicit retry', () => {
  const h = harness(); h.service.startSalesProfileSync(); const errors = []
  h.service.requestSalesApi('/sales/me/visits', () => {}, e => errors.push(e))
  h.network[0][4]('无法核验')
  assert.equal(h.service.salesProfile.status, '')
  assert.deepEqual(errors, ['无法核验'])
  assert.equal(h.network.length, 1)
  h.service.syncSalesProfile()
  assert.equal(h.network[1][1], 'POST')
})
test('late response after account change does not restore old employee or send queued reads', () => {
  const h = harness(); h.service.startSalesProfileSync(); const errors = []
  h.service.requestSalesApi('/sales/me/visits', () => {}, e => errors.push(e))
  h.logout(); h.reply(0, 'ACTIVE', 'old-profile')
  assert.equal(h.service.salesProfile.status, '')
  assert.equal(h.service.salesProfile.employeeCode, '')
  assert.equal(h.service.salesProfile.busy, false)
  assert.equal(h.network.length, 1)
  assert.equal(errors.length, 1)
})
test('late failure after logout does not overwrite new screen', () => {
  const h = harness(); h.service.startSalesProfileSync(); h.logout(); h.network[0][4]('旧账号错误')
  assert.equal(h.service.salesProfile.message, '')
})
test('without permission neither synchronizes nor sends business reads', () => {
  const h = harness(); h.session.permissions = []; h.service.startSalesProfileSync()
  h.service.syncSalesProfile()
  h.service.requestSalesApi('/sales/me/visits', () => assert.fail(), () => {})
  assert.equal(h.network.length, 0)
})
test('malformed active response does not confirm identity', () => {
  const h = harness(); h.service.startSalesProfileSync(); h.reply(0, 'ACTIVE')
  assert.equal(h.service.salesProfile.status, '')
  assert.match(h.service.salesProfile.message, /未能确认/)
})
test('POST returning unregistered is not success', () => {
  const h = harness(); h.service.startSalesProfileSync(); h.reply(0, 'UNREGISTERED')
  assert.equal(h.service.salesProfile.status, '')
})
