// Actual UTS auth/session/parser control flow with native crypto and transport doubles.
// These protocol/race tests do not replace native builds, Keystore checks, or real IAM acceptance.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const ts = require('typescript')
const check = require('node:test')
const services = path.join(__dirname, '../app/services')

function runModule(source, globals = {}) {
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    reportDiagnostics: true,
  })
  assert.deepEqual(result.diagnostics, [])
  const context = vm.createContext({ exports: {}, ...globals })
  vm.runInContext('String.prototype.toByteArray = function() { return Buffer.from(this.toString(), "ascii") }', context)
  vm.runInContext(result.outputText, context)
  return context.exports
}
function configFixture(values) {
  const config = runModule(fs.readFileSync(path.join(services, 'config.uts'), 'utf8'))
  Object.assign(config.appEnvironment, values)
  return config
}
function androidSource(android) {
  let enabled = true
  const stack = []
  return fs.readFileSync(path.join(services, 'auth.uts'), 'utf8').split('\n').filter(line => {
    const m = line.match(/\/\/ #(ifdef|ifndef) APP-ANDROID/)
    if (m) { stack.push(enabled); enabled = enabled && (m[1] === 'ifdef' ? android : !android); return false }
    if (line.includes('// #endif')) { enabled = stack.pop(); return false }
    return enabled
  }).join('\n')
}
class Obj {
  constructor(data) { this.data = data }
  getString(key) { return typeof this.data[key] === 'string' ? this.data[key] : null }
  getNumber(key) { return typeof this.data[key] === 'number' ? this.data[key] : null }
  getArray(key) { return Array.isArray(this.data[key]) ? this.data[key] : null }
  getJSON(key) { const value = this.data[key]; return value && typeof value === 'object' && !Array.isArray(value) ? new Obj(value) : null }
}
function fixture({ android = true, supported = android, metadata = new Map(), vault = { value: null } } = {}) {
  const requests = [], errors = [], toasts = [], secure = [], secureHistory = [], logs = [], metadataHistory = []
  const faults = {}
  let completed = 0, now = 100000, randomFails = false
  const config = configFixture({
    environment: 'production', gatewayOrigin: 'https://gateway.example.test', issuer: 'https://iam.example.test',
    clientId: 'test-public', redirectUri: 'com.rigour.workbench://auth/callback',
  })
  const sessionModule = runModule(fs.readFileSync(path.join(services, 'session.uts'), 'utf8'), {
    require: name => { assert.equal(name, 'vue'); return { reactive: value => value } },
  })
  const parser = runModule(fs.readFileSync(path.join(services, 'json.uts'), 'utf8'), {
    JSON: { parse: text => new Obj(JSON.parse(text)) },
  })
  const queue = (kind, value, success, fail) => {
    const operation = { kind, value: value == null ? null : JSON.parse(JSON.stringify(value)), success, fail }
    secure.push(operation); secureHistory.push(operation)
  }
  const modules = {
    './config.uts': config, './session.uts': sessionModule, './json.uts': parser,
    './secure-session.uts': {
      secureSessionSupported: () => supported,
      readSecureSession: (success, fail) => queue('read', null, success, fail),
      writeSecureSession: (value, success, fail) => queue('write', value, success, fail),
      clearSecureSession: (success, fail) => queue('clear', null, success, fail),
    },
    'java.security.SecureRandom': class {
      generateSeed(size) { if (randomFails) throw new Error('private native crypto failure'); return crypto.randomBytes(size) }
    },
    'java.security.MessageDigest': { getInstance: algorithm => { assert.equal(algorithm, 'SHA-256'); return { digest: value => crypto.createHash('sha256').update(value).digest() } } },
    'android.util.Base64': { URL_SAFE: 8, NO_WRAP: 2, NO_PADDING: 1, encodeToString: value => Buffer.from(value).toString('base64url') },
    'kotlin.text.Charsets': { US_ASCII: 'ascii' },
  }
  const api = runModule(androidSource(android), {
    require: name => { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name] },
    Buffer, Date: { now: () => now },
    console: { log: (...values) => logs.push(values), warn: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    uni: {
      request: request => requests.push(request), showToast: options => toasts.push(options.title),
      setStorageSync(key, value) {
        metadataHistory.push({ kind: 'set', key, value })
        if (faults.metadataSet) throw new Error('private metadata write failure')
        if (!faults.metadataSetNoop) metadata.set(key, value)
      },
      getStorageSync(key) {
        metadataHistory.push({ kind: 'get', key })
        if (faults.metadataGet) throw new Error('private metadata read failure')
        return Object.hasOwn(faults, 'metadataGetValue') ? faults.metadataGetValue : metadata.get(key) ?? ''
      },
      removeStorageSync(key) {
        metadataHistory.push({ kind: 'remove', key })
        if (faults.metadataRemove) throw new Error('private metadata delete failure')
        if (!faults.metadataRemoveNoop) metadata.delete(key)
      },
    },
  })
  const last = suffix => requests.findLast(request => request.url.endsWith(suffix))
  const respond = (request, data, statusCode = 200) => request.success({ statusCode, data: typeof data === 'string' ? data : JSON.stringify(data) })
  const performSecure = (kind, fail = false) => {
    const operation = secure.shift(); assert.ok(operation, 'expected a queued secure operation')
    if (kind != null) assert.equal(operation.kind, kind)
    if (fail) operation.fail('private native failure')
    else {
      if (operation.kind === 'write') vault.value = operation.value
      if (operation.kind === 'clear') vault.value = null
      operation.success(operation.kind === 'read' ? vault.value : undefined)
    }
    return operation
  }
  const begin = (username = '  sales-user  ', password = 'fixture password') => api.beginCompanyLogin(username, password, () => completed++, message => errors.push(message))
  const start = () => { begin(); performSecure('clear'); return last('/native-app/login') }
  const authorize = (overrides = {}) => {
    const request = last('/native-app/login')
    respond(request, { code: 'OK', data: { authorizationCode: 'one-time-code', state: request.data.state, expiresIn: 90, ...overrides } })
    return last('/oauth2/token')
  }
  const exchange = (overrides = {}) => {
    respond(last('/oauth2/token'), { access_token: 'fixture-access-1', refresh_token: 'fixture-refresh-1', token_type: 'Bearer', expires_in: 900, ...overrides })
    return last('/api/v1/me')
  }
  const profile = (overrides = {}) => {
    respond(last('/api/v1/me'), { id: 'u1', tenantId: 't1', principalScope: 'TENANT', username: 'sales-user', displayName: '销售', permissions: ['order:read'], ...overrides })
  }
  const login = () => { start(); authorize(); exchange(); profile(); performSecure('write') }
  const saved = overrides => ({ refreshToken: 'fixture-saved-refresh', issuer: config.appEnvironment.issuer, clientId: config.appEnvironment.clientId, userId: 'u1', tenantId: 't1', ...overrides })
  return {
    api, env: config.appEnvironment, config, session: sessionModule.session, requests, errors, toasts, secure, secureHistory, logs,
    metadata, metadataHistory, vault, faults,
    markerKey: () => 'rigour-sales-logout:' + config.appEnvironment.environment + ':' + encodeURIComponent(config.appEnvironment.issuer) + ':' + encodeURIComponent(config.appEnvironment.clientId),
    last, respond, performSecure, begin, start, authorize, exchange, profile, login, saved,
    get completed() { return completed }, get persisted() { return vault.value }, set persisted(value) { vault.value = value },
    advance: amount => { now += amount }, failRandom: () => { randomFails = true },
  }
}

check('native lifecycle restores the company session on launch', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/App.uvue'), 'utf8')
  const nativeScript = app.split('// #ifdef APP')[1].split('// #endif')[0]
  const hooks = {}; let restored = 0
  runModule(nativeScript, {
    require: () => ({ restoreCompanySession: () => restored++ }),
    onLaunch: hook => { hooks.launch = hook },
  })
  assert.equal(restored, 0); hooks.launch(); assert.equal(restored, 1)
})

