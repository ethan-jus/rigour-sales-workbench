// Executes the actual UTS control flow with native API doubles and real Node AES-GCM.
// Android Keystore, AtomicFile, and native thread behavior still need device acceptance.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const test = require('node:test')
const ts = require('typescript')

function sourceFor(android) {
  let enabled = true
  const stack = []
  return fs.readFileSync(path.join(__dirname, '../app/services/secure-session.uts'), 'utf8').split('\n').filter(line => {
    const match = line.match(/\/\/ #(ifdef|ifndef) APP-ANDROID/)
    if (match) { stack.push(enabled); enabled = enabled && (match[1] === 'ifdef' ? android : !android); return false }
    if (line.includes('// #endif')) { enabled = stack.pop(); return false }
    return enabled
  }).join('\n')
}

function fixture({ android = true, sdk = 35 } = {}) {
  let thread = 'main'
  const io = [], main = [], files = new Map(), keys = new Map(), errors = [], results = [], faults = {}
  const env = { environment: 'development', issuer: 'https://login.example.test', clientId: 'sales-android' }
  const assertIO = () => assert.equal(thread, 'io')
  const bytes = value => {
    const result = Buffer.from(value)
    Object.defineProperty(result, 'size', { get: () => result.length })
    return result
  }
  class File {
    constructor(parent, child) { this.path = child == null ? parent : parent + '/' + child }
    exists() { assertIO(); return files.has(this.path) }
    getPath() { return this.path }
  }
  class AtomicFile {
    constructor(file) { this.file = file }
    getBaseFile() { return this.file }
    readFully() {
      assertIO()
      if (files.has(this.file.path + '.bak')) files.set(this.file.path, files.get(this.file.path + '.bak'))
      return bytes(files.get(this.file.path))
    }
    startWrite() {
      assertIO()
      if (faults.startWrite) throw new Error('private native failure')
      return { data: null, write(data) { this.data = bytes(data) } }
    }
    finishWrite(output) {
      assertIO()
      if (faults.finishWrite) throw new Error('private native failure')
      files.set(this.file.path, output.data)
    }
    failWrite() { assertIO(); faults.rolledBack = true }
    delete() {
      assertIO()
      if (faults.deleteFile) return
      for (const suffix of ['', '.bak', '.new']) files.delete(this.file.path + suffix)
    }
  }
  class Builder {
    constructor(id, purposes) { this.id = id; this.purposes = purposes }
    setKeySize(value) { assert.equal(value, 256); return this }
    setBlockModes(value) { assert.equal(value, 'GCM'); return this }
    setEncryptionPaddings(value) { assert.equal(value, 'NoPadding'); return this }
    setRandomizedEncryptionRequired(value) { assert.equal(value, true); return this }
    build() { return this }
  }
  const store = {
    load() { assertIO() }, containsAlias(id) { assertIO(); return keys.has(id) },
    getKey(id) { assertIO(); return keys.get(id) },
    deleteEntry(id) { assertIO(); if (faults.deleteKey) throw new Error('private native failure'); keys.delete(id) },
  }
  const native = {
    'android.os.Build': { VERSION: { SDK_INT: sdk } },
    'android.util.AtomicFile': AtomicFile,
    'android.util.Base64': {
      URL_SAFE: 8, NO_WRAP: 2, NO_PADDING: 1,
      encodeToString: (value, flags) => Buffer.from(value).toString(flags & 8 ? 'base64url' : 'base64'),
      decode: value => bytes(Buffer.from(value, 'base64')),
    },
    'android.security.keystore.KeyGenParameterSpec': { Builder },
    'android.security.keystore.KeyProperties': { KEY_ALGORITHM_AES: 'AES', PURPOSE_ENCRYPT: 1, PURPOSE_DECRYPT: 2, BLOCK_MODE_GCM: 'GCM', ENCRYPTION_PADDING_NONE: 'NoPadding' },
    'java.io.File': File, 'java.lang.Runnable': class {},
    'java.security.KeyStore': { getInstance(name) { assertIO(); assert.equal(name, 'AndroidKeyStore'); return store } },
    'java.security.MessageDigest': { getInstance(name) { assertIO(); assert.equal(name, 'SHA-256'); return { digest: value => bytes(crypto.createHash('sha256').update(value).digest()) } } },
    'java.util.concurrent.Executors': { newSingleThreadExecutor: () => ({ execute: task => io.push(() => task.run()) }) },
    'javax.crypto.KeyGenerator': { getInstance(algorithm, provider) {
      assertIO(); assert.equal(algorithm, 'AES'); assert.equal(provider, 'AndroidKeyStore')
      return { init(spec) { this.spec = spec }, generateKey() { const key = crypto.randomBytes(32); keys.set(this.spec.id, key); return key } }
    } },
    'javax.crypto.spec.GCMParameterSpec': class { constructor(bits, iv) { assert.equal(bits, 128); this.iv = iv } },
    'javax.crypto.Cipher': { ENCRYPT_MODE: 1, DECRYPT_MODE: 2, getInstance(algorithm) {
      assertIO(); assert.equal(algorithm, 'AES/GCM/NoPadding')
      return {
        init(mode, key, spec) { this.mode = mode; this.iv = spec?.iv ?? crypto.randomBytes(12); this.key = key },
        updateAAD(aad) { this.aad = aad }, getIV() { return this.iv },
        doFinal(data) {
          assertIO()
          if (this.mode === 1) {
            const cipher = crypto.createCipheriv('aes-256-gcm', this.key, this.iv)
            cipher.setAAD(this.aad)
            return bytes(Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]))
          }
          const cipher = crypto.createDecipheriv('aes-256-gcm', this.key, this.iv)
          cipher.setAAD(this.aad); cipher.setAuthTag(data.subarray(-16))
          return bytes(Buffer.concat([cipher.update(data.subarray(0, -16)), cipher.final()]))
        },
      }
    } },
    'kotlin.text.Charsets': { UTF_8: 'utf8' },
  }
  const compiled = ts.transpileModule(sourceFor(android), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, reportDiagnostics: true })
  assert.deepEqual(compiled.diagnostics, [])
  const context = vm.createContext({
    exports: {}, toNativeBytes: value => bytes(Buffer.from(value)),
    require: name => name === './config.uts' ? { appEnvironment: env } : native[name],
    setTimeout: action => main.push(action),
    UTSAndroid: {
      getAppContext: () => ({ getNoBackupFilesDir: () => '/private/no_backup' }),
      getDispatcher(name) { assert.equal(name, 'main'); return { async: action => main.push(action) } },
    },
  })
  vm.runInContext(`String.prototype.toByteArray = function() { return toNativeBytes(String(this)) }; JSON.parseObject = function(text) { const value = JSON.parse(text); return { getString: function(key) { return typeof value[key] === 'string' ? value[key] : null } } }`, context)
  vm.runInContext(compiled.outputText, context)
  const runIO = () => { thread = 'io'; while (io.length) io.shift()(); thread = 'main' }
  const runMain = () => { assert.equal(thread, 'main'); while (main.length) main.shift()() }
  const fail = message => { assert.equal(thread, 'main'); errors.push(message) }
  const success = value => { assert.equal(thread, 'main'); results.push(value) }
  const value = overrides => ({ refreshToken: 'fixture-refresh-secret', issuer: env.issuer, clientId: env.clientId, userId: 'user-1', tenantId: 'tenant-1', ...overrides })
  return { api: context.exports, env, files, keys, faults, errors, results, value, fail, success, io, main, runIO, runMain, drain() { runIO(); runMain() } }
}

