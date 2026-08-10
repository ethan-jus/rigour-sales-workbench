import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vant from 'vant';
import { mockAdapter, setFeishuAdapter } from '@/adapters';
import { localDate } from '@/utils/datetime';

const mocks = vi.hoisted(() => ({
  workDay: vi.fn(),
  context: vi.fn(),
  activitySummary: vi.fn(),
  attendanceMonth: vi.fn(),
}));

vi.mock('@/api/core/sales', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/core/sales')>();
  return {
    ...original,
    salesApi: {
      ...original.salesApi,
      workDay: mocks.workDay,
      context: mocks.context,
      activitySummary: mocks.activitySummary,
      attendanceMonth: mocks.attendanceMonth,
    },
  };
});

import AttendancePage from '@/pages/AttendancePage.vue';

function ok<T>(data: T) {
  return { code: 'SUCCESS', message: 'ok', data, requestId: 'r-1', timestamp: new Date().toISOString() };
}

describe('AttendancePage 月度出勤事实', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    setFeishuAdapter(mockAdapter);
    const today = localDate();
    const month = today.slice(0, 7);
    mocks.workDay.mockResolvedValue(ok({
      id: 'wd-today', employeeId: 'employee-1', salesProfileId: 'profile-1', businessDate: today,
      timezoneId: 'Asia/Shanghai', fieldPolicyVersionId: 'policy-1', status: 'FINISHED',
      checkedInAt: `${today}T01:00:00Z`, checkedOutAt: `${today}T09:00:00Z`, locationSessionId: 'session-1',
      locationPointCount: 10, interruptionCount: 0, verifiedWorkMinutes: 480, evidenceQuality: 'PENDING',
    }));
    mocks.context.mockResolvedValue(ok({
      userId: 'u-1', employeeId: 'employee-1', salesProfileId: 'profile-1', salesNo: 'S001',
      cityOrgId: null, profileStatus: 'ACTIVE', permissions: [],
      fieldPolicy: {
        id: 'policy-1', policyCode: 'DEFAULT', policyName: '外勤规则', versionNo: 1,
        publishStatus: 'PUBLISHED', timezoneId: 'Asia/Shanghai', businessDayCutoff: '04:00:00',
        checkInWindowStart: null, checkInWindowEnd: null, checkOutWindowStart: null, checkOutWindowEnd: null,
        standardWorkMinutes: 480, minimumWorkMinutes: 420, requireCheckOut: true, allowAdjustment: true,
        adjustmentDeadlineHours: 24, locationEnabled: true, locationIntervalMinutes: 5,
        minimumLocationAccuracyMeters: 100, offlineUploadDeadlineMinutes: 30,
        effectiveFrom: `${month}-01T00:00:00Z`,
      },
    }));
    mocks.activitySummary.mockResolvedValue(ok({
      from: today, to: today, totalVisitCount: 2, completedVisitCount: 2, inProgressVisitCount: 0,
      effectiveVisitCount: 1, pendingReviewVisitCount: 1, firstVisitCount: 1, revisitCount: 1,
      uniqueStoreCount: 2, assignedStoreCount: 10,
    }));
    mocks.attendanceMonth.mockImplementation((requestedMonth: string) => Promise.resolve(ok({
      month: requestedMonth,
      today,
      days: [
        { businessDate: `${requestedMonth}-01`, workDayId: 'wd-1', scheduleStatus: 'WORK_RECORDED',
          attendanceStatus: 'MEETS_MINIMUM', checkedInAt: `${requestedMonth}-01T01:00:00Z`,
          checkedOutAt: `${requestedMonth}-01T09:00:00Z`, verifiedWorkMinutes: 480,
          minimumWorkMinutes: 420, evidenceQuality: 'PENDING' },
        { businessDate: `${requestedMonth}-02`, workDayId: 'wd-2', scheduleStatus: 'WORK_RECORDED',
          attendanceStatus: 'SHORT', checkedInAt: `${requestedMonth}-02T02:00:00Z`,
          checkedOutAt: `${requestedMonth}-02T05:00:00Z`, verifiedWorkMinutes: 180,
          minimumWorkMinutes: 420, evidenceQuality: 'PENDING' },
        { businessDate: `${requestedMonth}-03`, workDayId: null, scheduleStatus: 'UNKNOWN',
          attendanceStatus: 'NO_RECORD', checkedInAt: null, checkedOutAt: null, verifiedWorkMinutes: 0,
          minimumWorkMinutes: null, evidenceQuality: null },
      ],
    })));
  });

  it('展示达标、未达标和无记录，并明确无排班时不判定旷工', async () => {
    const page = mount(AttendancePage, { global: { plugins: [Vant] } });
    await flushPromises();

    expect(page.text()).toContain('本月出勤');
    expect(page.text()).toContain('工时达标');
    expect(page.text()).toContain('未达标');
    expect(page.text()).toContain('无记录');
    await page.findAll('.attendance-calendar__day')[2].trigger('click');
    expect(page.text()).toContain('未结合排班、请假和人工认定，不能据此判定旷工');
  });
});
