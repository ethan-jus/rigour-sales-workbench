import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vant from 'vant';
import type { VisitView } from '@/api/core/sales';
import { localDate } from '@/utils/datetime';

const routerPush = vi.hoisted(() => vi.fn());
const routeQuery = vi.hoisted(() => ({ value: { tab: '1' } as Record<string, string> }));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: routeQuery.value }),
  useRouter: () => ({ push: routerPush }),
}));

import VisitTargetsPage from '@/pages/VisitTargetsPage.vue';
import { useSalesStore } from '@/stores/sales';

function visitFixture(): VisitView {
  return {
    id: 'visit-1', workDayId: 'work-day-1', salesProfileId: 'profile-1',
    targetType: 'MY_STORE', customerId: 'customer-1', storeId: 'store-1', status: 'CHECKED_IN',
    checkedInAt: '2026-08-11T01:00:00Z', checkedOutAt: null, visitPolicyVersionId: 'policy-1',
    targetSnapshot: null, checkpoints: [], createdAt: '2026-08-11T01:00:00Z',
    contactOutcome: null, kpName: null, kpPhone: null, intentionLevel: null,
    resultNote: null, resultSubmittedAt: null, visitType: 'FIRST_VISIT', reviewStatus: 'IN_PROGRESS',
  };
}

describe('VisitTargetsPage 长操作反馈', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    setActivePinia(createPinia());
    routerPush.mockReset();
    routeQuery.value = { tab: '1' };
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
  });

  function mountPage() {
    return mount(VisitTargetsPage, {
      global: {
        plugins: [Vant],
        stubs: {
          VanTabs: { template: '<div><slot /></div>' },
          VanTab: { template: '<section><slot /></section>' },
        },
      },
    });
  }

  it('发起拜访时在定位和创建阶段持续显示loading并阻止重复点击', async () => {
    const store = useSalesStore();
    store.targets = {
      items: [{
        projectionId: 'projection-1', targetType: 'MY_STORE', customerId: 'customer-1',
        storeId: 'store-1', customerName: '测试客户', storeName: '测试门店',
        storeAddress: '测试路1号', longitude: 120.1, latitude: 30.2,
        storeStatus: 'ACTIVE', sourceVersion: 1, sourceUpdatedAt: '2026-08-11T00:00:00Z',
      }],
      page: 1, pageSize: 20, total: 1,
    };
    store.workDay = {
      id: 'work-day-1', employeeId: 'employee-1', salesProfileId: 'profile-1',
      businessDate: localDate(), timezoneId: 'Asia/Shanghai', fieldPolicyVersionId: 'field-policy-1',
      status: 'ACTIVE', checkedInAt: '2026-08-11T00:00:00Z', checkedOutAt: null,
      locationSessionId: 'location-1', locationPointCount: 1, interruptionCount: 0,
      verifiedWorkMinutes: 0, evidenceQuality: 'GOOD',
    };
    vi.spyOn(store, 'loadTargets').mockResolvedValue(store.targets);
    vi.spyOn(store, 'loadVisitPlans').mockResolvedValue(null);
    let resolveLocation!: (value: {
      latitude: number; longitude: number; accuracy: number; timestamp: number;
    }) => void;
    vi.spyOn(store, 'getCurrentLocation').mockImplementation(() => new Promise((resolve) => {
      resolveLocation = resolve;
    }));
    let resolveVisit!: (value: VisitView | null) => void;
    vi.spyOn(store, 'createVisit').mockImplementation(() => new Promise((resolve) => {
      resolveVisit = resolve;
    }));

    wrapper = mountPage();
    await flushPromises();
    const visitButton = wrapper.findAll('button').find((button) => button.text().includes('发起拜访'))!;
    await visitButton.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('正在获取到店位置');
    expect(wrapper.text()).toContain('处理中');
    await visitButton.trigger('click');
    expect(store.getCurrentLocation).toHaveBeenCalledTimes(1);

    resolveLocation({ latitude: 30.2, longitude: 120.1, accuracy: 12, timestamp: Date.now() });
    await flushPromises();
    expect(wrapper.text()).toContain('正在创建拜访');

    resolveVisit(visitFixture());
    await flushPromises();
    expect(routerPush).toHaveBeenCalledWith({ path: '/visit', query: { visitId: 'visit-1' } });
  });

  it('今日计划按服务端planId发起，保留临时拜访双来源', async () => {
    routeQuery.value = { tab: '0' };
    const store = useSalesStore();
    store.visitPlans = {
      date: localDate(),
      items: [{
        planId: 'plan-1', plannedDate: localDate(), targetType: 'MY_STORE',
        customerId: 'customer-1', storeId: 'store-1', customerName: '测试客户',
        storeName: '计划门店', storeAddress: '计划路1号', longitude: 120.1, latitude: 30.2,
        objective: '核对陈列并确认补货', status: 'PLANNED', visitId: null, version: 0,
      }],
    };
    store.workDay = {
      id: 'work-day-1', employeeId: 'employee-1', salesProfileId: 'profile-1',
      businessDate: localDate(), timezoneId: 'Asia/Shanghai', fieldPolicyVersionId: 'field-policy-1',
      status: 'ACTIVE', checkedInAt: '2026-08-11T00:00:00Z', checkedOutAt: null,
      locationSessionId: 'location-1', locationPointCount: 1, interruptionCount: 0,
      verifiedWorkMinutes: 0, evidenceQuality: 'GOOD',
    };
    vi.spyOn(store, 'loadVisitPlans').mockResolvedValue(store.visitPlans);
    vi.spyOn(store, 'loadTargets').mockResolvedValue(null);
    vi.spyOn(store, 'getCurrentLocation').mockResolvedValue({
      latitude: 30.2, longitude: 120.1, accuracy: 12, timestamp: Date.now(),
    });
    const create = vi.spyOn(store, 'createVisit').mockResolvedValue(visitFixture());

    wrapper = mountPage();
    await flushPromises();
    await wrapper.findAll('button').find((button) => button.text() === '开始计划拜访')!.trigger('click');
    await flushPromises();

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      visitPlanId: 'plan-1', targetType: 'MY_STORE', storeId: 'store-1',
    }));
  });

  it('手动刷新附近门店时重新定位，并绕过附近门店短缓存', async () => {
    routeQuery.value = { tab: '2' };
    const store = useSalesStore();
    vi.spyOn(store, 'loadVisitPlans').mockResolvedValue(null);
    vi.spyOn(store, 'loadTargets').mockResolvedValue(null);
    const locate = vi.spyOn(store, 'getCurrentLocation')
      .mockResolvedValueOnce({ latitude: 30.2, longitude: 120.1, accuracy: 12, timestamp: 1 })
      .mockResolvedValueOnce({ latitude: 30.21, longitude: 120.11, accuracy: 10, timestamp: 2 });
    const nearby = vi.spyOn(store, 'loadNearbyStores').mockResolvedValue({
      items: [], page: 1, pageSize: 20, total: 0,
    });

    wrapper = mountPage();
    await flushPromises();
    expect(locate).toHaveBeenNthCalledWith(1, 30_000);

    await wrapper.find('.nearby-search button').trigger('click');
    await flushPromises();

    expect(locate).toHaveBeenNthCalledWith(2, 0);
    expect(nearby).toHaveBeenLastCalledWith(120.11, 30.21, 3000, '', 1, true);
  });
});
