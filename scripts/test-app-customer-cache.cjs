const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript')
const test = require('node:test'), assert = require('node:assert/strict')
const { reactive, watch, nextTick } = require('vue')

function fixture() {
  const session = reactive({ authenticated: true, tenantId: 'tenant', userId: 'one', revision: 1, permissions: ['b', 'a'] })
  const environment = { environment: 'development', gatewayOrigin: 'http://localhost:26880', issuer: 'http://localhost:26881' }
  let now = 1000000
  const context = { exports: {}, Date: { now: () => now }, require: name => ({ vue: { watch }, './session.uts': { session }, './config.uts': { appEnvironment: environment } }[name]) }
  const source = fs.readFileSync(path.join(__dirname, '../app/services/customer-cache.uts'), 'utf8')
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { ...context.exports, session, environment, advance: ms => now += ms }
}
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('customer display snapshots coalesce pending reads but always revalidate completed reads', async () => {
  const f = fixture(), response = deferred(); let calls = 0
  const load = () => { calls++; return response.promise }
  const first = f.refreshCustomerSnapshot('/mine', load), second = f.refreshCustomerSnapshot('/mine', load)
  assert.equal(first, second); assert.equal(calls, 1); assert.equal(f.readCustomerSnapshot('/mine'), null)
  response.resolve({ total: 2 }); await first
  assert.equal(f.readCustomerSnapshot('/mine').total, 2)
  await f.refreshCustomerSnapshot('/mine', async () => { calls++; return { total: 3 } })
  assert.equal(calls, 2); assert.equal(f.readCustomerSnapshot('/mine').total, 3)
  assert.equal(f.readCustomerSnapshot('/mine?keyword=x'), null)
})

test('customer snapshots expire, reject clock rollback and retain at most twelve selections', async () => {
  const f = fixture()
  await f.refreshCustomerSnapshot('/one', async () => ({ total: 1 }))
  f.advance(-1); assert.equal(f.readCustomerSnapshot('/one'), null)
  f.advance(120001); assert.equal(f.readCustomerSnapshot('/one'), null)
  for (let i = 0; i < 13; i++) await f.refreshCustomerSnapshot('/' + i, async () => ({ total: i }))
  assert.equal(f.readCustomerSnapshot('/0'), null); assert.equal(f.readCustomerSnapshot('/1').total, 1)
  assert.equal(f.readCustomerSnapshot('/12').total, 12)
})

test('failed revalidation evicts stale data and permits a later successful retry', async () => {
  const f = fixture()
  await f.refreshCustomerSnapshot('/mine', async () => ({ total: 1 }))
  await assert.rejects(f.refreshCustomerSnapshot('/mine', async () => { throw new Error('无权限') }), /无权限/)
  assert.equal(f.readCustomerSnapshot('/mine'), null)
  await f.refreshCustomerSnapshot('/mine', async () => ({ total: 2 }))
  assert.equal(f.readCustomerSnapshot('/mine').total, 2)
})

test('identity, tenant, permission, session and environment changes cannot reuse customer data', async () => {
  const f = fixture()
  const changes = [() => f.session.userId = 'two', () => f.session.tenantId = 'other', () => f.session.revision++, () => f.session.permissions = ['a'], () => f.environment.gatewayOrigin = 'http://other', () => f.environment.issuer = 'http://other-iam', () => f.environment.environment = 'other']
  for (const change of changes) {
    await f.refreshCustomerSnapshot('/mine', async () => ({ total: 8 }))
    change(); await nextTick(); assert.equal(f.readCustomerSnapshot('/mine'), null)
  }
  await f.refreshCustomerSnapshot('/mine', async () => ({ total: 8 }))
  f.session.authenticated = false; await nextTick()
  assert.equal(f.readCustomerSnapshot('/mine'), null)
  await assert.rejects(f.refreshCustomerSnapshot('/mine', async () => ({ total: 99 })), /登录/)
})

test('permission ordering is stable and invalidation rejects obsolete in-flight data without dropping the new request', async () => {
  const f = fixture()
  await f.refreshCustomerSnapshot('/mine', async () => ({ total: 1 }))
  f.session.permissions = ['a', 'b']; await nextTick(); assert.equal(f.readCustomerSnapshot('/mine').total, 1)
  const old = deferred(), fresh = deferred()
  const previous = f.refreshCustomerSnapshot('/mine', () => old.promise)
  f.invalidateCustomerCache()
  const current = f.refreshCustomerSnapshot('/mine', () => fresh.promise)
  old.resolve({ total: 99 }); await assert.rejects(previous, /已变化/)
  assert.equal(f.readCustomerSnapshot('/mine'), null)
  assert.equal(f.refreshCustomerSnapshot('/mine', async () => ({ total: 100 })), current)
  fresh.resolve({ total: 2 }); await current
  assert.equal(f.readCustomerSnapshot('/mine').total, 2)
})

test('a response from a former login is rejected even when the same user signs in again', async () => {
  const f = fixture(), response = deferred()
  const pending = f.refreshCustomerSnapshot('/mine', () => response.promise)
  f.session.authenticated = false; await nextTick()
  f.session.authenticated = true; f.session.revision++; await nextTick()
  response.resolve({ total: 99 }); await assert.rejects(pending, /已变化/)
  assert.equal(f.readCustomerSnapshot('/mine'), null)
})
