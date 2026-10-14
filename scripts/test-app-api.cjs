// Real config/parser modules with a mocked uni.request transport. Native builds
// and real DEV authorization/data checks remain separate acceptance steps.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')

class Obj {
  constructor(data) { this.data = data }
  getString(key) { return typeof this.data[key] === 'string' ? this.data[key] : null }
  getNumber(key) { return typeof this.data[key] === 'number' ? this.data[key] : null }
  getJSON(key) { return this.data[key] != null && typeof this.data[key] === 'object' && !Array.isArray(this.data[key]) ? new Obj(this.data[key]) : null }
  getArray(key) { return Array.isArray(this.data[key]) ? this.data[key].map(item => item != null && typeof item === 'object' ? new Obj(item) : item) : null }
}
function moduleFixture(name, globals = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../app/services/', name), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  assert.deepEqual(compiled.diagnostics, [])
  const context = { exports: {}, ...globals }
  vm.runInNewContext(compiled.outputText, context)
  return context.exports
}
function apiFixture() {
  const requests = [], errors = [], successes = []
  const session = { authenticated: true, accessToken: 'test-access', expiresAt: 200000, revision: 1 }
  const config = moduleFixture('config.uts')
  // Simulate UTSJSONObject's accessors, while executing the actual text parser.
  const json = moduleFixture('json.uts', { JSON: { parse: text => new Obj(JSON.parse(text)) } })
  const clearSession = () => { session.authenticated = false; session.accessToken = ''; session.revision++ }
  const modules = { './session.uts': { session, clearSession }, './config.uts': config, './json.uts': json }
  const api = moduleFixture('api.uts', {
    require: name => modules[name],
    Date: { now: () => 100000 },
    uni: { request: request => requests.push(request) },
  })
  return {
    api, session, config, requests, errors, successes,
    request: (route = '/orders/sales') => api.requestApi(route, 'GET', null, data => successes.push(data), message => errors.push(message)),
  }
}

test('real DEV environment sends bearer-authenticated text requests to the configured gateway', () => {
  const f = apiFixture()
  assert.equal(f.config.environmentReady(), true)
  f.request()
  assert.equal(f.requests[0].url, f.config.appEnvironment.gatewayOrigin + '/api/v1/orders/sales')
  assert.equal(f.requests[0].dataType, 'text')
  assert.equal(f.requests[0].header.Authorization, 'Bearer test-access')
  assert.equal(f.requests[0].timeout, 20000)
})

test('unconfigured or invalid origins cannot make authenticated requests', () => {
  for (const overrides of [
    { clientId: '' },
    { gatewayOrigin: 'http://attacker.invalid' },
    { environment: 'production' },
  ]) {
    const f = apiFixture()
    Object.assign(f.config.appEnvironment, overrides)
    f.request()
    assert.equal(f.requests.length, 0)
    assert.match(f.errors[0], /尚未配置/)
  }
})

test('DEV HTTP origin exception accepts only the two exact loopback authorities', () => {
  const config = moduleFixture('config.uts')
  for (const origin of ['http://localhost:27680', 'http://localhost:27681']) {
    assert.equal(config.serviceOrigin(origin), origin)
    assert.equal(config.serviceOrigin(origin + '/oauth2/authorize?state=test'), origin)
  }
  for (const origin of [
    'http://localhost:276800', 'http://localhost:27680.attacker.invalid',
    'http://localhost.attacker.invalid:27680', 'http://localhost:27680@attacker.invalid',
    'http://user@localhost:27680', 'http://localhost:27680\\@attacker.invalid',
    'http://127.0.0.1:27680', 'http://[::1]:27680', 'http://192.168.1.10:27680',
    'http://10.0.0.2:27680', 'http://localhost:80', 'http://localhost:27680?other=host',
  ]) assert.equal(config.serviceOrigin(origin), '', origin)
})

test('production never inherits the HTTP loopback exception', () => {
  const config = moduleFixture('config.uts')
  Object.assign(config.appEnvironment, { environment: 'production', clientId: 'company-native', redirectUri: 'com.rigour.workbench://auth/callback' })
  for (const origin of ['http://localhost:27680', 'http://localhost:27681', 'http://192.168.1.10:27680']) assert.equal(config.serviceOrigin(origin), '')
  assert.equal(config.environmentReady(), false)
  config.appEnvironment.gatewayOrigin = 'https://gateway.example.test'
  assert.equal(config.environmentReady(), false)
  config.appEnvironment.issuer = 'https://iam.example.test'
  assert.equal(config.environmentReady(), true)
})

