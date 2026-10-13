// API mock state tests only. This does not compile UTS to native code, exercise
// microphones/GPS, or establish background recording and crash recovery support.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const appRoot = path.resolve(__dirname, '../app')
const flushCallbacks = () => new Promise((resolve) => setImmediate(resolve))

function selectAppBranch(source, app) {
  const active = [true]
  return source.split('\n').filter((line) => {
    const directive = line.match(/^\s*\/\/ #(ifdef|ifndef) APP$/)
    if (directive) {
      active.push(active.at(-1) && (directive[1] === 'ifdef' ? app : !app))
      return false
    }
    if (line.match(/^\s*\/\/ #endif$/)) { active.pop(); return false }
    return active.at(-1)
  }).join('\n')
}

function loadService(name, app, uni, clock = Date) {
  const source = selectAppBranch(fs.readFileSync(path.join(appRoot, 'services', name), 'utf8'), app)
  const result = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  assert.deepEqual(result.diagnostics, [], 'UTS-compatible TypeScript syntax check')
  const module = { exports: {} }
  new Function('exports', 'module', 'uni', 'Date', result.outputText)(module.exports, module, uni, clock)
  return module.exports
}

function harness() {
  const handlers = new Map()
  const removed = []
  const files = new Map()
  const copies = []
  const writes = []
  let now = 10000
  let startOptions = null
  let startCount = 0
  let stopCount = 0
  const recorder = {
    start: (options) => { startOptions = options; startCount += 1 },
    pause() {}, resume() {}, stop: () => { stopCount += 1 },
  }
  for (const event of ['Start', 'Pause', 'Resume', 'Stop', 'Error', 'InterruptionBegin', 'InterruptionEnd']) {
    recorder['on' + event] = (callback) => handlers.set(event, [...(handlers.get(event) || []), callback])
    recorder['off' + event] = () => { removed.push(event); handlers.delete(event) }
  }
  const fileSystem = {
    access: (options) => queueMicrotask(() => {
      if (options.path === '/data/rigour-capture' || files.has(options.path)) options.success({})
      else options.fail({ errMsg: 'File missing' })
    }),
    mkdir: (options) => queueMicrotask(() => options.success({})),
    copyFile: (options) => copies.push(options),
    writeFile: (options) => writes.push(options),
    readdir: (options) => queueMicrotask(() => options.success({ files: [...files.keys()].map((name) => path.basename(name)) })),
    readFile: (options) => queueMicrotask(() => options.success({ data: files.get(options.filePath) })),
  }
  const service = loadService('capture.uts', true, {
    env: { USER_DATA_PATH: '/data' },
    getRecorderManager: () => recorder,
    getFileSystemManager: () => fileSystem,
  }, { now: () => now })
  const states = []
  const session = service.createCaptureSession((state) => states.push(state))
  return {
    service, session, states, files, removed, copies, writes,
    setTime: (value) => { now = value },
    getStartOptions: () => startOptions,
    getStartCount: () => startCount,
    getStopCount: () => stopCount,
    getListeners: (name) => [...(handlers.get(name) || [])],
    event: (name, result = {}) => [...(handlers.get(name) || [])].forEach((callback) => callback(result)),
    completeCopy: (error = null) => {
      const request = copies.shift()
      assert.ok(request, 'copy request exists')
      if (error) request.fail({ errMsg: error })
      else { files.set(request.destPath, 'mock audio bytes'); request.success({}) }
    },
    completeWrite: (error = null) => {
      const request = writes.shift()
      assert.ok(request, 'metadata request exists')
      if (error) request.fail({ errMsg: error })
      else { files.set(request.filePath, request.data); request.success({}) }
    },
  }
}

async function stopWithFile(h) {
  h.session.stop()
  h.event('Stop', { tempFilePath: '/tmp/capture.aac' })
  await flushCallbacks()
}

test('Web preview never calls native APIs or reports a successful recording', () => {
  const inaccessible = new Proxy({}, { get() { assert.fail('Web branch accessed a native API') } })
  const recording = loadService('capture.uts', false, inaccessible).createCaptureSession(() => {})
  recording.start()
  assert.equal(recording.snapshot().phase, 'unsupported')
  let error = ''
  loadService('location.uts', false, inaccessible).requestDeviceLocation(assert.fail, (message) => { error = message })
  assert.match(error, /浏览器/)
})

test('location requests WGS84 and distinguishes callback receipt from missing accuracy', () => {
  let request
  let now = 1000
  const service = loadService('location.uts', true, { getLocation: (value) => { request = value } }, { now: () => now })
  let result
  service.requestDeviceLocation((value) => { result = value }, assert.fail)
  assert.equal(request.provider, 'system')
  assert.equal(request.type, 'wgs84')
  assert.equal(request.geocode, false)
  now = 4000
  request.success({ latitude: 31, longitude: 121, accuracy: 0 })
  assert.equal(result.accuracy, null)
  assert.equal(result.requestedAt, 1000)
  assert.equal(result.receivedAt, 4000)
  let invalid = ''
  service.requestDeviceLocation(assert.fail, (value) => { invalid = value })
  request.success({ latitude: 91, longitude: 121, accuracy: 10 })
  assert.match(invalid, /无效坐标/)
})

test('saved receipt follows asynchronous file and metadata writes; pauses do not count', async () => {
  const h = harness()
  h.session.start(); h.event('Start')
  assert.equal(h.getStartOptions().duration, 7200000)
  assert.equal(h.getStartOptions().format, 'aac')
  h.setTime(11000); h.event('Pause')
  h.setTime(21000); h.event('Resume')
  h.setTime(23000)
  await stopWithFile(h)
  assert.equal(h.session.snapshot().activeDurationEstimateMs, 3000)
  assert.equal(h.session.snapshot().phase, 'saving')
  h.completeCopy()
  assert.equal(h.session.snapshot().phase, 'saving')
  assert.ok(h.states.every((state) => state.phase !== 'saved'))
  h.completeWrite()
  assert.equal(h.session.snapshot().phase, 'saved')
  assert.equal(h.session.snapshot().temporaryPath, '')
  let clips
  h.service.loadSavedClips((value) => { clips = value }, assert.fail)
  await flushCallbacks()
  assert.equal(clips.length, 1)
  assert.equal(clips[0].activeDurationEstimateMs, 3000)
  assert.equal(h.service.savedClipPath(clips[0]), h.session.snapshot().savedPath)
})

test('an interruption does not claim automatic resume or count interrupted time', () => {
  const h = harness()
  h.session.start(); h.event('Start')
  h.setTime(11000); h.event('InterruptionBegin')
  h.setTime(30000); h.event('InterruptionEnd')
  assert.equal(h.session.snapshot().phase, 'interrupted')
  assert.equal(h.session.snapshot().activeDurationEstimateMs, 1000)
  h.session.resume()
  assert.equal(h.session.snapshot().phase, 'interrupted', 'resume waits for the native event')
  h.event('Resume')
  h.setTime(31000)
  assert.equal(h.session.snapshot().activeDurationEstimateMs, 2000)
})

for (const failure of ['copy', 'metadata']) {
  test(`${failure} failure keeps the temporary file and requires successful retry`, async () => {
    const h = harness()
    h.session.start(); h.event('Start')
    await stopWithFile(h)
    h.completeCopy(failure === 'copy' ? 'No space' : null)
    if (failure === 'metadata') h.completeWrite('Index write failed')
    assert.equal(h.session.snapshot().phase, 'save-error')
    assert.equal(h.session.snapshot().temporaryPath, '/tmp/capture.aac')
    assert.ok(h.states.every((state) => state.phase !== 'saved'))
    h.session.retrySave()
    await flushCallbacks()
    h.completeCopy(); h.completeWrite()
    assert.equal(h.session.snapshot().phase, 'saved')
  })
}

test('page disposal stops and saves without notifying dead UI, then removes listeners', async () => {
  const h = harness()
  h.session.start(); h.event('Start')
  const notifications = h.states.length
  h.session.dispose()
  assert.equal(h.getStopCount(), 1)
  h.event('Stop', { tempFilePath: '/tmp/disposed.aac' })
  await flushCallbacks()
  h.completeCopy(); h.completeWrite()
  assert.equal(h.session.snapshot().phase, 'saved')
  assert.equal(h.states.length, notifications)
  assert.equal(h.removed.length, 7)
})

test('quick page re-entry cannot consume the old Stop or remove the new listeners', async () => {
  const h = harness()
  h.session.start(); h.event('Start')
  const queuedOldStart = h.getListeners('Start')[0]
  h.session.dispose()
  const nextStates = []
  const next = h.service.createCaptureSession((state) => nextStates.push(state))
  assert.equal(h.getListeners('Stop').length, 1, 'creating a page must not bind another listener')
  next.start()
  assert.equal(next.snapshot().phase, 'busy')
  assert.equal(h.getStartCount(), 1)
  h.event('Stop', { tempFilePath: '/tmp/old-page.aac' })
  await flushCallbacks()
  assert.equal(next.snapshot().phase, 'busy', 'the old file was not delivered to the new session')
  assert.equal(next.snapshot().temporaryPath, '')
  h.setTime(20000)
  next.start(); h.event('Start')
  assert.equal(h.getStartCount(), 2, 'new recording can start while old file copying completes')
  const stopCount = h.getStopCount()
  queuedOldStart({})
  assert.equal(h.getStopCount(), stopCount, 'a stale disposed callback cannot stop the new owner')
  h.completeCopy(); h.completeWrite()
  assert.equal(h.getListeners('Stop').length, 1)
  assert.equal(next.snapshot().phase, 'recording')
  assert.ok(nextStates.every((state) => state.phase !== 'saved'))
  next.stop(); h.event('Stop', { tempFilePath: '/tmp/new-page.aac' })
  await flushCallbacks()
  h.completeCopy(); h.completeWrite()
  const indexes = [...h.files.entries()].filter(([name]) => name.endsWith('.json')).map(([, value]) => JSON.parse(value))
  assert.equal(indexes.length, 2)
  assert.deepEqual(indexes.map((entry) => entry.createdAt).sort(), [10000, 20000])
  assert.ok(indexes.every((entry) => entry.id.length > 0 && entry.fileName !== '.aac'))
})

test('microphone rejection before Start releases ownership so permission can be retried', () => {
  const h = harness()
  h.session.start()
  h.event('Error', { errCode: 1107601, errMsg: 'Microphone denied' })
  assert.equal(h.session.snapshot().phase, 'error')
  assert.equal(h.getListeners('Stop').length, 0)
  h.session.start(); h.event('Start')
  assert.equal(h.getStartCount(), 2)
  assert.equal(h.session.snapshot().phase, 'recording')
})

test('disposing during Start keeps ownership until a native terminal callback', () => {
  const h = harness()
  h.session.start(); h.session.dispose()
  const next = h.service.createCaptureSession(() => {})
  next.start()
  assert.equal(next.snapshot().phase, 'busy')
  h.event('Start')
  assert.equal(h.getStopCount(), 2, 'late successful Start is stopped by its disposed owner')
  h.event('Stop', { tempFilePath: '' })
  next.start(); h.event('Start')
  assert.equal(next.snapshot().phase, 'recording')
})

test('a corrupt index or missing audio does not hide intact recordings or delete evidence', async () => {
  const h = harness()
  h.session.start(); h.event('Start')
  await stopWithFile(h)
  h.completeCopy(); h.completeWrite()
  const validMetadata = JSON.parse([...h.files.entries()].find(([name]) => name.endsWith('.json'))[1])
  h.files.set('/data/rigour-capture/broken.json', '{broken')
  h.files.set('/data/rigour-capture/missing.json', JSON.stringify({ ...validMetadata, fileName: 'missing.aac' }))
  const before = h.files.size
  let clips
  let warning = ''
  h.service.loadSavedClips((value) => { clips = value }, assert.fail, (message) => { warning = message })
  await flushCallbacks()
  assert.equal(clips.length, 1)
  assert.match(warning, /损坏/)
  assert.match(warning, /不可读取/)
  assert.equal(h.files.size, before)
})
