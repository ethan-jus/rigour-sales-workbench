import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import Vant from 'vant';
import CrmCustomersPage from '@/pages/CrmCustomersPage.vue';
import { crmCustomersApi, type CrmCustomer } from '@/api/core/crm-customers';
import { salesApi, type VisitView, type WorkDayView } from '@/api/core/sales';
import { useSalesStore } from '@/stores/sales';
import { getWorkbenchCapabilities } from '@/adapters/workbench';
import { ApiError } from '@/api/core/client';

const location = vi.hoisted(() => vi.fn());
const routerPush = vi.hoisted(() => vi.fn());
vi.mock('vue-router', () => ({ useRouter: () => ({ push: routerPush, back: vi.fn() }) }));
vi.mock('@/adapters/workbench', () => ({ getWorkbenchCapabilities: () => ({
  getCurrentLocation: location, getLocationStatus: () => 'ready', stopLocation: vi.fn(),
}) }));
vi.mock('@/api/core/crm-customers', () => ({
  crmCustomersApi: { context: vi.fn(), list: vi.fn(), detail: vi.fn(), visits: vi.fn(), startVisit: vi.fn(), claim: vi.fn() },
}));
vi.mock('@/api/core/sales', () => ({ salesApi: { visit: vi.fn(), workDay: vi.fn(), normalizeLocation: vi.fn() } }));
const customer: CrmCustomer = {
  revision: 1, businessStatus: 'OPEN', claimBlockedReason: null, id: '1001', name: 'DEV 私海门店', address: '测试地址', publicPhone: null,
  ownerEmployeeId: '20', currentOwnershipId: '2001', poolType: 'PRIVATE',
  recordStatus: 'ACTIVE', phase: 'FIRST_VISIT', deadlineAt: null, holdReason: null,
  cooperationStatus: 'NEVER', customerTier: 'UNRATED', lastVisitAt: null,
};
const scope = { employeeId: '20', permissions: ['crm:store:visit-write', 'crm:store:history-read'] };
function response<T>(data: T) { return { data, code: 'OK', message: '', requestId: 'test', timestamp: new Date().toISOString() }; }
beforeEach(() => {
  vi.resetAllMocks();
  setActivePinia(createPinia());
  vi.mocked(crmCustomersApi.context).mockResolvedValue(response(scope));
  vi.mocked(crmCustomersApi.detail).mockResolvedValue(response(customer));
  vi.mocked(crmCustomersApi.visits).mockResolvedValue(response([]));
  vi.mocked(crmCustomersApi.startVisit).mockResolvedValue(response({ visitId: '301', captureId: 'capture-1' }));
});
let page: VueWrapper | null = null;
afterEach(() => { page?.unmount(); page = null; });
function prepare() {
  const store = useSalesStore();
  location.mockResolvedValue({ longitude: 120.1, latitude: 30.2, accuracy: 10, timestamp: Date.now() });
  vi.mocked(salesApi.workDay).mockResolvedValue(response({ id: 'work-day-1', status: 'ACTIVE' } as WorkDayView));
  return store;
}
describe('CRM 私海拜访', () => {
  it('公海仅展示公开电话，认领携带当前版本并回到本人客户', async () => {
    const store = prepare();
    vi.spyOn(store, 'loadCrmCustomers').mockImplementation(async query => {
      store.crmCustomerContext = { employeeId: '20', permissions: ['crm:pool:claim'] };
      store.crmCustomers = [{ ...customer, poolType: query.view === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE', publicPhone: '0571-12345678' }];
    });
    vi.mocked(crmCustomersApi.claim).mockResolvedValue(response(undefined));
    page = mount(CrmCustomersPage, { global: { plugins: [Vant] } }); await flushPromises();
    await page.findAll('[role="tab"]').find(b => b.text().includes('公海认领'))!.trigger('click'); await flushPromises();
    expect(page.text()).toContain('0571-12345678'); expect(page.text()).not.toContain('联系人与联系方式');
    await page.findAll('button').find(b => b.text() === '认领到我的客户')!.trigger('click'); await flushPromises();
    expect(crmCustomersApi.claim).toHaveBeenCalledWith('1001', { revision: 1, requestId: expect.any(String) });
    expect(store.loadCrmCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ view: 'MINE' }));
  });
  it('原生壳的 WGS84 坐标经服务端转换后再发起拜访', async () => {
    const store = prepare(); location.mockResolvedValue({ longitude: 120, latitude: 30, accuracy: 10, timestamp: Date.now(), coordinateSystem: 'WGS84' });
    vi.mocked(salesApi.normalizeLocation).mockResolvedValue(response({ longitude: 120.004, latitude: 30.002, coordinateSystem: 'GCJ02' }));
    await store.startCrmVisit('1001');
    expect(crmCustomersApi.startVisit).toHaveBeenCalledWith(expect.objectContaining({ location: expect.objectContaining({ longitude: 120.004, latitude: 30.002 }) }));
  });
  it('页面展示本人的跟进信息并进入现有拜访采集页面', async () => {
    const store = prepare();
    store.crmCustomers = [customer];
    store.crmCustomerTotal = 1;
    store.crmCustomerContext = scope;
    vi.spyOn(store, 'loadCrmCustomers').mockResolvedValue();
    vi.spyOn(store, 'startCrmVisit').mockResolvedValue({ captureId: 'capture-1' });
    page = mount(CrmCustomersPage, { global: { plugins: [Vant] } });
    await flushPromises();
    expect(page.text()).toContain('DEV 私海门店');
    expect(page.text()).toContain('待首访');
    expect(page.text()).toContain('保护截止');
    await page.findAll('button').find(b => b.text().includes('开始 / 继续拜访'))!.trigger('click');
    await flushPromises();
    expect(store.startCrmVisit).toHaveBeenCalledWith('1001');
    expect(routerPush).toHaveBeenCalledWith({ path: '/visit', query: { visitId: 'capture-1' } });
  });
  it('没有拜访权限时页面保留查询，隐藏作业按钮', async () => {
    const store = prepare();
    store.crmCustomers = [customer];
    store.crmCustomerContext = { employeeId: '20', permissions: [] };
    vi.spyOn(store, 'loadCrmCustomers').mockResolvedValue();
    page = mount(CrmCustomersPage, { global: { plugins: [Vant] } });
    await flushPromises();
    expect(page.text()).toContain('DEV 私海门店');
    expect(page.findAll('button').some(b => b.text().includes('开始 / 继续拜访'))).toBe(false);
  });
  it('仅使用当前归属与设备定位发起新采集，不写旧门店拜访', async () => {
    const store = prepare();
    expect(await store.startCrmVisit(customer.id)).toEqual({ captureId: 'capture-1', storeId: '1001', crmVisitId: '301' });
    expect(crmCustomersApi.startVisit).toHaveBeenCalledWith(expect.objectContaining({
      storeId: '1001', ownershipId: '2001', workDayId: 'work-day-1',
      location: { longitude: 120.1, latitude: 30.2, accuracyMeters: 10, source: 'APP_NATIVE' },
    }));
  });
  it('门店已转交他人时禁止继续拜访', async () => {
    const store = prepare();
    vi.mocked(crmCustomersApi.detail).mockResolvedValue(response({ ...customer, ownerEmployeeId: '21' }));
    expect(await store.startCrmVisit(customer.id)).toBeNull();
    expect(crmCustomersApi.startVisit).not.toHaveBeenCalled();
    expect(getWorkbenchCapabilities().getCurrentLocation).not.toHaveBeenCalled();
    expect(store.visitError).toContain('当前负责人');
  });
  it('未签到时先进入考勤，不采集位置、不创建拜访', async () => {
    const store = prepare();
    vi.mocked(salesApi.workDay).mockRejectedValue(new ApiError('SALES_WORK_DAY_NOT_FOUND', '未签到', 404));
    expect(await store.startCrmVisit(customer.id)).toEqual({ attendanceRequired: true });
    expect(location).not.toHaveBeenCalled();
    expect(crmCustomersApi.startVisit).not.toHaveBeenCalled();
  });
  it('结果提交但尚未离店时恢复原采集，不能重复创建', async () => {
    const store = prepare();
    vi.mocked(crmCustomersApi.visits).mockResolvedValue(response([{ id: '301', ownershipId: '2001', salespersonId: '20', captureRef: 'existing-capture' }]));
    vi.mocked(salesApi.visit).mockResolvedValue(response({ id: 'existing-capture', status: 'CHECKED_IN' } as VisitView));
    expect(await store.startCrmVisit(customer.id)).toEqual({ captureId: 'existing-capture', storeId: '1001', crmVisitId: '301' });
    expect(crmCustomersApi.startVisit).not.toHaveBeenCalled();
    expect(salesApi.workDay).not.toHaveBeenCalled();
  });
  it('网络失败重试保持幂等键，成功后下一次拜访使用新键', async () => {
    const store = prepare();
    vi.mocked(crmCustomersApi.startVisit).mockRejectedValueOnce(new Error('网络超时'));
    expect(await store.startCrmVisit(customer.id)).toBeNull();
    location.mockResolvedValue({ longitude: 121, latitude: 31, accuracy: 20, timestamp: Date.now() });
    expect(await store.startCrmVisit(customer.id)).toEqual({ captureId: 'capture-1', storeId: '1001', crmVisitId: '301' });
    expect(await store.startCrmVisit(customer.id)).toEqual({ captureId: 'capture-1', storeId: '1001', crmVisitId: '301' });
    const calls = vi.mocked(crmCustomersApi.startVisit).mock.calls;
    expect(calls[1][0]).toEqual(calls[0][0]);
    expect(calls[1][0].requestId).toBe(calls[0][0].requestId);
    expect(calls[2][0].requestId).not.toBe(calls[1][0].requestId);
  });
  it('CRM 签到已建立但采集不存在时允许按原请求恢复，权限失败仍停止', async () => {
    const store = prepare();
    vi.mocked(crmCustomersApi.startVisit).mockRejectedValueOnce(new Error('网络超时'));
    expect(await store.startCrmVisit(customer.id)).toBeNull();
    vi.mocked(crmCustomersApi.visits).mockResolvedValue(response([{ id: '301', ownershipId: '2001', salespersonId: '20', captureRef: 'existing-capture' }]));
    vi.mocked(salesApi.visit).mockRejectedValueOnce(new ApiError('SALES_VISIT_NOT_FOUND', '采集尚未建立', 404));
    expect(await store.startCrmVisit(customer.id)).toEqual({ captureId: 'capture-1', storeId: '1001', crmVisitId: '301' });
    vi.mocked(crmCustomersApi.startVisit).mockClear();
    vi.mocked(salesApi.visit).mockRejectedValueOnce(new ApiError('FORBIDDEN', '已无权限', 403));
    expect(await store.startCrmVisit(customer.id)).toBeNull(); expect(crmCustomersApi.startVisit).not.toHaveBeenCalled();
  });
  it('会话清理后，未完成的查询响应不能重新写回客户数据', async () => {
    const store = prepare();
    let resolve!: (value: ReturnType<typeof response<{ items: CrmCustomer[]; total: number; nextCursor: string | null }>>) => void;
    vi.mocked(crmCustomersApi.list).mockImplementation(() => new Promise(r => { resolve = r; }));
    const loading = store.loadCrmCustomers({});
    store.clear();
    resolve(response({ items: [customer], total: 1, nextCursor: null }));
    await loading;
    expect(store.crmCustomers).toEqual([]);
    expect(store.crmCustomerContext).toBeNull();
  });
});