check('config validates official HTTPS and the exact isolated Android DEV combination', () => {
  const dev = configFixture({})
  assert.equal(dev.environmentReady(), true)
  const f = fixture(); assert.equal(f.config.environmentReady(), true)
  for (const change of [{ clientId: '' }, { gatewayOrigin: 'http://gateway.example.test' }, { issuer: 'https://iam.example.test?token=x' }, { redirectUri: 'other://callback' }]) {
    const c = configFixture({ ...f.env, ...change }); assert.equal(c.environmentReady(), false)
  }
  for (const change of [{ environment: 'production' }, { issuer: 'http://localhost:27682' }, { gatewayOrigin: 'http://localhost:27680.attacker.test' }]) {
    const c = configFixture(change); assert.equal(c.environmentReady(), false)
  }
})

check('invalid configuration, missing fields, or unsupported platforms never contact IAM', () => {
  for (const options of [{ android: false }, { supported: false }, { android: false, supported: true }]) {
    const f = fixture(options); f.begin(); assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 0); assert.equal(f.errors.length, 1)
  }
  for (const [username, password] of [[' ', 'valid'], ['valid', '']]) {
    const f = fixture(); f.begin(username, password); assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 0)
  }
  const f = fixture(); f.env.clientId = ''; f.begin(); assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 0)
})