test('HTTPS origins reject userinfo and gateways must be bare authorities', () => {
  const config = moduleFixture('config.uts')
  assert.equal(config.serviceOrigin('https://iam.example.test/oauth2/token'), 'https://iam.example.test')
  for (const origin of ['https://user@iam.example.test', 'https://iam.example.test@other.invalid', 'https://iam.example.test\\@other.invalid']) assert.equal(config.serviceOrigin(origin), '')
  Object.assign(config.appEnvironment, { environment: 'production', gatewayOrigin: 'https://gateway.example.test/api', issuer: 'https://iam.example.test', clientId: 'company-native', redirectUri: 'com.rigour.workbench://auth/callback' })
  assert.equal(config.environmentReady(), false)
  config.appEnvironment.gatewayOrigin = 'https://gateway.example.test'
  for (const issuer of ['https://iam.example.test?x=1', 'https://iam.example.test/#realm']) {
    config.appEnvironment.issuer = issuer
    assert.equal(config.environmentReady(), false)
  }
})

test('debug callback requires the exact DEV client and role-specific loopback origins', () => {
  for (const overrides of [
    { environment: 'production' }, { environment: 'staging' },
    { clientId: 'different-dev-client' }, { clientId: 'rigour-sales-app-android-dev-extra' },
    { gatewayOrigin: 'http://localhost:27681', issuer: 'http://localhost:27680' },
    { gatewayOrigin: 'https://gateway.example.test', issuer: 'https://iam.example.test' },
    { redirectUri: 'uniappx://rigour-sales/auth/callback/extra' },
    { redirectUri: 'uniappx://rigour-sales/auth/callback?extra=1' },
    { redirectUri: 'uniappx://other/auth/callback' },
  ]) {
    const config = moduleFixture('config.uts')
    Object.assign(config.appEnvironment, overrides)
    assert.equal(config.environmentReady(), false, JSON.stringify(overrides))
  }
})

test('production cannot use the Android debug client even with a formal callback', () => {
  const config = moduleFixture('config.uts')
  Object.assign(config.appEnvironment, { environment: 'production', gatewayOrigin: 'https://gateway.example.test', issuer: 'https://iam.example.test', redirectUri: 'com.rigour.workbench://auth/callback' })
  assert.equal(config.environmentReady(), false)
})

test('absolute and protocol-relative API paths never send credentials', () => {
  for (const route of ['https://attacker.invalid/orders', '//attacker.invalid/orders', 'orders']) {
    const f = apiFixture(); f.request(route)
    assert.equal(f.requests.length, 0)
    assert.match(f.errors[0], /路径无效/)
  }
})

test('real parser retains unsafe integer ids through the transport boundary', () => {
  const f = apiFixture(); f.request()
  f.requests[0].success({ statusCode: 200, data: '{"code":"OK","data":{"items":[{"id":9223372036854775807,"customerId":9007199254740993,"paidAmount":12.5}],"total":1}}' })
  const data = f.successes[0].getJSON('data')
  const row = data.getArray('items')[0]
  assert.equal(row.getString('id'), '9223372036854775807')
  assert.equal(row.getString('customerId'), '9007199254740993')
  assert.equal(row.getNumber('paidAmount'), 12.5)
  assert.equal(data.getNumber('total'), 1)
  assert.equal(f.errors.length, 0)
})

test('invalid JSON and non-object roots are failures, not empty successful datasets', () => {
  for (const text of ['<html>upstream error</html>', '{"code":"OK",', 'null', '[]', '42', '']) {
    const f = apiFixture(); f.request()
    f.requests[0].success({ statusCode: 200, data: text })
    assert.equal(f.successes.length, 0)
    assert.match(f.errors[0], /有效数据/)
  }
})

test('bare authenticated profile objects remain supported', () => {
  const f = apiFixture(); f.request('/me')
  f.requests[0].success({ statusCode: 200, data: '{"id":"u1","permissions":["order:read"]}' })
  assert.equal(f.successes[0].getString('id'), 'u1')
  assert.equal(f.errors.length, 0)
})

