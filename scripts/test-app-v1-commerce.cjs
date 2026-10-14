// Service-state and contract tests with mocked API/storage only. These do not
// prove native compilation, real IAM permissions, or a successful server order.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const ts = require('typescript')

const source = fs.readFileSync(path.resolve(__dirname, '../app/services/commerce.uts'), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  reportDiagnostics: true,
})
assert.deepEqual(compiled.diagnostics, [])

class JsonObject {
  constructor(value) { this.value = value }
  getString(key) { return typeof this.value[key] === 'string' ? this.value[key] : null }
  getNumber(key) { return typeof this.value[key] === 'number' ? this.value[key] : null }
  getJSON(key) { return this.value[key] == null ? null : new JsonObject(this.value[key]) }
  getArray(key) { return Array.isArray(this.value[key]) ? this.value[key].map(item => new JsonObject(item)) : null }
}
function harness() {
  const files = new Map()
  const requests = []
  const messages = []
  let failStorage = false
  const session = { authenticated: true, tenantId: 'company', userId: 'u1', username: 'sales-one', permissions: ['crm:customer:read', 'erp:product:read', 'order:read'], expiresAt: Date.now() + 3600000 }
  const clearSession = () => Object.assign(session, { authenticated: false, tenantId: '', userId: '', username: '', permissions: [], expiresAt: 0 })
  const requireSession = () => { if (session.authenticated && session.expiresAt > Date.now()) return true; clearSession(); return false }
  const imports = name => {
    if (name === 'vue') return { reactive: value => value }
    if (name === './session.uts') return { session, clearSession, requireSession, hasPermission: value => session.authenticated && session.permissions.includes(value) }
    if (name === './api.uts') return { requestApi: (...args) => requests.push(args) }
    throw new Error(name)
  }
  const uni = {
    getStorageSync: key => files.get(key) ?? '',
    setStorageSync: (key, value) => { if (failStorage) throw new Error('storage full'); files.set(key, value) },
    showToast: value => messages.push(value.title),
  }
  const module = { exports: {} }
  new Function('exports', 'module', 'require', 'uni', compiled.outputText)(module.exports, module, imports, uni)
  return { service: module.exports, session, files, requests, messages, failStorage: value => { failStorage = value } }
}
const customer = (id = '1') => ({ id, name: '客户' + id, contact: '', phone: '', address: '地址' + id, status: 'ACTIVE' })
const product = (id = 'p1', price = 88) => ({ id, name: '商品' + id, sku: id, spec: '', unit: '盒', imageUrl: '', price, stock: null })

test('two customer drafts stay independent and restore from account storage', () => {
  const h = harness(), s = h.service
  assert.equal(s.selectOrderCustomer(customer('1')), true)
  s.addToCart(product(), 3)
  s.saveCheckout('客户一地址', '不要混单')
  s.selectOrderCustomer(customer('2'))
  s.addToCart(product(), 7)
  assert.equal(s.cartQuantity(), 7)
  s.selectOrderCustomer(customer('1'))
  assert.equal(s.cartQuantity(), 3)
  assert.equal(s.currentDraft().address, '客户一地址')
  s.commerce.draftOwner = ''
  s.loadDrafts()
  s.commerce.selectedCustomerId = '1'
  assert.equal(s.cartQuantity(), 3)
  assert.equal(s.currentDraft().note, '不要混单')
})

test('changing accounts and tenants never exposes the previous cart or cached lists', () => {
  const h = harness(), s = h.service
  s.selectOrderCustomer(customer())
  s.addToCart(product(), 3)
  s.commerce.customers.push(customer())
  h.session.userId = 'u2'
  s.loadDrafts()
  assert.equal(s.commerce.drafts.length, 0)
  assert.equal(s.commerce.customers.length, 0)
  assert.equal(s.commerce.selectedCustomerId, '')
  h.session.userId = 'u1'
  s.loadDrafts()
  assert.equal(s.commerce.drafts.length, 1)
  h.session.tenantId = 'other-company'
  s.loadDrafts()
  assert.equal(s.commerce.drafts.length, 0)
})

test('invalid quantities and inactive customers cannot create bad drafts', () => {
  const h = harness(), s = h.service
  assert.equal(s.selectOrderCustomer({ ...customer(), status: 'INACTIVE' }), false)
  s.selectOrderCustomer(customer())
  for (const value of [-1, 0, 0.5, NaN, Infinity, 10000]) assert.equal(s.addToCart(product(), value), false)
  assert.equal(s.cartQuantity(), 0)
  s.addToCart(product(), 1)
  s.changeCartQuantity('p1', -2)
  assert.equal(s.cartQuantity(), 1)
  s.changeCartQuantity('p1', NaN)
  assert.equal(s.cartQuantity(), 1)
  s.changeCartQuantity('p1', 10000)
  assert.equal(s.cartQuantity(), 9999)
  assert.equal(s.addToCart(product(), 1), false)
})

