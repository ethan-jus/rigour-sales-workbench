// Pure parser tests. Native UTS compilation and live HTTP validation remain separate.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')
const source = fs.readFileSync(path.resolve(__dirname, '../app/services/json.uts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])
const parserModule = { exports: {} }
new Function('exports', 'module', compiled.outputText)(parserModule.exports, parserModule)
const { parseApiJson } = parserModule.exports

test('safe boundaries remain numbers and larger signed integers retain every digit', () => {
  assert.deepEqual(parseApiJson('{"safe":9007199254740991,"min":-9007199254740991,"big":9007199254740992,"negative":-9007199254740993,"long":9223372036854775807}'), {
    safe: 9007199254740991, min: -9007199254740991, big: '9007199254740992', negative: '-9007199254740993', long: '9223372036854775807',
  })
})

test('nested object and array values retain large identifiers with null and booleans', () => {
  assert.deepEqual(parseApiJson('{"data":{"items":[{"id":9007199254740993},-9223372036854775808,[9007199254740994,null,true,false]]}}'), {
    data: { items: [{ id: '9007199254740993' }, '-9223372036854775808', ['9007199254740994', null, true, false]] },
  })
})

test('existing strings, escaped quotes, backslashes, unicode and escaped newlines are unchanged', () => {
  const data = { text: '9007199254740993 "quoted" \\path\n换行', name: 'line\nnext', numeric: '-9223372036854775808', key: '\u4e2d文' }
  assert.deepEqual(parseApiJson(JSON.stringify(data)), data)
  assert.deepEqual(parseApiJson('{"\\\"9007199254740993":9007199254740993}'), { '"9007199254740993': '9007199254740993' })
})

test('ordinary numbers, decimal and exponent semantics remain JSON numeric values', () => {
  const input = '{"zero":0,"negativeZero":-0,"integer":42,"decimal":12.5,"largeDecimal":9007199254740993.0,"exponent":9.007199254740993e15,"negativeExponent":-1.5E-2}'
  assert.deepEqual(parseApiJson(input), JSON.parse(input))
  assert.equal(Object.is(parseApiJson(input).negativeZero, -0), true)
})

test('multiline formatting and escaped strings around large values are valid', () => {
  const input = '{\n\t"value" : 9007199254740993,\r\n"text": "line\\nnext\\\"quote",\n"array":[1, 9007199254740995]\n}'
  assert.deepEqual(parseApiJson(input), { value: '9007199254740993', text: 'line\nnext"quote', array: [1, '9007199254740995'] })
})

test('malformed JSON is rejected and never repaired by large-number rewriting', () => {
  const malformed = [
    '{', '{} trailing', '\ufeff{}', '\u00a0{}', '{}\u00a0', '{"id":}', '{"id":9007199254740993,}',
    '{9007199254740993:1}', '{"x":1,9007199254740993:2}',
    '{"id":09007199254740993}', '{"id":-09007199254740993}',
    '{"id":+9007199254740993}', '{"id":--9007199254740993}',
    '{"id":9007199254740993.}', '{"id":9007199254740993e}',
    '{"id":NaN}', '{"id":Infinity}', '{"a":[1 9007199254740993]}',
    '{"a":"raw\nnewline"}', '{"a":"unterminated}', '{"a":"invalid\\xescape"}',
    '{"a":[9007199254740993}', '{"a":9007199254740993] }',
  ]
  for (const value of malformed) assert.equal(parseApiJson(value), null, value)
})

test('only an object is accepted as the API response root', () => {
  for (const value of ['', '[]', '[{}]', 'null', 'true', 'false', '42', '9007199254740993', '"text"']) assert.equal(parseApiJson(value), null)
  assert.deepEqual(parseApiJson(' \n{}\t '), {})
})

test('integer preservation does not depend on native number or long capacity', () => {
  const digits = '9'.repeat(400)
  assert.deepEqual(parseApiJson('{"id":' + digits + ',"negative":-' + digits + '}'), { id: digits, negative: '-' + digits })
})

test('large paginated payload preserves text and every long identifier across unchanged spans', () => {
  const text = '客户订单中文说明\\"[]:12345678901234567890'.repeat(300)
  const payload = '{"items":[' + Array.from({ length: 40 }, (_, i) => '{"id":92233720368547758' + String(i).padStart(2, '0') + ',"text":' + JSON.stringify(text) + ',"amount":12.5}').join(',') + ']}'
  const result = parseApiJson(payload)
  assert.equal(result.items.length, 40)
  for (let i = 0; i < 40; i++) {
    assert.equal(result.items[i].id, '92233720368547758' + String(i).padStart(2, '0'))
    assert.equal(result.items[i].text, text)
    assert.equal(result.items[i].amount, 12.5)
  }
})