test('API 401 clears expired authentication and never returns data', () => {
  const f = apiFixture(); f.request()
  f.requests[0].success({ statusCode: 401, data: '<html>unauthorized</html>' })
  assert.equal(f.session.authenticated, false)
  assert.equal(f.successes.length, 0)
  assert.equal(f.errors.length, 1)
})

test('API 403 preserves session and explicitly reports permission denial', () => {
  const f = apiFixture(); f.request()
  f.requests[0].success({ statusCode: 403, data: '{}' })
  assert.equal(f.session.authenticated, true)
  assert.equal(f.successes.length, 0)
  assert.match(f.errors[0], /权限/)
})

test('public business-code allowlist provides Chinese actionable errors', () => {
  for (const [status, code, expected] of [
    [403, 'SALES_IDENTITY_UNBOUND', /绑定销售身份/],
    [403, 'SALES_PROFILE_INACTIVE', /身份尚未生效/],
    [403, 'FORBIDDEN', /权限/],
    [409, 'SALES_POLICY_NOT_FOUND', /外勤规则/],
    [409, 'SALES_VISIT_POLICY_NOT_FOUND', /拜访规则/],
    [404, 'SALES_VISIT_NOT_FOUND', /拜访记录不存在/],
  ]) {
    const f = apiFixture(); f.request()
    f.requests[0].success({ statusCode: status, data: JSON.stringify({ code, message: 'raw-java-stack-with-secret' }) })
    assert.match(f.errors[0], expected)
    assert.doesNotMatch(f.errors[0], /raw-java|secret/)
    assert.equal(f.successes.length, 0)
    assert.equal(f.session.authenticated, true)
  }
})

test('unknown or mismatched business codes never expose server messages or traces', () => {
  for (const [status, code] of [[200, 'DATABASE_STACK'], [409, 'UNKNOWN'], [500, 'SALES_IDENTITY_UNBOUND'], [200, 'SALES_IDENTITY_UNBOUND']]) {
    const f = apiFixture(); f.request()
    f.requests[0].success({ statusCode: status, data: JSON.stringify({ code, message: 'sql credentials stacktrace', trace: 'secret' }) })
    assert.equal(f.successes.length, 0)
    assert.doesNotMatch(f.errors[0], /sql|credentials|stacktrace|secret|绑定销售身份/)
  }
})

test('API response from previous account cannot populate a new account', () => {
  const f = apiFixture(); f.request(); f.session.revision++
  f.requests[0].success({ statusCode: 200, data: '{"code":"OK","data":{"items":[{"id":"old-account-order"}]}}' })
  assert.equal(f.successes.length, 0)
  assert.match(f.errors[0], /账号/)
})

test('API late 401 cannot log out a newer account', () => {
  const f = apiFixture(); f.request(); f.session.revision++
  f.requests[0].success({ statusCode: 401, data: '{}' })
  assert.equal(f.session.authenticated, true)
  assert.equal(f.session.revision, 2)
  assert.equal(f.successes.length, 0)
})

test('API delayed network failure is identified as an old-session response', () => {
  const f = apiFixture(); f.request(); f.session.revision++
  f.requests[0].fail({ errMsg: 'request:fail timeout' })
  assert.equal(f.session.authenticated, true)
  assert.match(f.errors[0], /账号/)
})

test('API network timeout is a failure, not an empty successful list', () => {
  const f = apiFixture(); f.request()
  f.requests[0].fail({ errMsg: 'request:fail timeout private trace' })
  assert.equal(f.successes.length, 0)
  assert.equal(f.errors.length, 1)
  assert.doesNotMatch(f.errors[0], /private trace/)
})

test('API HTTP 503 retains the status even when an upstream returns HTML', () => {
  const f = apiFixture(); f.request()
  f.requests[0].success({ statusCode: 503, data: '<html>stack trace</html>' })
  assert.equal(f.successes.length, 0)
  assert.match(f.errors[0], /503/)
  assert.doesNotMatch(f.errors[0], /stack trace/)
})

test('API expired in-memory token is never sent', () => {
  const f = apiFixture(); f.session.expiresAt = 99999; f.request()
  assert.equal(f.requests.length, 0)
  assert.equal(f.session.authenticated, false)
})
