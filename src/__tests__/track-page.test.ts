import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vant, { DatePicker } from 'vant';
import { mockAdapter, setFeishuAdapter } from '@/adapters';
import { localDate } from '@/utils/datetime';

const mocks = vi.hoisted(() => ({
  workDay: vi.fn(),
  workDayTrack: vi.fn(),
  visits: vi.fn(),
  isAmapConfigured: vi.fn(() => true),
  loadAmap: vi.fn(),
  markerConstructor: vi.fn(),
  mapInstance: {
    add: vi.fn(),
    setFitView: vi.fn(),
    resize: vi.fn(),
    destroy: vi.fn(),
  },
}));

vi.mock('@/api/core/sales', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/core/sales')>();
  return {
    ...original,
    salesApi: {
      ...original.salesApi,
      workDay: mocks.workDay,
      workDayTrack: mocks.workDayTrack,
      visits: mocks.visits,
    },
  };
});

vi.mock('@/utils/amap', () => ({
  isAmapConfigured: mocks.isAmapConfigured,
  loadAmap: mocks.loadAmap,
}));

import TrackPage from '@/pages/TrackPage.vue';

function ok<T>(data: T) {
  return { code: 'SUCCESS', message: 'ok', data, requestId: 'r-1', timestamp: '2026-08-09T00:00:00Z' };
}

function dateValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function workDayFixture(businessDate: string) {
  return {
    id: `wd-${businessDate}`,
    employeeId: 'employee-1',
    salesProfileId: 'profile-1',
    businessDate,
    timezoneId: 'Asia/Shanghai',
    fieldPolicyVersionId: 'policy-version-1',
    status: 'FINISHED',
    checkedInAt: `${businessDate}T01:00:00Z`,
    checkedOutAt: `${businessDate}T09:00:00Z`,
    locationSessionId: 'session-1',
    locationPointCount: 2,
    interruptionCount: 0,
    verifiedWorkMinutes: 480,
    evidenceQuality: 'GOOD',
  };
}

function trackFixture(businessDate: string) {
  return {
    workDayId: `wd-${businessDate}`,
    businessDate,
    status: 'FINISHED',
    totalDistanceMeters: 1400,
    trackedDurationMinutes: 60,
    points: [
      {
        longitude: 116.397,
        latitude: 39.908,
        accuracyMeters: 10,
        clientOccurredAt: `${businessDate}T01:05:00Z`,
        serverReceivedAt: `${businessDate}T01:05:01Z`,
        source: 'FEISHU',
        qualityStatus: 'VALID',
      },
      {
        longitude: 116.407,
        latitude: 39.918,
        accuracyMeters: 12,
        clientOccurredAt: `${businessDate}T02:05:00Z`,
        serverReceivedAt: `${businessDate}T02:05:01Z`,
        source: 'FEISHU',
        qualityStatus: 'VALID',
      },
    ],
    punches: [],
    visits: [
      {
        visitId: 'visit-1', sequence: 1, storeId: 'store-1', storeName: '协和医院门店',
        longitude: 116.397, latitude: 39.908, status: 'CHECKED_OUT',
        checkedInAt: `${businessDate}T01:10:00Z`, checkedOutAt: `${businessDate}T01:40:00Z`,
        dwellMinutes: 30, visitType: 'FIRST_VISIT', reviewStatus: 'PENDING_REVIEW',
      },
    ],
    segments: [],
  };
}

describe('TrackPage 日期轨迹与全屏地图', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    setFeishuAdapter(mockAdapter);
    mocks.workDay.mockImplementation((date: string) => Promise.resolve(ok(workDayFixture(date))));
    mocks.workDayTrack.mockImplementation((date: string) => Promise.resolve(ok(trackFixture(date))));
    mocks.visits.mockResolvedValue(ok({ items: [], page: 1, pageSize: 20, total: 0 }));
    const MapConstructor = vi.fn(function () {
      return mocks.mapInstance;
    });
    mocks.loadAmap.mockResolvedValue({
      Map: MapConstructor,
      Polyline: vi.fn(function () { return { type: 'polyline' }; }),
      Marker: mocks.markerConstructor.mockImplementation(function () { return { type: 'marker' }; }),
    });
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    document.body.classList.remove('track-map-fullscreen-lock');
  });

  async function renderPage(): Promise<VueWrapper> {
    wrapper = mount(TrackPage, {
      global: {
        plugins: [Vant],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it('默认查询今天，并在选择历史日期后重新请求该日工作日和轨迹', async () => {
    const page = await renderPage();
    expect(mocks.workDay).toHaveBeenCalledWith(localDate());
    expect(mocks.workDayTrack).toHaveBeenCalledWith(localDate());

    const historicalDate = new Date();
    historicalDate.setDate(historicalDate.getDate() - 1);
    const historicalDateValue = dateValue(historicalDate);
    await page.get('[data-testid="track-date-button"]').trigger('click');
    await flushPromises();
    page.findComponent(DatePicker).vm.$emit('confirm', {
      selectedValues: historicalDateValue.split('-'),
      selectedOptions: [],
      selectedIndexes: [],
    });
    await flushPromises();

    expect(mocks.workDay).toHaveBeenLastCalledWith(historicalDateValue);
    expect(mocks.workDayTrack).toHaveBeenLastCalledWith(historicalDateValue);
    expect(page.text()).toContain(`${historicalDate.getMonth() + 1}月${historicalDate.getDate()}日工作日`);
    expect(page.text()).toContain('回到今天');
  });

  it('支持进入和退出沉浸式全屏，并通知高德地图重新计算尺寸', async () => {
    const page = await renderPage();
    const button = page.get('[data-testid="track-fullscreen-button"]');

    await button.trigger('click');
    expect(page.get('.track-map-wrap').classes()).toContain('track-map-wrap--fullscreen');
    expect(document.body.classList.contains('track-map-fullscreen-lock')).toBe(true);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(mocks.mapInstance.resize).toHaveBeenCalled();

    await page.get('[data-testid="track-fullscreen-button"]').trigger('click');
    expect(page.get('.track-map-wrap').classes()).not.toContain('track-map-wrap--fullscreen');
    expect(document.body.classList.contains('track-map-fullscreen-lock')).toBe(false);
  });

  it('拜访点使用蓝色数字标记，不再把DOM元素转成object字符串', async () => {
    await renderPage();

    const visitMarker = mocks.markerConstructor.mock.calls
      .map(([options]) => options)
      .find((options) => options.title?.includes('协和医院门店'));
    expect(visitMarker.content).toContain('sales-map-visit-marker');
    expect(visitMarker.content).toContain('>1</span>');
    expect(visitMarker.label).toBeUndefined();
    expect(JSON.stringify(visitMarker)).not.toContain('[object HTMLSpanElement]');
  });
});
