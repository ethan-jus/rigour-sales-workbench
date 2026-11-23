// Execute the actual homepage script with controlled transport, native actions and account state.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const test = require('node:test')
const assert = require('node:assert/strict')
const ts = require('typescript')
const { reactive, ref, computed, watch, nextTick } = require('vue')
const {cacheFixture, jsonGetters} = require('./helpers/home-cache.cjs')
const permissions = ['sales:context:read', 'sales:work-day:write', 'sales:visit:own:read', 'sales:visit:own:write', 'sales:visit-target:read', 'sales:visit-plan:own:read', 'crm:pool:private-read', 'crm:store:visit-write', 'erp:product:read']
function fixture(options = {}, cacheOptions = {}) {
  const session = reactive({ authenticated: true, userId: 'one', tenantId: 'tenant', revision: 1, permissions: [...permissions], ...options })
  const cache = cacheFixture(session, cacheOptions)
  const commerce = reactive({ drafts: [], draftOwner: 'tenant:one', selectedCustomerId: '' })
  const local = reactive({ count: 0, recording: false })
  const requests = [], planRequests = [], finances = [], days = [], checkins = [], navigations = [], toasts = [], hooks = {}
  const key = () => session.authenticated ? session.tenantId + ':' + session.userId + ':' + session.revision + ':' + session.permissions.join(',') : ''
  const deferred = queue => new Promise((resolve, reject) => queue.push({ resolve, reject }))
  const source = fs.readFileSync(path.join(__dirname, '../app/pages/home/home.uvue'), 'utf8').split('<script setup lang="uts">')[1].split('</script>')[0]
  const code = ts.transpileModule(source + '\nexports.view = { snapshotHint, completedAmount, salesTargetAmount, targetAmount, performanceRange, progressLabel, progressStyle, errorText, visitsTotal, effectiveTotal, summaryError, firstTotal, range, period, tradeAmount, pendingAmount, planCount, financeError, workDayStatus, workDayError, workDayLoading, attendanceLabel, attendanceImage, attendanceLabelClass, canStartVisit, canReadPlan, canReadProducts, canReadWorkDay, draftCount, draftName }; exports.actions = { retry, loadHome, loadSummary, loadWorkDay, startVisit, openPlan, products, openDraft, selectPeriod, loadFinance, openMetric, openPendingPlans, loadPlanCount, chooseMonth };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const modules = {
    '../../services/wecom.uts': { wecomSummary: async () => ({active: '—'}) },
    '../../services/visit-workbench.uts': { visitRefresh:reactive({revision:0}), showVisitPlans: date => navigations.push('/pages/visits/visits?tab=plans&date='+date), showVisitRecords: (from,to,kind)=>navigations.push('/pages/visits/visits?kind='+kind), loadVisitBoard: () => Promise.reject(new Error('not mocked')) },
    '../../services/home-cache.uts': cache,
    '../../services/config.uts': {appEnvironment: {environment: 'test'}},
    '../../services/session.uts': { session, hasPermission: value => session.authenticated && session.permissions.includes(value), requireSession: () => { if (session.authenticated) return true; navigations.push('/pages/login/login'); return false } },
    '../../services/sales-profile.uts': { requestSalesApi: (url, success, fail) => (url.includes('visit-plans') ? planRequests : requests).push({ url, success, fail }) },
    '../../services/crm.uts': { crmMessage: error => error.message },
    '../../services/crm-media.uts': {crmRecording:()=>local.recording,crmUploadState:reactive({pending:0})},
    '../../services/attendance.uts': { attendance: reactive({phase: '', pending:false, day:null}), attendanceStatus: () => deferred(days), checkInAttendance: () => deferred(checkins), resetAttendance: () => {}, attendanceClock: () => '09:00' },
    '../../services/commerce.uts': { commerce, loadDrafts: () => {}, preloadCommerceLists: () => {} },
    '../../services/visits.uts': { visitToday: () => '2026-11-11', visitReadKey: key,  },
  }
  const wb = { exports: {}, require: name => name === './visits.uts' ? {apiVisitTime: value => value} : {} }; vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/services/workbench.uts'), 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, wb);
  modules['../../services/workbench.uts'] = {...wb.exports, requestWorkbench: (endpoint, from, to, suffix, success, fail) => finances.push({endpoint, from, to, suffix, success, fail})};
  const context = { exports: {}, require: name => modules[name], ref, computed, watch, onShow: callback => { hooks.show = callback }, onHide: callback => { hooks.hide = callback }, onUnload: callback => { hooks.unload = callback }, uni: { navigateTo: value => navigations.push(value.url), switchTab: value => navigations.push(value.url), showToast: value => toasts.push(value.title) } }
  vm.createContext(context); vm.runInContext(jsonGetters, context); vm.runInContext(code, context)
  const respond = (index, total, effective, first = 1) => requests[index].success({ getJSON: () => ({ getNumber: field => field === 'totalVisitCount' ? total : field === 'effectiveVisitCount' ? effective : first }) })
  return { cache, session, commerce, local, requests, planRequests, finances, days, checkins, navigations, toasts, hooks, attendance: modules['../../services/attendance.uts'].attendance, ...context.exports, respond }
}