test('absent file returns null asynchronously without creating a key', () => {
  const f = fixture(); f.api.readSecureSession(f.success, f.fail)
  assert.equal(f.results.length, 0); f.runIO(); assert.equal(f.results.length, 0); f.runMain()
  assert.deepEqual(f.results, [null]); assert.equal(f.keys.size, 0)
})

test('round trip encrypts a validated identity and only invokes callbacks on main', () => {
  const f = fixture(); f.api.writeSecureSession(f.value(), f.success, f.fail); f.drain()
  assert.equal(f.errors.length, 0); assert.equal(f.keys.size, 1)
  const [filename, ciphertext] = [...f.files][0]
  assert.match(filename, /^\/private\/no_backup\/rigour-sales-session-/)
  for (const value of ['fixture-refresh-secret', 'user-1', 'tenant-1']) assert.equal(ciphertext.includes(value), false)
  f.api.readSecureSession(f.success, f.fail); f.drain()
  assert.deepEqual(JSON.parse(JSON.stringify(f.results.at(-1))), f.value())
})

test('queued save then logout erases the saved ciphertext and key before any later read', () => {
  const f = fixture()
  f.api.writeSecureSession(f.value(), () => f.results.push('write'), f.fail)
  f.api.clearSecureSession(() => f.results.push('clear'), f.fail)
  f.api.readSecureSession(f.success, f.fail)
  assert.equal(f.io.length, 3); f.drain()
  assert.deepEqual(f.results, ['write', 'clear', null]); assert.equal(f.files.size, 0); assert.equal(f.keys.size, 0)
})