test('storage failure rolls back all cart edits and never reports saved', () => {
  const h = harness(), s = h.service
  s.selectOrderCustomer(customer())
  s.addToCart(product(), 2)
  const previous = JSON.stringify(s.currentDraft())
  h.messages.length = 0
  h.failStorage(true)
  assert.equal(s.addToCart(product(), 1), false)
  assert.equal(s.addToCart(product('p2'), 1), false)
  s.changeCartQuantity('p1', 1)
  s.removeCartLine('p1')
  assert.equal(s.saveCheckout('新地址', '新备注'), false)
  assert.equal(JSON.stringify(s.currentDraft()), previous)
  assert.equal(s.selectOrderCustomer(customer('2')), false)
  assert.equal(s.commerce.selectedCustomerId, '1')
  assert.ok(h.messages.every(message => message.includes('保存失败')))
})

test('expired sessions cannot edit or persist business drafts', () => {
  const h = harness(), s = h.service
  s.selectOrderCustomer(customer())
  const previousStorage = [...h.files.values()][0]
  h.session.expiresAt = Date.now() - 1
  assert.equal(s.addToCart(product(), 1), false)
  assert.equal(s.saveCheckout('地址', '说明'), false)
  s.loadDrafts()
  assert.equal(h.session.authenticated, false)
  assert.equal(s.commerce.drafts.length, 0)
  assert.equal([...h.files.values()][0], previousStorage)
})

test('late requests from another account and superseded searches are ignored', () => {
  const h = harness(), s = h.service
  s.loadCustomers('旧搜索')
  const old = h.requests[0]
  s.loadCustomers('新搜索')
  old[3](new JsonObject({ data: { total: 1, items: [{ id: 1, customerName: '旧数据' }] } }))
  assert.equal(s.commerce.customers.length, 0)
  const current = h.requests[1]
  h.session.userId = 'u2'
  s.loadDrafts()
  current[3](new JsonObject({ data: { total: 1, items: [{ id: 1, customerName: '其他账户的数据' }] } }))
  assert.equal(s.commerce.customers.length, 0)
})

test('verified read endpoints are relative, paginated, and exclude purchase-price variants', () => {
  const h = harness(), s = h.service
  s.loadProducts('巧粉')
  const request = h.requests[0]
  assert.ok(request[0].startsWith('/erp/product-management/products?'))
  assert.ok(request[0].includes('withVariants=false'))
  assert.equal(request[1], 'GET')
  request[3](new JsonObject({ data: { total: 21, items: [{ id: 'p1', productName: '巧粉', defaultSalePrice: 88 }] } }))
  assert.equal(s.commerce.products[0].price, 88)
  assert.equal(s.commerce.products[0].stock, null)
  s.loadProducts('巧粉', true)
  assert.ok(h.requests[1][0].includes('begin=1&step=20'))
  s.selectOrderCustomer(customer())
  s.addToCart(s.commerce.products[0], 2)
  s.saveCheckout('地址', '')
  assert.equal(h.requests.filter(request => request[1] !== 'GET').length, 0)
  assert.equal(Object.hasOwn(s.currentDraft(), 'total'), false)
  assert.equal(s.currentDraft().lines[0].referencePrice, 88)
})

test('server order amounts and statuses stay separate and Instant uses Beijing time', () => {
  const h = harness(), s = h.service
  s.loadOrderDetail('o1', () => {}, assert.fail)
  h.requests[0][3](new JsonObject({ data: { id: 'o1', orderNo: 'XS01', orderStatusCode: 'COMPLETED', paymentStatusCode: 'UNPAID', outboundStatusCode: 'OUT_CONFIRMED', payableAmount: 210, paidAmount: 0, unpaidAmount: 210, orderDate: '2026-10-14T01:30:00Z', lines: [] } }))
  const order = s.findOrder('o1')
  assert.equal(order.time, '2026-10-14 09:30:00')
  assert.equal(order.total, 210)
  assert.equal(s.orderStatusLabel(order.status), '已完成')
  assert.equal(s.paymentStatusLabel(order.paymentStatus), '未收款')
  assert.equal(s.displayTime('2026-10-14T09:30:00+08:00'), '2026-10-14 09:30:00')
  assert.equal(s.displayTime('2026-10-14 09:30:00'), '2026-10-14 09:30:00')
})

test('unsafe numeric identifiers are rejected instead of binding a rounded customer or product id', () => {
  const h = harness(), s = h.service
  s.loadCustomers()
  h.requests[0][3](new JsonObject({ data: { total: 1, items: [{ id: 9007199254740992, customerName: '不得进入草稿' }] } }))
  assert.equal(s.commerce.customers.length, 0)
  assert.match(s.commerce.customersError, /编号/)
  s.loadProducts()
  h.requests[1][3](new JsonObject({ data: { total: 1, items: [{ id: '9007199254740993', productName: '精确字符串编号' }] } }))
  assert.equal(s.commerce.products[0].id, '9007199254740993')
})