test('homepage reads today without creating a check-in or requesting device permissions', async () => {
  const f = fixture(); f.hooks.show()
  assert.equal(f.requests[0].url, '/sales/me/activity-summary?from=2026-11-11&to=2026-11-11')
  assert.equal(f.days.length, 1); assert.equal(f.checkins.length, 0)
  assert.equal(f.view.visitsTotal.value, '—')
  f.respond(0, 4, 3); f.days[0].resolve('ACTIVE'); await new Promise(setImmediate)
  assert.equal(f.view.visitsTotal.value, '4'); assert.equal(f.view.effectiveTotal.value, '3')
  assert.equal(f.view.workDayStatus.value, 'ACTIVE')
  assert.equal(f.view.attendanceLabel.value, '工作中'); assert.equal(f.checkins.length, 0)
})

test('summary failures and missing fields never masquerade as zero visits', () => {
  const f = fixture(); f.actions.loadSummary(); f.requests[0].fail('网络连接失败')
  assert.equal(f.view.visitsTotal.value, '—'); assert.equal(f.view.summaryError.value, '网络连接失败')
  f.actions.loadSummary(); f.respond(1, 5, null)
  assert.equal(f.view.effectiveTotal.value, '—'); assert.match(f.view.summaryError.value, /暂不可用/)
  f.actions.loadSummary(); f.respond(2, 0, 0)
  assert.equal(f.view.visitsTotal.value, '0'); assert.equal(f.view.effectiveTotal.value, '0'); assert.equal(f.view.summaryError.value, '')
})

test('permissions hide unavailable actions and prevent their requests and navigation', () => {
  const f = fixture({ permissions: [] }); f.hooks.show()
  assert.equal(f.requests.length, 0); assert.equal(f.days.length, 0)
  for (const name of ['canStartVisit', 'canReadPlan', 'canReadProducts', 'canReadWorkDay']) assert.equal(f.view[name].value, false)
  f.actions.startVisit(); f.actions.openPlan(); f.actions.products()
  assert.deepEqual(f.navigations, [])
})

test('visit action resumes the shared visit board and only enters authorized CRM stores', async () => {
  const f = fixture(); f.local.recording = true; f.actions.startVisit()
  f.local.recording = false; f.actions.startVisit()
  f.session.permissions = ['sales:visit-target:read', 'sales:visit:own:write']; await nextTick(); f.actions.startVisit()
  assert.deepEqual(f.navigations, ['/pages/visits/visits', '/pages/customer-list/customer-list?kind=MINE'])
})

test('newer refresh, account changes and revoked permissions discard obsolete responses', async () => {
  const f = fixture(); f.hooks.show(); f.actions.selectPeriod('month')
  f.respond(1, 2, 1); f.respond(0, 99, 99); assert.equal(f.view.visitsTotal.value, '2')
  f.session.userId = 'two'; f.session.revision++; await nextTick()
  f.days[0].resolve('ACTIVE'); f.respond(1, 88, 88); await nextTick()
  assert.equal(f.view.workDayStatus.value, ''); assert.equal(f.view.visitsTotal.value, '—')
  const latest = f.requests.length - 1
  f.session.permissions = []; await nextTick(); f.respond(latest, 77, 77)
  assert.equal(f.view.visitsTotal.value, '—'); assert.equal(f.view.canReadProducts.value, false)
})