check('native credentials use JSON with real S256 proof and independent cryptographic state', () => {
  const f = fixture(); const request = f.start()
  assert.equal(request.url, f.env.issuer + '/api/v1/auth/native-app/login')
  assert.equal(request.method, 'POST'); assert.equal(request.dataType, 'text'); assert.equal(request.timeout, 20000)
  assert.equal(request.header['Content-Type'], 'application/json')
  assert.deepEqual(Object.keys(request.data).sort(), ['clientId', 'redirectUri', 'codeChallenge', 'codeChallengeMethod', 'state', 'username', 'password'].sort())
  assert.equal(request.data.username, 'sales-user'); assert.equal(request.data.password, 'fixture password')
  assert.equal(request.data.clientId, f.env.clientId); assert.equal(request.data.redirectUri, f.env.redirectUri)
  assert.equal(request.data.codeChallengeMethod, 'S256'); assert.match(request.data.state, /^[A-Za-z0-9_-]{43}$/)
  const token = f.authorize(); const body = new URLSearchParams(token.data)
  assert.equal(token.header['Content-Type'], 'application/x-www-form-urlencoded')
  assert.equal(body.get('grant_type'), 'authorization_code'); assert.equal(body.get('code'), 'one-time-code')
  assert.equal(body.get('client_id'), f.env.clientId); assert.equal(body.get('redirect_uri'), f.env.redirectUri)
  assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/)
  assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), request.data.codeChallenge)
  assert.notEqual(body.get('code_verifier'), request.data.state)
  assert.equal(token.data.includes('fixture password'), false); assert.equal(token.data.includes('client_secret'), false)
})

check('a password is absent from session state, saved credentials, logs, and subsequent requests', () => {
  const f = fixture(); f.login()
  assert.equal(f.completed, 1); assert.equal(f.session.authenticated, true)
  assert.deepEqual(Object.keys(f.persisted).sort(), ['refreshToken', 'issuer', 'clientId', 'userId', 'tenantId'].sort())
  for (const value of [f.session, f.persisted, f.logs, f.metadataHistory, [...f.metadata], f.secureHistory.map(item => item.value), f.requests.slice(1).map(item => ({ data: item.data, header: item.header }))]) {
    assert.equal(JSON.stringify(value).includes('fixture password'), false)
  }
  for (const credential of ['fixture-access-1', 'fixture-refresh-1']) assert.equal(JSON.stringify(f.metadataHistory).includes(credential), false)
})

check('login is single flight and secure clearing completes before credentials are sent', () => {
  const f = fixture(); f.begin(); f.begin()
  assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 1); assert.match(f.errors[0], /正在处理登录/)
  f.performSecure('clear'); assert.equal(f.requests.length, 1)
  f.begin(); assert.equal(f.requests.length, 1); assert.equal(f.secure.length, 0)
})

check('cryptographic preparation and prior-credential clearing failures abort login safely', () => {
  const f = fixture(); f.failRandom(); f.begin(); assert.equal(f.requests.length, 0); assert.match(f.errors[0], /安全登录请求/)
  const g = fixture(); g.begin(); g.performSecure('clear', true)
  assert.equal(g.requests.length, 0); assert.equal(g.session.authenticated, false); assert.match(g.errors[0], /本机登录凭据/)
})

check('native auth statuses use fixed safe user messages and do not leak upstream details', () => {
  for (const [status, pattern] of [[400, /未通过校验/], [401, /账号或密码/], [403, /暂不可登录/], [429, /较频繁/], [503, /暂时不可用/]]) {
    const f = fixture(); const request = f.start()
    f.respond(request, { code: 'DENIED', message: 'upstream secret private' }, status)
    assert.match(f.errors[0], pattern); assert.equal(f.errors[0].includes('private'), false)
    assert.equal(f.requests.length, 1); assert.equal(f.session.authenticated, false)
  }
})

check('wrong state, missing authorization code, and expired code stop before token exchange', () => {
  for (const overrides of [{ state: 'wrong' }, { authorizationCode: '' }, { expiresIn: 0 }, { expiresIn: -1 }]) {
    const f = fixture(); f.start(); f.authorize(overrides)
    assert.equal(f.requests.length, 1); assert.match(f.errors[0], /安全校验失败/)
  }
  for (const body of ['{broken', '[]', { code: 'OK' }, { code: 'FAILED', data: { authorizationCode: 'code' } }]) {
    const f = fixture(); const request = f.start(); f.respond(request, body)
    assert.equal(f.requests.length, 1); assert.equal(f.errors.length, 1)
  }
})

