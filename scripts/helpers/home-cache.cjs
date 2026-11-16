const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { watch, ref } = require('vue')
const jsonGetters = `
Object.defineProperties(Object.prototype, {
  getString: { value: function(k) { return typeof this[k] === 'string' ? this[k] : null } },
  getNumber: { value: function(k) { return typeof this[k] === 'number' ? this[k] : null } },
  getJSON: { value: function(k) { return this[k] != null && typeof this[k] === 'object' && !Array.isArray(this[k]) ? this[k] : null } },
  getArray: { value: function(k) { return Array.isArray(this[k]) ? this[k] : null } }
})`
function cacheFixture(session, options = {}) {
  const storage = options.storage ?? new Map()
  const environment = options.environment ?? {environment: 'development', gatewayOrigin: 'http://localhost:26880', issuer: 'http://localhost:26881', clientId: 'dev'}
  let now = options.now ?? Date.now()
  const context = { exports: {}, Date: {now: () => now}, uni: {
    getStorageSync: key => { if (options.storageFailure) throw new Error('storage'); return storage.get(key) },
    setStorageSync: (key, value) => { if (options.storageFailure) throw new Error('storage'); storage.set(key, value) },
    removeStorageSync: key => storage.delete(key)
  }, require: name => ({
    vue: {watch, ref}, './session.uts': {session}, './config.uts': {appEnvironment: environment},
    './json.uts': {parseApiJson: text => {try { return vm.runInContext('JSON.parse(' + JSON.stringify(text) + ')', context) } catch { return null } }}
  }[name]) }
  vm.createContext(context)
  vm.runInContext(jsonGetters, context)
  const source = fs.readFileSync(path.join(__dirname, '../../app/services/home-cache.uts'), 'utf8')
  vm.runInContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, context)
  return { ...context.exports, storage, environment, advance: ms => now += ms,
    data: value => vm.runInContext('JSON.parse(' + JSON.stringify(JSON.stringify(value)) + ')', context) }
}
module.exports = {cacheFixture, jsonGetters}