test('load more with changed search or order status restarts at zero and replaces old rows', () => {
  const h = harness(), s = h.service
  s.loadCustomers('甲')
  h.requests[0][3](new JsonObject({ data: { total: 21, items: [{ id: 1, customerName: '甲' }] } }))
  s.loadCustomers('乙', true)
  assert.match(h.requests[1][0], /begin=0&/)
  assert.equal(s.commerce.customers.length, 0)
  h.requests[1][3](new JsonObject({ data: { total: 1, items: [{ id: 2, customerName: '乙' }] } }))
  assert.deepEqual(s.commerce.customers.map(row => row.id), ['2'])
  s.loadOrders('', 'DRAFT')
  h.requests[2][3](new JsonObject({ data: { total: 21, items: [{ id: 3, orderStatusCode: 'DRAFT' }] } }))
  s.loadOrders('', 'SUBMITTED', true)
  assert.match(h.requests[3][0], /begin=0&/)
  assert.equal(s.commerce.orders.length, 0)
  assert.equal(s.commerce.orderStatusQuery, 'SUBMITTED')
})

test('detail records never contaminate paginated lists or change the next offset', () => {
  const h = harness(), s = h.service
  s.loadCustomers('甲')
  h.requests[0][3](new JsonObject({ data: { total: 21, items: [{ id: 1, customerName: '甲' }] } }))
  s.loadCustomerDetail('99', () => {}, assert.fail)
  h.requests[1][3](new JsonObject({ data: { id: 99, customerName: '其他详情' } }))
  assert.equal(s.findCustomer('99').name, '其他详情')
  assert.deepEqual(s.commerce.customers.map(row => row.id), ['1'])
  s.loadCustomers('甲', true)
  assert.match(h.requests[2][0], /begin=1&/)
})

test('removed permission and failed refresh clear previously visible business records', () => {
  const h = harness(), s = h.service
  s.loadOrders()
  h.requests[0][3](new JsonObject({ data: { total: 21, items: [{ id: 1 }] } }))
  s.loadOrders('', '', true)
  h.requests[1][4]('当前账号无权查看')
  assert.equal(s.commerce.orders.length, 0)
  assert.equal(s.commerce.ordersTotal, 0)
  s.loadProducts()
  h.session.permissions = ['crm:customer:read', 'order:read']
  h.requests[2][3](new JsonObject({ data: { total: 1, items: [{ id: 2 }] } }))
  assert.equal(s.commerce.products.length, 0)
  assert.equal(s.commerce.productsLoading, false)
  assert.match(s.commerce.productsError, /没有商品查看权限/)
})

test('product detail revalidates exact id through safe list projection without variants', () => {
  const h = harness(), s = h.service
  let result = null, error = ''
  s.loadProductDetail('9007199254740993', value => { result = value }, message => { error = message })
  assert.equal(h.requests[0][0], '/erp/product-management/products?begin=0&step=1&withVariants=false&productIds=9007199254740993')
  h.requests[0][3](new JsonObject({ data: { total: 1, items: [{ id: '9007199254740993', productName: '真实商品' }] } }))
  assert.equal(result.name, '真实商品')
  assert.equal(s.commerce.products.length, 0)
  s.loadProductDetail('3', assert.fail, message => { error = message })
  h.requests[1][3](new JsonObject({ data: { total: 1, items: [{ id: 4 }] } }))
  assert.match(error, /编号不一致/)
  assert.equal(s.commerce.productDetail, null)
})

test('malformed list response is an error, not a real empty business dataset', () => {
  const h = harness(), s = h.service
  s.loadCustomers()
  h.requests[0][3](new JsonObject({ data: { total: 31 } }))
  assert.match(s.commerce.customersError, /格式不正确/)
  assert.equal(s.commerce.customersLoading, false)
})

test('repeated cart/checkout/result/continue-shopping flow returns to existing native pages', () => {
  const pageSource = fs.readFileSync(path.resolve(__dirname, '../app/pages/commerce/commerce.uvue'), 'utf8')
  const start = pageSource.indexOf('function open(destination: string')
  const end = pageSource.indexOf('\nfunction chooseCustomer()', start)
  const functionCode = ts.transpileModule(pageSource.slice(start, end), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText
  const pages = [{ route: 'pages/home/home', options: new JsonObject({}) }, { route: 'pages/commerce/commerce', options: new JsonObject({ view: 'products' }) }]
  const uni = {
    navigateBack: ({ delta }) => pages.splice(pages.length - delta, delta),
    navigateTo: ({ url }) => {
      const parsed = new URL(url, 'https://app.invalid')
      pages.push({ route: parsed.pathname.slice(1), options: new JsonObject(Object.fromEntries(parsed.searchParams)) })
    },
  }
  const open = new Function('getCurrentPages', 'uni', 'order', functionCode + '\nreturn open;')(() => pages, uni, { value: { id: 'o1' } })
  for (let cycle = 0; cycle < 25; cycle++) {
    open('cart'); open('checkout'); open('result'); open('cart'); open('products')
    assert.equal(pages.length, 2)
    assert.equal(pages[1].options.getString('view'), 'products')
  }
})