check('missing refresh credential or invalid token response cannot publish a session', () => {
  for (const overrides of [{ refresh_token: '' }, { refresh_token: null }, { access_token: '' }, { token_type: 'Basic' }, { expires_in: 30 }, { expires_in: 0 }, { expires_in: '900' }]) {
    const f = fixture(); f.start(); f.authorize(); f.exchange(overrides)
    assert.equal(f.requests.length, 2); assert.equal(f.session.authenticated, false); assert.equal(f.persisted, null)
    assert.match(f.errors[0], /授权已失效/)
  }
})

check('authenticated TENANT identity and successful secure save precede session publication', () => {
  const f = fixture(); f.start(); f.authorize(); const me = f.exchange()
  assert.equal(me.url, f.env.gatewayOrigin + '/api/v1/me'); assert.equal(me.header.Authorization, 'Bearer fixture-access-1')
  assert.equal(f.session.authenticated, false); assert.equal(f.completed, 0)
  f.profile(); assert.equal(f.session.authenticated, false); assert.equal(f.completed, 0)
  assert.equal(f.secure[0].kind, 'write'); assert.equal(f.persisted, null)
  f.performSecure('write'); assert.equal(f.completed, 1); assert.equal(f.session.authenticated, true)
  assert.equal(f.session.userId, 'u1'); assert.equal(f.session.tenantId, 't1'); assert.equal(f.session.accessToken, 'fixture-access-1')
})

check('non-tenant or missing identity and unsafe persistence are rejected', () => {
  for (const overrides of [{ principalScope: 'PLATFORM' }, { principalScope: '' }, { id: '' }, { tenantId: '' }]) {
    const f = fixture(); f.start(); f.authorize(); f.exchange(); f.profile(overrides)
    assert.equal(f.session.authenticated, false); assert.equal(f.secure.some(item => item.kind === 'write'), false)
    assert.match(f.errors[0], /公司员工账号/)
  }
  const f = fixture(); f.start(); f.authorize(); f.exchange(); f.profile(); f.performSecure('write', true)
  assert.equal(f.session.authenticated, false); assert.equal(f.completed, 0); assert.equal(f.persisted, null)
  assert.match(f.errors[0], /本次登录未完成/)
})

check('actual parser preserves large numeric IAM identity values from text envelopes', () => {
  const f = fixture(); f.start(); f.authorize(); f.exchange()
  f.respond(f.last('/api/v1/me'), '{"code":"OK","data":{"id":9223372036854775001,"tenantId":9223372036854775002,"principalScope":"TENANT","permissions":["order:read"]}}')
  f.performSecure('write')
  assert.equal(f.session.userId, '9223372036854775001'); assert.equal(f.session.tenantId, '9223372036854775002')
})

check('native login, exchange, and me network errors invalidate the attempt', () => {
  for (const stage of ['native', 'token', 'me']) {
    const f = fixture(); let request = f.start()
    if (stage !== 'native') request = f.authorize()
    if (stage === 'me') request = f.exchange()
    request.fail({ errMsg: 'request:fail timeout private' })
    assert.equal(f.session.authenticated, false); assert.equal(f.completed, 0); assert.equal(f.errors.length, 1)
    assert.equal(f.errors[0].includes('private'), false)
    f.performSecure('clear'); assert.equal(f.persisted, null)
  }
})

check('fresh access token returns immediately without refreshing or changing revision', () => {
  const f = fixture(); f.login(); const tokens = [], revision = f.session.revision, version = f.session.tokenVersion, count = f.requests.length
  f.api.ensureAccessToken(false, token => tokens.push(token), message => f.errors.push(message))
  assert.deepEqual(tokens, ['fixture-access-1']); assert.equal(f.requests.length, count); assert.equal(f.secure.length, 0)
  assert.equal(f.session.revision, revision); assert.equal(f.session.tokenVersion, version)
})

