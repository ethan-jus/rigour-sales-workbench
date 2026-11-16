const test = require('node:test')
const assert = require('node:assert/strict')
const {reactive, nextTick} = require('vue')
const {cacheFixture} = require('./helpers/home-cache.cjs')
const owner = () => reactive({authenticated: true, tenantId: 't', userId: 'u', permissions: ['order:read', 'sales:context:read']})
const key = 'orders:2026-11-12:2026-11-12'
test('a verified cold restore reuses only its own environment/account/permission/date snapshot', () => {
  const session = owner(), f = cacheFixture(session)
  f.writeHomeSnapshot(key, f.data({tradeAmount: 42}))
  const restored = cacheFixture(owner(), {storage: f.storage})
  assert.equal(restored.readHomeSnapshot(key).data.getNumber('tradeAmount'), 42)
  assert.equal(restored.readHomeSnapshot('orders:2026-11-13:2026-11-13'), null)
  for (const field of ['tenantId', 'userId', 'permissions']) {
    const other = owner(); other[field] = field === 'permissions' ? ['order:read'] : 'other'
    assert.equal(cacheFixture(other, {storage: new Map(f.storage)}).readHomeSnapshot(key), null)
  }
  const env = {...f.environment, gatewayOrigin: 'https://other.example'}
  assert.equal(cacheFixture(owner(), {storage: new Map(f.storage), environment: env}).readHomeSnapshot(key), null)
})
test('permission ordering does not miss or erase equivalent cached data', async () => {
  const session = owner(), f = cacheFixture(session)
  f.writeHomeSnapshot(key, f.data({tradeAmount: 42})); session.permissions.reverse(); await nextTick()
  assert.notEqual(f.readHomeSnapshot(key), null)
})
test('logout and permission/account changes erase snapshots, including a change back', async () => {
  for (const field of ['authenticated', 'userId', 'permissions']) {
    const session = owner(), f = cacheFixture(session); f.writeHomeSnapshot(key, f.data({tradeAmount: 42}))
    session[field] = field === 'authenticated' ? false : field === 'permissions' ? [] : 'other'; await nextTick()
    assert.equal(f.storage.size, 0)
    Object.assign(session, owner()); await nextTick()
    assert.equal(f.readHomeSnapshot(key), null)
  }
})
test('unverified sessions cannot read or write cached business data', () => {
  const session = owner(), f = cacheFixture(session); f.writeHomeSnapshot(key, f.data({tradeAmount: 42}))
  const cold = owner(); cold.authenticated = false
  const locked = cacheFixture(cold, {storage: f.storage})
  assert.equal(locked.readHomeSnapshot(key), null)
  locked.writeHomeSnapshot(key, locked.data({tradeAmount: 9}))
  assert.equal(locked.storage.size, 0)
})
test('ten minute expiry and clock rollback reject stale/future snapshots', () => {
  const f = cacheFixture(owner()); f.writeHomeSnapshot(key, f.data({tradeAmount: 42}))
  f.advance(599999); assert.notEqual(f.readHomeSnapshot(key), null)
  f.advance(1); assert.equal(f.readHomeSnapshot(key), null)
  f.advance(-600001); assert.equal(f.readHomeSnapshot(key), null)
})
test('bounded snapshots replace matching ranges and evict the oldest selection', () => {
  const f = cacheFixture(owner())
  for (let i = 0; i < 20; i++) f.writeHomeSnapshot('date-' + i, f.data({total: i}))
  assert.equal(f.readHomeSnapshot('date-0'), null)
  assert.equal(JSON.parse([...f.storage.values()][0]).entries.length, 12)
  f.writeHomeSnapshot('date-19', f.data({total: 100}))
  assert.equal(f.readHomeSnapshot('date-19').data.getNumber('total'), 100)
  f.forgetHomeSnapshot('date-19'); assert.equal(f.readHomeSnapshot('date-19'), null)
})
test('corrupt or unavailable persistence does not block live homepage reads', () => {
  const f = cacheFixture(owner(), {storageFailure: true})
  assert.equal(f.readHomeSnapshot(key), null)
  assert.doesNotThrow(() => f.writeHomeSnapshot(key, f.data({total: 1})))
  const bad = cacheFixture(owner(), {storage: new Map([['rigour-sales-home-display-v1', '{bad']])})
  assert.equal(bad.readHomeSnapshot(key), null)
})