test('failed atomic replacement preserves the prior encrypted session', () => {
  const f = fixture(); f.api.writeSecureSession(f.value(), f.success, f.fail); f.drain()
  f.faults.finishWrite = true
  f.api.writeSecureSession(f.value({ refreshToken: 'replacement-secret' }), f.success, f.fail); f.drain()
  assert.equal(f.faults.rolledBack, true); assert.match(f.errors[0], /无法安全保存/)
  f.api.readSecureSession(f.success, f.fail); f.drain()
  assert.equal(f.results.at(-1).refreshToken, 'fixture-refresh-secret')
})

test('tampered ciphertext and missing key fail closed with a fixed security message', () => {
  for (const corrupt of ['ciphertext', 'key', 'envelope']) {
    const f = fixture(); f.api.writeSecureSession(f.value(), f.success, f.fail); f.drain()
    const [filename, content] = [...f.files][0]
    if (corrupt === 'key') f.keys.clear()
    else if (corrupt === 'envelope') f.files.set(filename, Buffer.from('invalid'))
    else { const parts = content.toString().split('\n'); const data = Buffer.from(parts[2], 'base64'); data[0] ^= 1; parts[2] = data.toString('base64'); f.files.set(filename, Buffer.from(parts.join('\n'))) }
    f.results.length = 0; f.api.readSecureSession(f.success, f.fail); f.drain()
    assert.deepEqual(f.results, []); assert.deepEqual(f.errors, ['已保存的登录信息无法通过安全校验，请重新登录。'])
  }
})

test('environment and issuer/client namespaces isolate files and keys', () => {
  const f = fixture(); f.api.writeSecureSession(f.value(), f.success, f.fail); f.drain()
  for (const field of ['environment', 'issuer', 'clientId']) {
    const old = f.env[field]; f.env[field] += '-other'
    f.api.readSecureSession(f.success, f.fail); f.drain(); assert.equal(f.results.at(-1), null)
    f.api.clearSecureSession(f.success, f.fail); f.drain(); assert.equal(f.files.size, 1)
    f.env[field] = old
  }
  f.api.readSecureSession(f.success, f.fail); f.drain(); assert.equal(f.results.at(-1).userId, 'user-1')
})

test('invalid identities cannot be persisted and queued payload is an immutable snapshot', () => {
  const f = fixture()
  for (const overrides of [{ refreshToken: '' }, { issuer: 'https://other.test' }, { clientId: 'other' }, { userId: '' }, { tenantId: '' }]) {
    f.api.writeSecureSession(f.value(overrides), f.success, f.fail); f.drain()
  }
  assert.equal(f.errors.length, 5); assert.equal(f.files.size, 0); assert.equal(f.keys.size, 0)
  const value = f.value(); f.api.writeSecureSession(value, f.success, f.fail); value.refreshToken = 'changed'; f.drain()
  f.api.readSecureSession(f.success, f.fail); f.drain(); assert.equal(f.results.at(-1).refreshToken, 'fixture-refresh-secret')
})

test('partial clearing reports failure while still attempting both erasures', () => {
  for (const fault of ['deleteFile', 'deleteKey']) {
    const f = fixture(); f.api.writeSecureSession(f.value(), f.success, f.fail); f.drain()
    f.faults[fault] = true; f.results.length = 0
    f.api.clearSecureSession(f.success, f.fail); f.drain()
    assert.deepEqual(f.results, []); assert.match(f.errors[0], /无法完全清除/)
    if (fault === 'deleteFile') assert.equal(f.keys.size, 0)
    else assert.equal(f.files.size, 0)
  }
})

test('unsupported platforms and Android before API 23 have asynchronous explicit failure', () => {
  for (const options of [{ android: false }, { sdk: 22 }]) {
    const f = fixture(options); assert.equal(f.api.secureSessionSupported(), false)
    f.api.readSecureSession(f.success, f.fail); f.api.writeSecureSession(f.value(), f.success, f.fail); f.api.clearSecureSession(f.success, f.fail)
    assert.equal(f.errors.length, 0); f.drain()
    assert.equal(f.errors.length, 3); assert.equal(f.results.length, 0); assert.equal(f.files.size, 0); assert.equal(f.keys.size, 0)
  }
})