test('home status follows the server and uses the matching designed asset and working color', async () => {
  const f = fixture()
  for (const [status,label,asset] of [['NOT_STARTED','未上班','ready'],['ACTIVE','工作中','working'],['FINISHED','已下班','finished']]) {
    const task=f.actions.loadWorkDay();f.days.at(-1).resolve(status);await task
    assert.equal(f.view.attendanceLabel.value,label)
    assert.equal(f.view.attendanceImage.value,'/static/home/status-'+asset+'.png')
  }
  f.view.workDayStatus.value='ACTIVE'
  assert.match(f.view.attendanceLabelClass.value,/home-attendance-working/)
  assert.equal(f.checkins.length,0)
})

test('failed or pending status is not presented as a confirmed work state', async () => {
  const f=fixture();const task=f.actions.loadWorkDay();f.days[0].reject(new Error('状态无法确认'));await task
  assert.equal(f.view.attendanceLabel.value,'状态待确认');assert.equal(f.view.attendanceImage.value,'')
  const retry=f.actions.loadWorkDay();f.days[1].resolve('ACTIVE');await retry
  f.attendance.pending=true
  assert.equal(f.view.attendanceLabel.value,'待同步');assert.equal(f.view.attendanceImage.value,'')
})

test('drafts stay owner scoped and multiple carts open their list instead of an arbitrary cart', async () => {
  const f = fixture(); f.commerce.drafts = [{ customerId: 'one', customerName: '客户一', lines: [{}] }, { customerId: 'empty', customerName: '空草稿', lines: [] }]
  assert.equal(f.view.draftCount.value, 1); f.actions.openDraft()
  assert.equal(f.commerce.selectedCustomerId, 'one')
  f.commerce.drafts.push({ customerId: 'two', customerName: '客户二', lines: [{}] }); f.actions.openDraft()
  assert.deepEqual(f.navigations, ['/pages/commerce/commerce?view=cart', '/pages/customers/customers'])
  f.session.userId = 'other'; await nextTick()
  assert.equal(f.view.draftCount.value, 0); assert.equal(f.view.draftName.value, '')
})

test('direct unauthenticated entry returns to login and makes no business requests', () => {
  const f = fixture({ authenticated: false }); f.hooks.show()
  assert.deepEqual(f.navigations, ['/pages/login/login']); assert.equal(f.requests.length, 0); assert.equal(f.days.length, 0)
})


test('identical read failures share one message and retry both failed reads', async () => {
  const f = fixture(); f.actions.loadSummary(); const day = f.actions.loadWorkDay()
  f.requests[0].fail('服务暂时不可用'); f.days[0].reject(new Error('服务暂时不可用')); await day
  assert.equal(f.view.errorText.value, '服务暂时不可用')
  f.actions.retry(); assert.equal(f.requests.length, 2); assert.equal(f.days.length, 2)
  assert.equal(f.checkins.length, 0)
})


test('period changes use one interval for visits and money but preserve today plans', () => {
  const f = fixture({permissions: [...permissions, 'order:read', 'order:payment:read']}); f.hooks.show();
  f.actions.selectPeriod('lastMonth');
  assert.match(f.requests.at(-1).url, /from=2026-10-01&to=2026-10-31/);
  assert.equal(f.finances.at(-1).from, '2026-10-01'); assert.equal(f.finances.at(-1).to, '2026-10-31');
  assert.equal(f.planRequests.length, 1); assert.match(f.planRequests[0].url, /date=2026-11-11/);
  f.actions.selectPeriod('year'); assert.equal(f.view.range.value.from, '2026-01-01');
});
test('late finance results cannot replace selected period or another account', async () => {
  const f = fixture({permissions: [...permissions, 'order:read']}); f.actions.loadFinance();
  f.actions.selectPeriod('month');
  const data = {getNumber: field => field.endsWith('Count') ? 2 : 50, getJSON: () => null};
  f.finances[0].success(data); assert.equal(f.view.tradeAmount.value, '—');
  f.finances[1].success(data); assert.equal(f.view.tradeAmount.value, '50');
  f.session.userId = 'other'; await nextTick(); f.finances[1].success(data);
  assert.equal(f.view.pendingAmount.value, '—');
});
test('metric drills carry the selected range and WeCom opens the authorized customer page', () => {
  const f = fixture({permissions: [...permissions, 'order:read']}); f.actions.selectPeriod('month');
  f.actions.openMetric('effective'); f.actions.openMetric('unpaid'); f.actions.openMetric('wecom');
  assert.match(f.navigations[0], /kind=effective&from=2026-11-01&to=2026-11-11/);
  assert.match(f.navigations[1], /kind=unpaid/); assert.equal(f.navigations[2], '/pages/wecom/wecom');
});