check('parallel access requests share one rotating refresh and publish only after secure save', () => {
  const f = fixture(); f.login(); f.advance(871000)
  const tokens = [], revision = f.session.revision, version = f.session.tokenVersion, count = f.requests.length
  for (let i = 0; i < 4; i++) f.api.ensureAccessToken(false, token => tokens.push(token), message => f.errors.push(message))
  assert.equal(f.secure.length, 1); assert.equal(f.requests.length, count); assert.equal(f.session.refreshing, true)
  f.performSecure('clear'); assert.equal(f.persisted, null); assert.equal(f.requests.length, count + 1)
  const refresh = f.last('/oauth2/token'), body = new URLSearchParams(refresh.data)
  assert.equal(body.get('grant_type'), 'refresh_token'); assert.equal(body.get('refresh_token'), 'fixture-refresh-1'); assert.equal(body.get('client_id'), f.env.clientId)
  f.exchange({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' }); f.profile()
  assert.deepEqual(tokens, []); assert.equal(f.session.accessToken, 'fixture-access-1')
  f.performSecure('write')
  assert.deepEqual(tokens, Array(4).fill('fixture-access-2')); assert.equal(f.session.refreshing, false)
  assert.equal(f.session.revision, revision); assert.equal(f.session.tokenVersion, version + 1)
  assert.equal(f.persisted.refreshToken, 'fixture-refresh-2')
})

check('force refresh rotates a still-valid token and requires the same user and tenant', () => {
  for (const overrides of [{ id: 'u2' }, { tenantId: 't2' }]) {
    const f = fixture(); f.login(); const received = [], failures = []
    f.api.ensureAccessToken(true, token => received.push(token), message => failures.push(message)); f.performSecure('clear')
    f.exchange({ access_token: 'fixture-access-2', refresh_token: 'fixture-refresh-2' }); f.profile(overrides)
    assert.deepEqual(received, []); assert.match(failures[0], /身份校验未通过/)
    assert.equal(f.session.authenticated, false); f.performSecure('clear'); assert.equal(f.persisted, null)
  }
})

check('refresh refuses reused, missing, or denied refresh credentials', () => {
  for (const mode of ['same', 'missing', 'denied']) {
    const f = fixture(); f.login(); const failures = [], tokens = []
    f.api.ensureAccessToken(true, token => tokens.push(token), message => failures.push(message)); f.performSecure('clear')
    if (mode === 'denied') f.respond(f.last('/oauth2/token'), { error: 'invalid_grant' }, 400)
    else f.exchange({ refresh_token: mode === 'same' ? 'fixture-refresh-1' : '' })
    assert.equal(tokens.length, 0); assert.equal(failures.length, 1); assert.equal(f.session.authenticated, false)
    f.performSecure('clear'); assert.equal(f.persisted, null)
  }
})

check('refresh timeout erases the consumed token and cannot replay it on another request', () => {
  const f = fixture(); f.login(); const tokens = [], failures = []
  f.api.ensureAccessToken(true, token => tokens.push(token), message => failures.push(message)); f.performSecure('clear')
  const request = f.last('/oauth2/token'), count = f.requests.length
  assert.equal(f.persisted, null)
  request.fail({ errMsg: 'request:fail timeout' }); f.performSecure('clear')
  assert.equal(f.session.authenticated, false); assert.match(failures[0], /避免重复使用旧凭据/)
  f.api.ensureAccessToken(true, token => tokens.push(token), message => failures.push(message))
  assert.equal(f.requests.length, count); assert.equal(failures.length, 2); assert.equal(tokens.length, 0)
  f.respond(request, { access_token: 'late', refresh_token: 'late-refresh', token_type: 'Bearer', expires_in: 900 })
  assert.equal(f.requests.length, count); assert.equal(f.session.authenticated, false)
})

check('refresh clearing or replacement-save failure never releases waiting requests', () => {
  for (const stage of ['clear', 'save']) {
    const f = fixture(); f.login(); const tokens = [], failures = []
    f.api.ensureAccessToken(true, token => tokens.push(token), message => failures.push(message))
    if (stage === 'clear') f.performSecure('clear', true)
    else { f.performSecure('clear'); f.exchange({ access_token: 'new-access', refresh_token: 'new-refresh' }); f.profile(); f.performSecure('write', true) }
    assert.deepEqual(tokens, []); assert.equal(failures.length, 1); assert.equal(f.session.authenticated, false)
    f.performSecure('clear'); assert.equal(f.persisted, null)
  }
})

check('startup restoration is single flight and consumes the saved credential before networking', () => {
  const f = fixture(); f.persisted = f.saved(); const received = []
  f.api.restoreCompanySession(); f.api.restoreCompanySession()
  assert.equal(f.secure.length, 1); assert.equal(f.session.restoring, true)
  f.api.ensureAccessToken(false, token => received.push(token), message => f.errors.push(message))
  f.performSecure('read'); assert.equal(f.requests.length, 0); assert.equal(f.secure[0].kind, 'clear')
  f.performSecure('clear'); assert.equal(f.persisted, null)
  assert.equal(new URLSearchParams(f.last('/oauth2/token').data).get('refresh_token'), 'fixture-saved-refresh')
  f.exchange({ refresh_token: 'rotated-after-restore' }); f.profile(); assert.equal(received.length, 0)
  f.performSecure('write'); assert.deepEqual(received, ['fixture-access-1']); assert.equal(f.session.restoring, false)
  assert.equal(f.persisted.refreshToken, 'rotated-after-restore'); assert.equal(f.session.authenticated, true)
})

check('startup with no saved session settles pending requests without network access', () => {
  const f = fixture(); const failures = []
  f.api.restoreCompanySession(); f.api.ensureAccessToken(false, () => assert.fail('no token expected'), message => failures.push(message))
  f.performSecure('read')
  assert.equal(f.session.restoring, false); assert.equal(f.requests.length, 0); assert.deepEqual(failures, ['请先登录公司账号。'])
})

check('startup rejects corrupt, foreign, or incomplete saved identities', () => {
  for (const overrides of [{ issuer: 'https://foreign.test' }, { clientId: 'foreign-client' }, { userId: '' }, { tenantId: '' }, { refreshToken: '' }]) {
    const f = fixture(); f.persisted = f.saved(overrides); f.api.restoreCompanySession(); f.performSecure('read')
    assert.equal(f.requests.length, 0); assert.equal(f.session.authenticated, false); assert.match(f.session.loginError, /本机登录凭据已失效/)
    f.performSecure('clear'); assert.equal(f.persisted, null)
  }
  const f = fixture(); f.api.restoreCompanySession(); f.performSecure('read', true)
  assert.equal(f.session.restoring, false); assert.equal(f.requests.length, 0); assert.match(f.session.loginError, /无法读取安全登录凭据/)
})

check('unsupported startup does not report a fabricated restoration', () => {
  const f = fixture({ android: false }); f.api.restoreCompanySession()
  assert.equal(f.session.restoring, false); assert.equal(f.session.authenticated, false); assert.equal(f.secure.length, 0)
})

check('cancelling before secure clear prevents sending a password; late login stages stay invalidated', () => {
  const f = fixture(); f.begin(); f.api.cancelCompanyLogin(); f.performSecure('clear'); f.performSecure('clear')
  assert.equal(f.requests.length, 0); assert.equal(f.completed, 0); assert.equal(f.persisted, null)
  for (const stage of ['native', 'token', 'me', 'save']) {
    const g = fixture(); g.start()
    if (stage !== 'native') g.authorize()
    if (stage === 'me' || stage === 'save') g.exchange()
    if (stage === 'save') g.profile()
    const count = g.requests.length; g.api.cancelCompanyLogin()
    if (stage === 'native') g.authorize()
    if (stage === 'token') g.exchange()
    if (stage === 'me') g.profile()
    if (stage === 'save') g.performSecure('write')
    g.performSecure('clear')
    assert.equal(g.session.authenticated, false); assert.equal(g.completed, 0); assert.equal(g.persisted, null); assert.equal(g.requests.length, count)
  }
})

check('logout first verifies its marker, then clears memory and revokes the current access token', () => {
  const f = fixture(); f.login(); f.api.ensureAccessToken(true, () => {}, message => f.errors.push(message)); f.performSecure('clear')
  f.exchange({ access_token: 'current-access-2', refresh_token: 'current-refresh-2' }); f.profile(); f.performSecure('write')
  const revision = f.session.revision
  f.api.logoutCompany(); const request = f.last('/native-app/logout')
  assert.equal(f.session.authenticated, false); assert.equal(f.session.accessToken, ''); assert.equal(f.session.revision, revision + 1)
  assert.equal(f.metadata.get(f.markerKey()), 'pending'); assert.equal(f.session.logoutState, 'clearing')
  assert.equal(f.session.logoutError ?? '', '')
  assert.equal(request.method, 'POST'); assert.equal(request.header.Authorization, 'Bearer current-access-2')
  assert.equal(request.data, undefined); f.respond(request, '', 204); assert.deepEqual(f.toasts, [])
  assert.equal(f.session.logoutState, 'clearing')
  f.performSecure('clear'); assert.equal(f.persisted, null); assert.equal(f.session.logoutState, 'done')
  assert.equal(f.metadata.get(f.markerKey()), 'done')
  const set = f.metadataHistory.findLastIndex(item => item.kind === 'set')
  assert.deepEqual(f.metadataHistory[set], { kind: 'set', key: f.markerKey(), value: 'done' })
  assert.equal(f.metadataHistory[set + 1].kind, 'get')
})

check('a server logout failure cannot claim local success until secure erasure succeeds', () => {
  for (const networkFail of [false, true]) {
    const f = fixture(); f.login(); f.api.logoutCompany(); const request = f.last('/native-app/logout')
    if (networkFail) request.fail({ errMsg: 'private upstream details' })
    else f.respond(request, { message: 'private upstream details' }, 500)
    assert.equal(f.session.logoutState, 'clearing')
    assert.equal([...f.toasts, f.session.logoutError, f.session.loginError].join(' ').includes('本机已退出'), false)
    f.performSecure('clear'); assert.equal(f.session.authenticated, false); assert.equal(f.persisted, null)
    assert.equal(f.session.logoutState, 'done')
    assert.equal([...f.toasts, f.session.logoutError, f.session.loginError].join(' ').includes('private'), false)
    assert.equal(f.metadata.get(f.markerKey()), 'done')
  }
})

check('failed secure erasure plus offline logout cannot restore a retained refresh token after restart', () => {
  const f = fixture(); f.login(); const saved = f.persisted
  f.api.logoutCompany(); f.performSecure('clear', true)
  f.last('/native-app/logout').fail({ errMsg: 'offline' })
  assert.equal(f.session.authenticated, false); assert.equal(f.session.logoutState, 'failed')
  assert.ok(f.session.logoutError.length > 0); assert.deepEqual(f.persisted, saved)
  assert.equal(f.metadata.get(f.markerKey()), 'pending')
  assert.equal([...f.toasts, f.session.logoutError, f.session.loginError].join(' ').includes('本机已退出'), false)
  const restarted = fixture({ metadata: f.metadata, vault: f.vault })
  restarted.api.restoreCompanySession()
  assert.equal(restarted.session.authenticated, false); assert.equal(restarted.session.restoring, false)
  assert.equal(restarted.session.logoutState, 'failed'); assert.ok(restarted.session.logoutError.length > 0)
  assert.equal(restarted.secure.length, 0); assert.equal(restarted.requests.length, 0)
  assert.deepEqual(restarted.persisted, saved)
})

check('marker write, verification, or readback failure leaves the current identity and reports no successful logout', () => {
  for (const fault of ['metadataSet', 'metadataSetNoop', 'metadataGet', 'metadataGetValue']) {
    const f = fixture(); f.login(); const revision = f.session.revision, count = f.requests.length, saved = f.persisted
    f.faults[fault] = fault === 'metadataGetValue' ? '' : true
    f.api.logoutCompany()
    assert.equal(f.session.authenticated, true); assert.equal(f.session.accessToken, 'fixture-access-1')
    assert.equal(f.session.revision, revision); assert.deepEqual(f.persisted, saved)
    assert.equal(f.requests.length, count); assert.equal(f.secure.length, 0)
    assert.equal(f.session.logoutState, 'failed'); assert.ok(f.session.logoutError.length > 0)
    assert.equal([...f.toasts, f.session.logoutError, f.session.loginError].join(' ').includes('本机已退出'), false)
  }
})

check('restore refuses any nonempty logout marker and fails closed when metadata is unreadable', () => {
  for (const marker of ['pending', 'unknown', ' ']) {
    const f = fixture(); f.persisted = f.saved(); f.metadata.set(f.markerKey(), marker)
    f.api.restoreCompanySession()
    assert.equal(f.session.authenticated, false); assert.equal(f.session.restoring, false)
    assert.equal(f.session.logoutState, 'failed'); assert.equal(f.secure.length, 0); assert.equal(f.requests.length, 0)
  }
  const f = fixture(); f.persisted = f.saved(); f.faults.metadataGet = true
  f.api.restoreCompanySession()
  assert.equal(f.session.authenticated, false); assert.equal(f.session.restoring, false)
  assert.equal(f.session.logoutState, 'failed'); assert.equal(f.secure.length, 0); assert.equal(f.requests.length, 0)
})

check('explicit login removes a logout marker only after its new credentials have been safely saved', () => {
  const f = fixture(); f.metadata.set(f.markerKey(), 'pending')
  f.start(); assert.equal(f.metadata.get(f.markerKey()), 'pending')
  f.authorize(); f.exchange(); f.profile()
  assert.equal(f.metadata.get(f.markerKey()), 'pending'); assert.equal(f.session.authenticated, false)
  assert.equal(f.metadataHistory.some(item => item.kind === 'remove'), false)
  f.performSecure('write')
  assert.equal(f.persisted.refreshToken, 'fixture-refresh-1'); assert.equal(f.metadata.has(f.markerKey()), false)
  assert.equal(f.session.authenticated, true); assert.equal(f.completed, 1); assert.equal(f.session.logoutState, 'idle')
  const removed = f.metadataHistory.findLastIndex(item => item.kind === 'remove')
  assert.equal(f.metadataHistory[removed + 1].kind, 'get')
})

check('failed secure save or logout-marker removal never publishes a new identity', () => {
  for (const failure of ['secure', 'metadataRemove', 'metadataRemoveNoop', 'metadataGet']) {
    const f = fixture(); f.metadata.set(f.markerKey(), 'pending')
    f.start(); f.authorize(); f.exchange(); f.profile()
    if (failure !== 'secure') f.faults[failure] = true
    f.performSecure('write', failure === 'secure')
    assert.equal(f.session.authenticated, false); assert.equal(f.completed, 0); assert.equal(f.errors.length, 1)
    assert.equal([...f.errors, ...f.toasts].join(' ').includes('private'), false)
    if (failure === 'secure' || failure === 'metadataRemove' || failure === 'metadataRemoveNoop') assert.equal(f.metadata.get(f.markerKey()), 'pending')
  }
})

check('retrying a failed logout erases the retained credential and keeps the restart guard', () => {
  const f = fixture(); f.login(); f.api.logoutCompany(); f.performSecure('clear', true)
  f.last('/native-app/logout').fail({ errMsg: 'offline' })
  assert.equal(f.session.logoutState, 'failed')
  f.api.logoutCompany(); assert.equal(f.session.logoutState, 'clearing')
  f.performSecure('clear')
  assert.equal(f.session.logoutState, 'done'); assert.equal(f.persisted, null); assert.equal(f.session.authenticated, false)
  assert.equal(f.metadata.get(f.markerKey()), 'done')
})

check('logout invalidates late restore, refresh, and secure-save callbacks', () => {
  const restored = fixture(); restored.persisted = restored.saved(); restored.api.restoreCompanySession(); restored.api.logoutCompany()
  restored.performSecure('read'); restored.performSecure('clear')
  assert.equal(restored.requests.length, 0); assert.equal(restored.session.authenticated, false)
  for (const stage of ['token', 'me', 'save']) {
    const f = fixture(); f.login(); const received = [], failures = []
    f.api.ensureAccessToken(true, token => received.push(token), message => failures.push(message)); f.performSecure('clear')
    if (stage !== 'token') f.exchange({ access_token: 'refreshed-access', refresh_token: 'refreshed-token' })
    if (stage === 'save') f.profile()
    f.api.logoutCompany()
    if (stage === 'token') f.exchange({ access_token: 'late-access', refresh_token: 'late-refresh' })
    if (stage === 'me') f.profile()
    if (stage === 'save') f.performSecure('write')
    f.performSecure('clear')
    assert.equal(f.session.authenticated, false); assert.equal(f.persisted, null); assert.deepEqual(received, []); assert.equal(failures.length, 1)
  }
})

check('a late response from an earlier login cannot clear or overwrite the newer account', () => {
  const f = fixture(); const stale = f.start(); f.api.cancelCompanyLogin(); f.performSecure('clear')
  f.login(); const revision = f.session.revision, tokenVersion = f.session.tokenVersion
  f.respond(stale, { code: 'OK', data: { authorizationCode: 'stale', state: stale.data.state, expiresIn: 90 } })
  stale.fail({ errMsg: 'timeout' })
  assert.equal(f.session.authenticated, true); assert.equal(f.session.revision, revision); assert.equal(f.session.tokenVersion, tokenVersion)
  assert.equal(f.session.accessToken, 'fixture-access-1'); assert.equal(f.persisted.refreshToken, 'fixture-refresh-1')
})

check('a confirmed local logout remains signed out after restart without reporting a pending failure', () => {
  const f = fixture(); f.login(); f.api.logoutCompany()
  f.respond(f.last('/native-app/logout'), '', 204)
  f.performSecure('clear')
  assert.equal(f.persisted, null); assert.equal(f.metadata.get(f.markerKey()), 'done')
  const restarted = fixture({ metadata: f.metadata, vault: f.vault })
  restarted.api.restoreCompanySession()
  assert.equal(restarted.session.authenticated, false)
  assert.equal(restarted.session.logoutState, 'done')
  assert.equal(restarted.session.logoutError, '')
  assert.equal(restarted.session.loginError, '')
  assert.equal(restarted.secure.length, 0); assert.equal(restarted.requests.length, 0)
  restarted.login()
  assert.equal(restarted.session.authenticated, true)
  assert.equal(restarted.metadata.has(restarted.markerKey()), false)
})

check('failed completion-marker persistence is retryable and never claims confirmed logout', () => {
  for (const fault of ['metadataSet', 'metadataSetNoop', 'metadataGet', 'metadataGetValue']) {
    const f = fixture(); f.login(); f.api.logoutCompany()
    f.faults[fault] = fault === 'metadataGetValue' ? 'pending' : true
    f.performSecure('clear')
    assert.equal(f.persisted, null)
    assert.equal(f.session.logoutState, 'failed')
    assert.match(f.session.logoutError, /退出状态保存失败/)
    assert.equal(f.toasts.some(message => message.includes('本机已退出')), false)
    delete f.faults[fault]
    f.api.logoutCompany(); f.performSecure('clear')
    assert.equal(f.session.logoutState, 'done')
    assert.equal(f.metadata.get(f.markerKey()), 'done')
  }
})
