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
function platformSource(android, ios, filename = 'auth.uts') {
  let enabled = true
  const stack = []
  return fs.readFileSync(path.join(services, filename), 'utf8').split('\n').filter(line => {
    const m = line.match(/\/\/ #(ifdef|ifndef) (.+)$/)
    if (m) {
      const applies = m[2].split(' || ').some(platform => platform === 'APP-ANDROID' ? android : platform === 'APP-IOS' && ios)
      stack.push(enabled)
      enabled = enabled && (m[1] === 'ifdef' ? applies : !applies)
      return false
    }
    if (line.includes('// #endif')) { enabled = stack.pop(); return false }
    return enabled
  }).join('\n')
}
class Obj {
  constructor(data) { this.data = data }
  getString(key) { return typeof this.data[key] === 'string' ? this.data[key] : null }
  getNumber(key) { return typeof this.data[key] === 'number' ? this.data[key] : null }
  getBoolean(key) { return typeof this.data[key] === 'boolean' ? this.data[key] : null }
  getArray(key) { return Array.isArray(this.data[key]) ? this.data[key] : null }
  getJSON(key) { const value = this.data[key]; return value && typeof value === 'object' && !Array.isArray(value) ? new Obj(value) : null }
}
function fixture({ ios = false, android = !ios, supported = android || ios, metadata = new Map(), vault = { value: null } } = {}) {
  const requests = [], errors = [], toasts = [], secure = [], secureHistory = [], logs = [], metadataHistory = [], networkChecks = []
  const faults = {}
  let completed = 0, now = 100000, randomFails = false
  const config = configFixture({
    environment: 'production', gatewayOrigin: 'https://gateway.example.test', issuer: 'https://iam.example.test',
    clientId: 'test-public', redirectUri: 'com.rigour.workbench://auth/callback',
  })
  const sessionModule = runModule(fs.readFileSync(path.join(services, 'session.uts'), 'utf8'), {
    require: name => { assert.equal(name, 'vue'); return { reactive: value => value } },
  })
  const parser = runModule(platformSource(android, ios, 'json.uts'), {
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
    '../uni_modules/rigour-session-keychain': {
      loginRandomToken: () => randomFails ? null : crypto.randomBytes(32).toString('base64url'),
      loginProofChallenge: verifier => crypto.createHash('sha256').update(verifier).digest('base64url'),
    },
  }
  const api = runModule(platformSource(android, ios), {
    require: name => { assert.ok(name in modules, `unexpected dependency ${name}`); return modules[name] },
    Buffer, Date: { now: () => now },
    console: { log: (...values) => logs.push(values), warn: (...values) => logs.push(values), error: (...values) => logs.push(values) },
    uni: {
      getNetworkType: options => { if (faults.deferNetworkCheck) { networkChecks.push(options); return } if (faults.networkCheckFails) options.fail({}); else options.success({ networkType: faults.offline ? 'none' : 'wifi' }) },
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
  const begin = (username = '  sales-user  ', password = 'fixture password', rememberLogin = true) => api.beginCompanyLogin(username, password, () => completed++, message => errors.push(message), rememberLogin)
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
    metadata, metadataHistory, vault, faults, networkChecks,
    markerKey: () => 'rigour-sales-logout:' + config.appEnvironment.environment + ':' + encodeURIComponent(config.appEnvironment.issuer) + ':' + encodeURIComponent(config.appEnvironment.clientId),
    last, respond, performSecure, begin, start, authorize, exchange, profile, login, saved,
    get completed() { return completed }, get persisted() { return vault.value }, set persisted(value) { vault.value = value },
    advance: amount => { now += amount }, failRandom: () => { randomFails = true },
  }
}

check('native lifecycle restores the company session on launch', () => {
  const app = fs.readFileSync(path.join(__dirname, '../app/App.uvue'), 'utf8')
  const nativeScript = app.split('// #ifdef APP')[1].split('// #endif')[0]
  const hooks = {}; const calls = []; const redirects = []
  runModule(nativeScript, {
    require: name => ({
      './services/auth.uts': { restoreCompanySession: () => calls.push('restore') },
      './services/sales-profile.uts': { startSalesProfileSync: () => calls.push('watch-sales-identity') },
      vue: { watch: (_getter, callback) => { hooks.authChanged = callback } },
      './services/session.uts': { session: { authenticated: false } },
      './services/field-tracking.uts': { startFieldTracking: () => {}, resumeFieldTracking: () => {} },
      './services/visit-policy.uts': { startVisitPolicyPreload: () => {}, resumeVisitPolicyPreload: () => {}, pauseVisitPolicyPreload: () => {} },
      './services/crm-departure.uts': { startCrmDeparture: () => {}, resumeCrmDeparture: () => {} },
    './services/crm-media.uts': { startCrmUploadQueue: () => calls.push('queue'), resumeCrmUploadQueue: () => calls.push('resume-queue') },
    })[name],
    onLaunch: hook => { hooks.launch = hook }, onShow: hook => { hooks.show = hook }, onHide: hook => { hooks.hide = hook },
    uni: { reLaunch: options => redirects.push(options.url), onNetworkStatusChange: callback => { hooks.network = callback } },
  })
  assert.deepEqual(calls, []); hooks.launch(); assert.deepEqual(calls, ['queue', 'watch-sales-identity', 'restore'])
  hooks.show(); assert.deepEqual(calls.slice(-1), ['resume-queue'])
  hooks.authChanged(false, false); hooks.authChanged(true, false); assert.deepEqual(redirects, [])
  hooks.authChanged(false, true); assert.deepEqual(redirects, ['/pages/login/login'])
})

function loginPageFixture(initial = {}) {
  const session = { authenticated: false, restoring: false, loginError: '', logoutError: '', logoutState: 'idle', ...initial }
  const hooks = {}, watches = [], navigations = []
  let loginCount = 0, logoutCount = 0
  const source = fs.readFileSync(path.join(__dirname, '../app/pages/login/login.uvue'), 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const page = runModule(source + '\nexports.view = { launching, logoutPending, errorText, passwordVisible, username, password }; exports.signIn = signIn; exports.home = home; exports.retryLogout = retryLogout;', {
    require: name => ({
      '../../services/session.uts': { session },
      '../../services/auth.uts': { beginCompanyLogin: (_username, _password, success) => { loginCount++; session.authenticated = true; success() }, cancelCompanyLogin: () => {}, logoutCompany: () => { logoutCount++ } },
      '../../services/login-preferences.uts': { readLoginPreference: () => ({ username: '', rememberLogin: true }), saveLoginPreference: () => {} },
    })[name],
    ref: value => ({ value }), computed: getter => ({ get value() { return getter() } }),
    watch: (getter, callback) => watches.push({ getter, callback, previous: getter() }),
    onReady: hook => { hooks.ready = hook }, onShow: hook => { hooks.show = hook }, onUnload: hook => { hooks.unload = hook },
    uni: { switchTab: options => navigations.push(options), setNavigationBarTitle: () => {} },
  })
  const flush = () => { for (const watcher of watches) { const next = watcher.getter(); if (next !== watcher.previous) { const previous = watcher.previous; watcher.previous = next; watcher.callback(next, previous) } } }
  return { page, session, hooks, navigations, flush, loginCount: () => loginCount, logoutCount: () => logoutCount }
}

check('cold launch opens the login route without exposing business pages', () => {
  const routes = JSON.parse(fs.readFileSync(path.join(__dirname, '../app/pages.json'), 'utf8'))
  assert.equal(routes.pages[0].path, 'pages/login/login')
  const f = loginPageFixture(); f.hooks.show(); f.hooks.ready()
  assert.equal(f.page.view.launching.value, false); assert.equal(f.page.view.passwordVisible.value, false)
  assert.equal(f.navigations.length, 0)
})

check('restoration shows only the launch state and enters home once the page and session are ready', () => {
  for (const restoreBeforeReady of [true, false]) {
    const f = loginPageFixture({ restoring: true })
    f.hooks.show(); assert.equal(f.page.view.launching.value, true)
    if (!restoreBeforeReady) f.hooks.ready()
    assert.equal(f.navigations.length, 0)
    f.session.authenticated = true; f.session.restoring = false; f.flush()
    if (restoreBeforeReady) { assert.equal(f.navigations.length, 0); f.hooks.ready() }
    f.hooks.show(); f.flush()
    assert.deepEqual(f.navigations.map(item => item.url), ['/pages/home/home'])
  }
})

check('missing or expired remembered sessions reveal login and preserve the failure reason', () => {
  for (const error of ['', '登录已失效，请重新登录']) {
    const f = loginPageFixture({ restoring: true }); f.hooks.ready()
    f.session.restoring = false; f.session.loginError = error; f.flush()
    assert.equal(f.page.view.launching.value, false); assert.equal(f.page.view.errorText.value, error)
    assert.equal(f.navigations.length, 0)
  }
})

check('successful password login goes directly home and clears the submitted password', () => {
  const f = loginPageFixture(); f.hooks.ready()
  f.page.view.username.value = 'fixture-user'; f.page.view.password.value = 'fixture-only'
  f.page.signIn(); f.flush(); f.hooks.show()
  assert.equal(f.loginCount(), 1); assert.equal(f.page.view.password.value, '')
  assert.deepEqual(f.navigations.map(item => item.url), ['/pages/home/home'])
})

check('failed home navigation can be retried without showing login inputs for an authenticated user', () => {
  const f = loginPageFixture({ authenticated: true }); f.hooks.ready()
  f.navigations[0].fail({}); assert.equal(f.page.view.launching.value, true)
  assert.match(f.page.view.errorText.value, /无法打开首页/)
  f.page.home(); assert.equal(f.navigations.length, 2)
})

check('unfinished logout can be retried on login and blocks password submission until cleared', () => {
  const f = loginPageFixture({ logoutState: 'failed', logoutError: '退出未完成' }); f.hooks.ready()
  f.page.view.username.value = 'fixture-user'; f.page.view.password.value = 'fixture-only'
  assert.equal(f.page.view.logoutPending.value, true); assert.equal(f.page.view.errorText.value, '退出未完成')
  f.page.signIn(); assert.equal(f.loginCount(), 0)
  f.page.retryLogout(); assert.equal(f.logoutCount(), 1)
  f.session.logoutState = 'clearing'; f.page.retryLogout(); assert.equal(f.logoutCount(), 1)
  f.session.logoutState = 'done'; f.session.logoutError = ''
  assert.equal(f.page.view.logoutPending.value, false); assert.equal(f.page.view.errorText.value, '')
  f.page.signIn(); assert.equal(f.loginCount(), 1)
})

check('config validates official HTTPS and the exact isolated Android DEV combination', () => {
  const production = configFixture({})
  assert.equal(production.environmentReady(), true)
  assert.equal(production.appEnvironment.environment, 'production')
  assert.equal(production.serviceOrigin(production.appEnvironment.issuer), production.appEnvironment.gatewayOrigin)
  const devValues = { environment: 'development', gatewayOrigin: 'http://localhost:26880', issuer: 'http://localhost:26881', clientId: 'rigour-sales-app-android-dev', redirectUri: 'uniappx://rigour-sales/auth/callback' }
  const dev = configFixture(devValues)
  assert.equal(dev.environmentReady(), true)
  const f = fixture(); assert.equal(f.config.environmentReady(), true)
  for (const change of [{ clientId: '' }, { gatewayOrigin: 'http://gateway.example.test' }, { issuer: 'https://iam.example.test?token=x' }, { redirectUri: 'other://callback' }]) {
    const c = configFixture({ ...f.env, ...change }); assert.equal(c.environmentReady(), false)
  }
  for (const change of [{ environment: 'production' }, { issuer: 'http://localhost:27682' }, { gatewayOrigin: 'http://localhost:26880.attacker.test' }]) {
    const c = configFixture({ ...devValues, ...change }); assert.equal(c.environmentReady(), false)
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

check('iOS uses native PKCE for company sign-in', () => {
  const f = fixture({ ios: true })
  const request = f.start()
  assert.equal(request.dataType, 'string')
  const exchange = f.authorize()
  assert.equal(exchange.dataType, 'string')
  const verifier = new URLSearchParams(exchange.data).get('code_verifier')
  assert.match(request.data.state, /^[A-Za-z0-9_-]{43}$/)
  assert.notEqual(request.data.state, verifier)
  assert.equal(request.data.codeChallengeMethod, 'S256')
  assert.equal(request.data.codeChallenge, crypto.createHash('sha256').update(verifier).digest('base64url'))
})

check('login is single flight and secure clearing completes before credentials are sent', () => {
  const f = fixture(); f.begin(); f.begin()
  assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 1); assert.match(f.errors[0], /正在处理登录/)
  f.performSecure('clear'); assert.equal(f.requests.length, 1)
  f.begin(); assert.equal(f.requests.length, 1); assert.equal(f.secure.length, 0)
})

check('keeping login restores after restart without asking for a password', () => {
  const f = fixture(); f.login()
  const restarted = fixture({ metadata: f.metadata, vault: f.vault })
  restarted.api.restoreCompanySession(); restarted.performSecure('read'); restarted.performSecure('clear')
  restarted.exchange({ refresh_token: 'restarted-refresh' }); restarted.profile(); restarted.performSecure('write')
  assert.equal(restarted.session.authenticated, true)
  assert.equal(restarted.last('/native-app/login'), undefined)
  assert.equal(restarted.persisted.refreshToken, 'restarted-refresh')
})

check('unchecked login removes an older saved session and keeps refreshes in memory only', () => {
  const f = fixture(); f.persisted = f.saved()
  f.begin('sales-user', 'fixture password', false); f.performSecure('clear')
  f.authorize(); f.exchange(); f.profile()
  assert.equal(f.completed, 1); assert.equal(f.session.authenticated, true); assert.equal(f.persisted, null)
  const tokens = []
  f.api.ensureAccessToken(true, token => tokens.push(token), message => assert.fail(message)); f.performSecure('clear')
  f.exchange({ access_token: 'memory-access', refresh_token: 'memory-refresh' }); f.profile()
  assert.deepEqual(tokens, ['memory-access']); assert.equal(f.secure.length, 0)
  assert.equal(f.secureHistory.some(operation => operation.kind === 'write'), false)
  const restarted = fixture({ metadata: f.metadata, vault: f.vault })
  restarted.api.restoreCompanySession(); restarted.performSecure('read')
  assert.equal(restarted.session.authenticated, false); assert.equal(restarted.requests.length, 0)
})

check('a rejected concurrent login cannot change the active persistence choice', () => {
  for (const remember of [false, true]) {
    const f = fixture(); f.begin('sales-user', 'fixture password', remember)
    f.begin('another-user', 'another password', !remember)
    f.performSecure('clear'); f.authorize(); f.exchange(); f.profile()
    if (remember) f.performSecure('write')
    assert.equal(f.completed, 1); assert.equal(f.persisted != null, remember)
  }
})

function preferenceFixture() {
  const config = configFixture({}), storage = new Map()
  const parser = runModule(fs.readFileSync(path.join(services, 'json.uts'), 'utf8'), { JSON: { parse: text => new Obj(JSON.parse(text)) } })
  const api = runModule(fs.readFileSync(path.join(services, 'login-preferences.uts'), 'utf8'), {
    require: name => ({ './config.uts': config, './json.uts': parser })[name],
    uni: { getStorageSync: key => storage.get(key) ?? '', setStorageSync: (key, value) => storage.set(key, value) },
  })
  return { api, storage, env: config.appEnvironment }
}

check('login preferences default on, prefill the account, and clear it when unchecked', () => {
  const f = preferenceFixture()
  assert.equal(f.api.readLoginPreference().rememberLogin, true)
  f.api.saveLoginPreference(' sales-user ', true)
  assert.equal(f.api.readLoginPreference().username, 'sales-user')
  assert.deepEqual(Object.keys(JSON.parse([...f.storage.values()][0])).sort(), ['rememberLogin', 'username'])
  f.api.saveLoginPreference('sales-user', false)
  assert.equal(f.api.readLoginPreference().rememberLogin, false); assert.equal(f.api.readLoginPreference().username, '')
  assert.equal(JSON.stringify([...f.storage]).includes('sales-user'), false)
})

check('account preferences are isolated by environment, issuer, and client', () => {
  for (const field of ['environment', 'issuer', 'clientId']) {
    const f = preferenceFixture(); f.api.saveLoginPreference('sales-user', true)
    const original = f.env[field]; f.env[field] = 'other'
    assert.equal(f.api.readLoginPreference().username, '')
    f.env[field] = original; assert.equal(f.api.readLoginPreference().username, 'sales-user')
  }
  const f = preferenceFixture(); f.api.saveLoginPreference('sales-user', true)
  f.storage.set([...f.storage.keys()][0], 'broken-json')
  assert.equal(f.api.readLoginPreference().username, '')
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

check('verified user and tenant display information belong to the in-memory session and clear on invalidation', () => {
  const f = fixture(); f.start(); f.authorize(); f.exchange()
  f.profile({tenantName: '测试企业', roles: ['SALES'], permissions: ['order:read']}); f.performSecure('write')
  assert.equal(f.session.tenantName, '测试企业'); assert.deepEqual(Array.from(f.session.roles), ['SALES'])
  assert.equal(f.session.displayName, '销售'); assert.equal(f.session.userId, 'u1')
  assert.equal('roles' in f.persisted, false); assert.equal('permissions' in f.persisted, false)
  f.api.invalidateCompanySession('会话失效')
  assert.equal(f.session.tenantName, ''); assert.equal(f.session.roles.length, 0); assert.equal(f.session.displayName, '')
})

check('refresh replaces session roles and tenant display information with current IAM values', () => {
  const f = fixture(); f.login(); f.advance(1000000)
  f.api.ensureAccessToken(false, () => {}, message => assert.fail(message))
  f.performSecure('clear'); f.exchange({access_token: 'access-2', refresh_token: 'refresh-2'})
  f.profile({tenantName: '企业新名称', roles: [], permissions: []}); f.performSecure('write')
  assert.equal(f.session.tenantName, '企业新名称'); assert.equal(f.session.roles.length, 0); assert.equal(f.session.permissions.length, 0)
})

check('offline startup retains the unconsumed credential and restores when connected', () => {
  const f = fixture(); f.persisted = f.saved(); f.faults.offline = true
  f.api.restoreCompanySession(); f.performSecure('read')
  assert.equal(f.persisted.refreshToken, 'fixture-saved-refresh')
  assert.equal(f.requests.length, 0); assert.equal(f.secure.length, 0)
  assert.equal(f.session.restoring, false); assert.equal(f.session.authenticated, false)
  f.faults.offline = false; f.api.restoreCompanySession(); f.api.restoreCompanySession()
  f.performSecure('read'); f.performSecure('clear')
  assert.equal(f.requests.length, 1)
  f.exchange({ refresh_token: 'online-refresh' }); f.profile(); f.performSecure('write')
  assert.equal(f.session.authenticated, true); assert.equal(f.persisted.refreshToken, 'online-refresh')
})

check('offline renewal does not log out the active user or consume the refresh token', () => {
  const f = fixture(); f.login(); f.advance(900000); f.faults.offline = true
  const failures = []; f.api.ensureAccessToken(false, () => assert.fail('offline'), error => failures.push(error))
  assert.equal(f.session.authenticated, true); assert.equal(f.persisted.refreshToken, 'fixture-refresh-1')
  assert.equal(f.secure.length, 0); assert.equal(failures.length, 1)
  f.faults.offline = false; f.api.ensureAccessToken(false, () => {}, () => assert.fail('online'))
  f.performSecure('clear'); assert.match(f.last('/oauth2/token').data, /fixture-refresh-1/)
})

check('failed network-state detection retains the saved credential', () => {
  const f = fixture(); f.persisted = f.saved(); f.faults.networkCheckFails = true
  f.api.restoreCompanySession(); f.performSecure('read')
  assert.equal(f.requests.length, 0); assert.equal(f.persisted.refreshToken, 'fixture-saved-refresh')
  assert.equal(f.session.restoring, false)
})

check('logout invalidates a delayed network preflight before renewal can send', () => {
  const f = fixture(); f.persisted = f.saved(); f.faults.deferNetworkCheck = true
  f.api.restoreCompanySession(); f.performSecure('read'); f.api.logoutCompany(); f.performSecure('clear')
  f.networkChecks[0].success({ networkType: 'wifi' })
  assert.equal(f.requests.length, 0); assert.equal(f.persisted, null); assert.equal(f.session.authenticated, false)
})