test('previous month spans the prior year and leap February correctly', () => {
  const context = {exports:{},require:()=>({})};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../app/services/workbench.uts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText, context);
  const period = context.exports.workbenchPeriod;
  assert.equal(period('lastMonth','2026-01-02').from,'2025-12-01');
  assert.equal(period('lastMonth','2026-01-02').to,'2025-12-31');
  assert.equal(period('lastMonth','2024-03-01').to,'2024-02-29');
  assert.equal(period('custom','2026-11-11','2026-11').to,'2026-11-11');
});
test('future month selection does not send invalid requests', () => {
  const f=fixture(); f.actions.chooseMonth({detail:{value:'2027-01'}});
  assert.equal(f.requests.length,0); assert.equal(f.view.period.value,'today');
  assert.deepEqual(f.toasts,['请选择当前或历史月份']);
});
test('today planned count excludes completed and cancelled plans', () => {
  const f=fixture(); f.actions.loadPlanCount();
  const items=['PLANNED','IN_PROGRESS','COMPLETED','CANCELLED'].map(status=>({getString:()=>status}));
  f.planRequests[0].success({getJSON:()=>({getArray:()=>items})});
  assert.equal(f.view.planCount.value,'2');
});

function detailFixture(options = {}) {
  const session=reactive({owner:'one'}), hooks={}, requests=[], navigations=[];
  const source=fs.readFileSync(path.join(__dirname,'../app/pages/workbench-details/workbench-details.uvue'),'utf8').split('<script setup lang="uts">')[1].split('</script>')[0];
  const modules={
    '../../services/session.uts':{requireSession:()=>true,hasPermission:permission=>options.permissions == null || options.permissions.includes(permission)},
    '../../services/sales-profile.uts':{requestSalesApi:(url,success,fail)=>requests.push({url,success,fail})},
    '../../services/visits.uts':{visitToday:()=> '2026-11-11',visitReadKey:()=>session.owner,parseVisitItem:v=>v,visitReview:v=>v},
    '../../services/workbench.uts':{requestWorkbench:(endpoint,from,to,suffix,success,fail)=>requests.push({endpoint,from,to,suffix,success,fail}),parseWorkbenchRow:v=>v,workbenchMoney:v=>v==null?'—':v.toString()},
    '../../services/commerce.uts':{commerce:{selectedOrderId:''}}
  };
  const context={exports:{},require:n=>modules[n],ref,computed,watch,onLoad:f=>hooks.load=f,onShow:f=>hooks.show=f,onHide:f=>hooks.hide=f,onUnload:f=>hooks.unload=f,uni:{setNavigationBarTitle:()=>{},navigateTo:o=>navigations.push(o.url)}};
  vm.runInNewContext("Object.defineProperty(Object.prototype, 'getString', {value: function(key) { return this[key] ?? null }})",context);
  vm.runInNewContext(ts.transpileModule(source+'\nexports.view={rows,total,amount,error};exports.actions={load,more,open};',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
  const respond=(index,start,count,total=21)=>requests[index].success({getArray:()=>Array.from({length:count},(_,i)=>({id:String(start+i),orderId:'order-'+(start+i),customerName:'门店',time:'2026-11-11',number:'SO',amount:'10',status:'待回款'})),getNumber:field=>field==='total'?total:210});
  return {session,hooks,requests,navigations,respond,...context.exports};
}
test('drilldown pagination keeps server total and navigates with the exact order id', () => {
  const f=detailFixture(); f.hooks.load({kind:'unpaid',from:'2026-10-01',to:'2026-10-31'}); f.hooks.show(); f.respond(0,0,20);
  f.actions.more(); f.actions.more(); assert.equal(f.requests.length,2); assert.match(f.requests[1].suffix,/begin=20/);
  f.respond(1,20,1); assert.equal(f.view.rows.value.length,21); assert.equal(f.view.total.value,21);
  f.actions.more(); assert.equal(f.requests.length,2); f.actions.open(f.view.rows.value[20]); assert.match(f.navigations[0],/id=order-20$/);
});
test('account change clears detail amounts and rejects a late old-account page', async () => {
  const f=detailFixture(); f.hooks.load({kind:'receipts'}); f.hooks.show(); f.respond(0,0,20); f.actions.more();
  f.session.owner='two'; await nextTick(); f.respond(1,20,1);
  assert.equal(f.view.rows.value.length,0); assert.equal(f.view.amount.value,'');
  assert.equal(f.requests.length,3);
});
test('failed detail response is an explicit retry state, not an empty business list', () => {
  const f=detailFixture(); f.hooks.load({kind:'unpaid'}); f.hooks.show(); f.requests[0].fail('服务暂不可用');
  assert.equal(f.view.error.value,'服务暂不可用'); assert.equal(f.view.rows.value.length,0);
  f.actions.load(false); f.respond(1,0,0,0); assert.equal(f.view.error.value,''); assert.equal(f.view.total.value,0);
});

const performanceData = (completedAmount, targetAmount, orderCount = 2) => ({getNumber: key => ({completedAmount, targetAmount, orderCount})[key] ?? null});
test('default Today keeps monthly achievement and drills into fully paid monthly orders', () => {
  const f = fixture({permissions: ['order:payment:read']}); f.hooks.show();
  assert.equal(f.view.period.value, 'today');
  assert.equal(f.finances[0].endpoint, 'performance');
  assert.equal(f.finances[0].from, '2026-11-01'); assert.equal(f.finances[0].to, '2026-11-11');
  f.finances[0].success(performanceData(18000, 30000));
  assert.equal(f.view.progressLabel.value, '60%'); assert.equal(f.view.progressStyle.value.width, '60%');
  f.actions.openMetric('performance'); assert.match(f.navigations[0], /kind=performance&from=2026-11-01&to=2026-11-11$/);
  f.actions.selectPeriod('lastMonth'); assert.equal(f.finances.at(-1).from, '2026-10-01'); assert.equal(f.finances.at(-1).to, '2026-10-31');
  f.actions.chooseMonth({detail:{value:'2026-03'}}); assert.equal(f.finances.at(-1).from, '2026-03-01'); assert.equal(f.finances.at(-1).to, '2026-03-31');
  f.actions.selectPeriod('year'); assert.equal(f.finances.at(-1).from, '2026-01-01'); assert.equal(f.finances.at(-1).to, '2026-11-11');
});
test('achievement caps only bar width, preserves overachievement and handles zero targets and review states', () => {
  const f = fixture({permissions:['order:payment:read']}); f.actions.loadFinance();
  f.finances[0].success(performanceData(35000, 30000));
  assert.equal(f.view.progressLabel.value,'116.7%'); assert.equal(f.view.progressStyle.value.width,'100%');
  f.finances[0].success(performanceData(0, 30000)); assert.equal(f.view.progressLabel.value,'0%');
  f.finances[0].success(performanceData(35000, 0)); assert.equal(f.view.progressLabel.value,'—'); assert.equal(f.view.progressStyle.value.width,'0%');
  f.finances[0].success(performanceData(null, 30000)); assert.equal(f.view.progressLabel.value,'待核定');
  f.actions.loadFinance(); f.finances[1].fail('HR服务暂不可用');
  assert.equal(f.view.progressLabel.value,'—'); assert.equal(f.view.targetAmount.value,null); assert.equal(f.view.errorText.value,'HR服务暂不可用');
});
test('late performance response cannot replace a selected month or another employees target', async () => {
  const f = fixture({permissions:['order:payment:read']}); f.actions.loadFinance(); f.actions.selectPeriod('lastMonth');
  f.finances[0].success(performanceData(100, 100)); assert.equal(f.view.completedAmount.value,null);
  f.finances[1].success(performanceData(10, 100)); assert.equal(f.view.progressLabel.value,'10%');
  f.session.userId='two'; await nextTick(); f.finances[1].success(performanceData(99,100));
  assert.equal(f.view.targetAmount.value,null); assert.equal(f.view.completedAmount.value,null);
});
test('fully paid drilldown retains selected performance range and review status', () => {
  const f=detailFixture(); f.hooks.load({kind:'performance',from:'2026-10-01',to:'2026-10-31'}); f.hooks.show();
  assert.match(f.requests[0].suffix,/kind=performance/); assert.equal(f.requests[0].from,'2026-10-01');
  f.requests[0].success({getArray:()=>[],getNumber:key=>key==='total'?0:null});
  assert.equal(f.view.amount.value,'—');
});

test('todo entries open their own lists and todays plans remain today while viewing last month', () => {
  const f=fixture({permissions:[...permissions,'order:read']}); f.actions.selectPeriod('lastMonth');
  f.actions.openMetric('unpaid'); f.actions.openMetric('outbound'); f.actions.openPendingPlans();
  assert.match(f.navigations[0],/workbench-details\?kind=unpaid/);
  assert.match(f.navigations[1],/workbench-details\?kind=outbound/);
  assert.match(f.navigations[2],/visits\?tab=plans&date=2026-11-11$/);
});
test('returning home displays the prior summary synchronously while refreshing it', () => {
  const f = fixture(); f.hooks.show(); f.respond(0, 4, 3)
  f.hooks.hide(); f.hooks.show()
  assert.equal(f.view.visitsTotal.value, '4'); assert.match(f.view.snapshotHint.value, /上次数据.*正在更新/)
  assert.equal(f.requests.length, 2); assert.equal(f.days.length, 1) // Work-day read is still pending.
  f.respond(1, 5, 4); assert.equal(f.view.visitsTotal.value, '5'); assert.equal(f.view.snapshotHint.value, '')
})
test('a cold homepage restores the verified account snapshot before any response arrives', () => {
  const previous = fixture(); previous.hooks.show(); previous.respond(0, 4, 3)
  const f = fixture({}, {storage: previous.cache.storage}); f.hooks.show()
  assert.equal(f.view.visitsTotal.value, '4'); assert.equal(f.view.workDayStatus.value, '')
  assert.equal(f.requests.length, 1); assert.equal(f.days.length, 1)
})
test('in-flight identical homepage requests coalesce while a different date reads separately', () => {
  const f = fixture({permissions: [...permissions, 'order:read', 'order:payment:read']}); f.hooks.show(); f.hooks.show()
  assert.equal(f.requests.length, 1); assert.equal(f.planRequests.length, 1); assert.equal(f.finances.length, 2); assert.equal(f.days.length, 1)
  f.respond(0, 4, 3); f.actions.selectPeriod('lastMonth')
  assert.equal(f.view.visitsTotal.value, '—'); assert.equal(f.requests.length, 2)
  f.respond(1, 7, 6); f.actions.selectPeriod('today')
  assert.equal(f.view.visitsTotal.value, '4'); assert.equal(f.requests.length, 3)
})
test('failed fresh reads clear cached figures and show the actual failure', () => {
  const f = fixture(); f.hooks.show(); f.respond(0, 4, 3); f.hooks.show()
  f.requests[1].fail('暂无此功能或数据的权限，请联系管理员。')
  assert.equal(f.view.visitsTotal.value, '—'); assert.match(f.view.errorText.value, /权限/)
  assert.equal(f.view.snapshotHint.value, '')
  assert.equal(f.cache.readHomeSnapshot('visits:2026-11-11:2026-11-11'), null)
})
test('order/performance/plan aggregates restore together without persisting raw rows', () => {
  const options = {permissions: [...permissions, 'order:read', 'order:payment:read']}
  const previous = fixture(options); previous.hooks.show()
  previous.finances[0].success(previous.cache.data({tradeAmount: 120, salesTargetAmount: 40000, orderCount: 2, pendingAmount: 30, pendingCount: 1, outboundCount: 3, privateCustomerName: 'must-not-store'}))
  previous.finances[1].success(previous.cache.data({completedAmount: null, targetAmount: 500, orderCount: 0}))
  previous.planRequests[0].success(previous.cache.data({data: {items: [{status: 'PLANNED', customerName: 'must-not-store'}]}}))
  const f = fixture(options, {storage: previous.cache.storage}); f.hooks.show()
  assert.equal(f.view.tradeAmount.value, '120'); assert.equal(f.view.pendingAmount.value, '30'); assert.equal(f.view.planCount.value, '1')
  assert.equal(f.view.completedAmount.value, null); assert.equal(f.view.targetAmount.value, 500); assert.equal(f.view.progressLabel.value, '待核定')
  assert.doesNotMatch([...previous.cache.storage.values()][0], /must-not-store/)
})


test('three rapid tab returns reuse all five pending reads when no business data changed', () => {
  const f = fixture({permissions: [...permissions, 'order:read', 'order:payment:read']}); f.hooks.show()
  for (let i=0;i<3;i++) { f.hooks.hide(); f.hooks.show() }
  assert.equal(f.requests.length,1); assert.equal(f.days.length,1)
  assert.equal(f.planRequests.length,1); assert.equal(f.finances.length,2)
  f.respond(0,5,4); assert.equal(f.view.visitsTotal.value,'5')
})

test('a successful write while hidden invalidates snapshots and pre-navigation reads', async () => {
  const f = fixture(); f.cache.writeHomeSnapshot('visits:2026-11-11:2026-11-11',f.cache.data({totalVisitCount:1,effectiveVisitCount:1,firstVisitCount:1}))
  f.hooks.show(); f.hooks.hide(); f.cache.invalidateHomeCache(); await nextTick()
  assert.equal(f.cache.readHomeSnapshot('visits:2026-11-11:2026-11-11'),null)
  f.hooks.show(); assert.equal(f.requests.length,2)
  f.respond(0,99,99); assert.equal(f.view.visitsTotal.value,'—')
  f.respond(1,5,4); assert.equal(f.view.visitsTotal.value,'5')
})

test('a successful write while home is visible replaces obsolete reads without leaving a spinner', async () => {
  const f = fixture(); f.hooks.show(); f.cache.invalidateHomeCache(); await nextTick()
  assert.equal(f.requests.length,2); f.respond(0,99,99); f.respond(1,6,5)
  assert.equal(f.view.visitsTotal.value,'6')
})


test('sales and receipts targets remain independent and old salary snapshots are not restored', async () => {
  const options = {permissions: ['order:read', 'order:payment:read']}
  const f = fixture(options)
  f.cache.writeHomeSnapshot('performance:2026-11-01:2026-11-11', f.cache.data({completedAmount: 1000, targetAmount: 7000, orderCount: 2}))
  f.cache.writeHomeSnapshot('orders:2026-11-11:2026-11-11', f.cache.data({tradeAmount: 120, orderCount: 2, pendingAmount: 30, pendingCount: 1, outboundCount: 3}))
  f.hooks.show()
  assert.equal(f.view.targetAmount.value, null); assert.equal(f.view.salesTargetAmount.value, null)
  f.finances[0].success(f.cache.data({tradeAmount: 120, salesTargetAmount: 40000, orderCount: 2, pendingAmount: 30, pendingCount: 1, outboundCount: 3}))
  f.finances[1].success(performanceData(1000, 20000))
  assert.equal(f.view.salesTargetAmount.value, 40000); assert.equal(f.view.targetAmount.value, 20000)
  assert.equal(f.view.progressLabel.value, '5%')
  const cold = fixture(options, {storage: f.cache.storage}); cold.hooks.show()
  assert.equal(cold.view.salesTargetAmount.value, 40000); assert.equal(cold.view.targetAmount.value, 20000)
  f.actions.selectPeriod('lastMonth')
  assert.equal(f.view.salesTargetAmount.value, null); assert.equal(f.view.targetAmount.value, null)
  f.finances[0].success(f.cache.data({tradeAmount: 999, salesTargetAmount: 99999, orderCount: 0, pendingAmount: 0, pendingCount: 0, outboundCount: 0}))
  assert.equal(f.view.salesTargetAmount.value, null)
  f.finances[2].success(f.cache.data({tradeAmount: 0, salesTargetAmount: 0, orderCount: 0, pendingAmount: 0, pendingCount: 0, outboundCount: 0}))
  assert.equal(f.view.salesTargetAmount.value, 0)
  f.session.permissions = []; await nextTick()
  assert.equal(f.view.salesTargetAmount.value, null); assert.equal(f.view.targetAmount.value, null)
})
test('missing or invalid sales targets are explicit failures instead of fabricated defaults', () => {
  const f = fixture({permissions: ['order:read']})
  for (const target of [null, -1, NaN]) {
    f.actions.loadFinance()
    f.finances.at(-1).success(f.cache.data({tradeAmount: 120, salesTargetAmount: target, orderCount: 2, pendingAmount: 30, pendingCount: 1, outboundCount: 3}))
    assert.equal(f.view.salesTargetAmount.value, null); assert.equal(f.view.tradeAmount.value, '—')
    assert.match(f.view.financeError.value, /经营数据暂不可用/)
  }
})
