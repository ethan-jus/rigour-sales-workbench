import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vant from 'vant';
import { localDate } from '@/utils/datetime';
import type { VisitView } from '@/api/core/sales';

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  workDay: vi.fn(),
  visits: vi.fn(),
  visitPlans: vi.fn(),
  activitySummary: vi.fn(),
}));

vi.mock('@/api/core/sales', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/core/sales')>();
  return {
    ...original,
    salesApi: {
      ...original.salesApi,
      context: mocks.context,
      workDay: mocks.workDay,
      visits: mocks.visits,
      visitPlans: mocks.visitPlans,
      activitySummary: mocks.activitySummary,
    },
  };
});

import HomePage from '@/pages/HomePage.vue';

function ok<T>(data: T) {
  return { code: 'SUCCESS', message: 'ok', data, requestId: 'r-1', timestamp: new Date().toISOString() };
}

function activeVisit(): VisitView {
  return {
    id: 'visit-1',
    workDayId: 'work-day-1',
    salesProfileId: 'profile-1',
    targetType: 'MY_STORE',
    customerId: 'customer-1',
    storeId: 'store-1',
    status: 'CHECKED_IN',
    checkedInAt: '2026-08-11T01:30:00Z',
    checkedOutAt: null,
    visitPolicyVersionId: 'visit-policy-1',
    targetSnapshot: {
      targetType: 'MY_STORE',
      customerId: 'customer-1',
      storeId: 'store-1',
      customerName: '华东经销商',
      storeName: '华东旗舰店',
      storeAddress: '上海市徐汇区',
      longitude: 121.43,
      latitude: 31.18,
      assignedSalesProfileId: 'profile-1',
    },
    checkpoints: [],
    createdAt: '2026-08-11T01:30:00Z',
    contactOutcome: null,
    kpName: null,
    kpPhone: null,
    intentionLevel: null,
    resultNote: null,
    resultSubmittedAt: null,
    visitType: 'FIRST_VISIT',
    reviewStatus: 'IN_PROGRESS',
  };
}

function installSuccessfulResponses(visits: VisitView[] = []) {
  const today = localDate();
  mocks.context.mockResolvedValue(ok({
    userId: 'user-1', employeeId: 'employee-1', salesProfileId: 'profile-1', salesNo: 'S001',
    cityOrgId: null, profileStatus: 'ACTIVE', permissions: [],
    fieldPolicy: {
      id: 'policy-1', policyCode: 'DEFAULT', policyName: '默认外勤规则', versionNo: 1,
      publishStatus: 'PUBLISHED', timezoneId: 'Asia/Shanghai', businessDayCutoff: '04:00:00',
      checkInWindowStart: null, checkInWindowEnd: null, checkOutWindowStart: null, checkOutWindowEnd: null,
      standardWorkMinutes: 480, minimumWorkMinutes: 420, requireCheckOut: true, allowAdjustment: true,
      adjustmentDeadlineHours: 24, locationEnabled: true, locationIntervalMinutes: 5,
      minimumLocationAccuracyMeters: 100, offlineUploadDeadlineMinutes: 30,
      effectiveFrom: `${today}T00:00:00Z`,
    },
  }));
  mocks.workDay.mockResolvedValue(ok({
    id: 'work-day-1', employeeId: 'employee-1', salesProfileId: 'profile-1', businessDate: today,
    timezoneId: 'Asia/Shanghai', fieldPolicyVersionId: 'policy-1', status: 'ACTIVE',
    checkedInAt: `${today}T01:00:00Z`, checkedOutAt: null, locationSessionId: 'location-1',
    locationPointCount: 4, interruptionCount: 0, verifiedWorkMinutes: 0, evidenceQuality: 'PENDING',
  }));
  mocks.visits.mockResolvedValue(ok({ items: visits, page: 1, pageSize: 20, total: visits.length }));
  mocks.visitPlans.mockResolvedValue(ok({ date: today, items: [] }));
  mocks.activitySummary.mockResolvedValue(ok({
    from: today, to: today, totalVisitCount: 3, completedVisitCount: 2, inProgressVisitCount: visits.length,
    effectiveVisitCount: 1, pendingReviewVisitCount: 1, firstVisitCount: 2, revisitCount: 1,
    uniqueStoreCount: 3, assignedStoreCount: 12,
  }));
}

function renderHome() {
  return mount(HomePage, {
    global: {
      plugins: [Vant],
      stubs: {
        RouterLink: { props: ['to'], template: '<a><slot /></a>' },
      },
    },
  });
}

describe('HomePage 执行优先布局', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
  });

  it('签到后把选择拜访对象作为唯一主操作', async () => {
    installSuccessfulResponses();
    const page = renderHome();
    await flushPromises();

    expect(page.text()).toContain('选择今天要拜访的门店');
    expect(page.findAll('button').map((button) => button.text())).toContain('选择拜访对象');
    expect(page.text()).not.toContain('当前拜访');
    expect(page.text()).toContain('待复核');
  });

  it('有进行中拜访时优先恢复现场任务', async () => {
    installSuccessfulResponses([activeVisit()]);
    const page = renderHome();
    await flushPromises();

    expect(page.text()).toContain('正在执行');
    expect(page.text()).toContain('华东旗舰店');
    expect(page.findAll('button').map((button) => button.text())).toContain('继续本次拜访');
  });

  it('相同接口错误只集中展示一次', async () => {
    const expired = new Error('登录已过期，请重新登录');
    mocks.context.mockRejectedValue(expired);
    mocks.workDay.mockRejectedValue(expired);
    mocks.visits.mockRejectedValue(expired);
    mocks.visitPlans.mockRejectedValue(expired);
    mocks.activitySummary.mockRejectedValue(expired);
    const page = renderHome();
    await flushPromises();

    expect(page.text()).toContain('工作台数据未能完整读取');
    expect(page.text().split('登录已过期，请重新登录')).toHaveLength(2);
    expect(page.findAll('button').map((button) => button.text())).toContain('重新读取');
  });
});
