import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { VisitView } from '@/api/core/sales';
import { mockAdapter, setFeishuAdapter } from '@/adapters';

const mocks = vi.hoisted(() => ({
  nearbyStores: vi.fn(),
  visits: vi.fn(),
  createVisit: vi.fn(),
  checkOutVisit: vi.fn(),
  submitVisitResult: vi.fn(),
  recordings: vi.fn(),
  uploadLocationPoints: vi.fn(),
  reportInterruption: vi.fn(),
  workDayTrack: vi.fn(),
  visitEvidence: vi.fn(),
}));

vi.mock('@/api/core/sales', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/core/sales')>();
  return {
    ...original,
    salesApi: {
      ...original.salesApi,
      nearbyStores: mocks.nearbyStores,
      visits: mocks.visits,
      createVisit: mocks.createVisit,
      checkOutVisit: mocks.checkOutVisit,
      submitVisitResult: mocks.submitVisitResult,
      recordings: mocks.recordings,
      uploadLocationPoints: mocks.uploadLocationPoints,
      reportInterruption: mocks.reportInterruption,
      workDayTrack: mocks.workDayTrack,
      visitEvidence: mocks.visitEvidence,
    },
  };
});

import { useSalesStore } from '@/stores/sales';

function visitFixture(id: string, status: string): VisitView {
  return {
    id,
    workDayId: 'wd-1',
    salesProfileId: 'sp-1',
    targetType: 'MY_STORE',
    customerId: null,
    storeId: 'store-1',
    status,
    checkedInAt: '2026-08-08T01:00:00Z',
    checkedOutAt: status === 'CHECKED_OUT' ? '2026-08-08T02:00:00Z' : null,
    visitPolicyVersionId: 'policy-1',
    targetSnapshot: null,
    checkpoints: [],
    createdAt: '2026-08-08T01:00:00Z',
    contactOutcome: null,
    kpName: null,
    kpPhone: null,
    intentionLevel: null,
    resultNote: null,
    resultSubmittedAt: null,
    visitType: 'FIRST_VISIT',
    reviewStatus: status === 'CHECKED_IN' ? 'IN_PROGRESS' : 'PENDING_REVIEW',
  };
}

function ok<T>(data: T) {
  return { code: 'SUCCESS', message: 'ok', data, requestId: 'r-1', timestamp: '2026-08-08T00:00:00Z' };
}

describe('salesStore 拜访闭环', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    setFeishuAdapter(mockAdapter);
  });

  it('附近门店查询失败只写入 nearbyError，不污染其他页共享的 errorMessage', async () => {
    mocks.nearbyStores.mockRejectedValue(new Error('高德配额不足'));
    const store = useSalesStore();

    const result = await store.loadNearbyStores(121.47, 31.23, 3000);

    expect(result).toBeNull();
    expect(store.nearbyError).toContain('高德配额不足');
    expect(store.errorMessage).toBeNull();
  });

  it('附近门店一分钟内重复查询复用结果，避免重复等待高德', async () => {
    const page = { items: [], page: 1, pageSize: 20, total: 0 };
    mocks.nearbyStores.mockResolvedValue(ok(page));
    const store = useSalesStore();

    await store.loadNearbyStores(121.47, 31.23, 3000);
    await store.loadNearbyStores(121.47, 31.23, 3000);

    expect(mocks.nearbyStores).toHaveBeenCalledTimes(1);
    expect(store.nearbyStores).toEqual(page);
  });

  it('附近门店并发查询只展示最后一次条件的结果', async () => {
    let resolveFirst!: (value: ReturnType<typeof ok>) => void;
    let resolveSecond!: (value: ReturnType<typeof ok>) => void;
    mocks.nearbyStores
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    const store = useSalesStore();

    const first = store.loadNearbyStores(121.47, 31.23, 1000);
    const second = store.loadNearbyStores(121.47, 31.23, 5000);
    expect(store.nearbyLoading).toBe(true);
    resolveSecond(ok({ items: [{ poiId: 'latest' }], page: 1, pageSize: 20, total: 1 }));
    await second;
    resolveFirst(ok({ items: [{ poiId: 'stale' }], page: 1, pageSize: 20, total: 1 }));
    await first;

    expect(store.nearbyStores?.items[0]?.poiId).toBe('latest');
    expect(store.nearbyLoading).toBe(false);
  });

  it('短时间重复取当前位置合并请求并复用最新点位', async () => {
    const getCurrentLocation = vi.fn(async () => ({
      latitude: 31.23, longitude: 121.47, accuracy: 12, timestamp: Date.now(),
    }));
    setFeishuAdapter({ ...mockAdapter, getCurrentLocation });
    const store = useSalesStore();

    const [first, second] = await Promise.all([
      store.getCurrentLocation(30_000),
      store.getCurrentLocation(30_000),
    ]);
    const third = await store.getCurrentLocation(30_000);

    expect(getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(third).toEqual(first);
  });

  it('拜访列表查询失败只写入 visitsError', async () => {
    mocks.visits.mockRejectedValue(new Error('网络异常'));
    const store = useSalesStore();

    const result = await store.loadVisits();

    expect(result).toBeNull();
    expect(store.visitsError).toContain('网络异常');
    expect(store.errorMessage).toBeNull();
  });

  it('创建拜访成功后同步插入已加载的拜访列表头部', async () => {
    const existing = visitFixture('v-1', 'CHECKED_OUT');
    mocks.visits.mockResolvedValue(ok({ items: [existing], page: 1, pageSize: 20, total: 1 }));
    const created = visitFixture('v-2', 'CHECKED_IN');
    mocks.createVisit.mockResolvedValue(ok(created));
    const store = useSalesStore();

    await store.loadVisits();
    await store.createVisit({
      idempotencyKey: 'k-1',
      workDayId: 'wd-1',
      targetType: 'MY_STORE',
      storeId: 'store-1',
      location: { longitude: 121.47, latitude: 31.23, accuracyMeters: 30, source: 'FEISHU' },
      clientOccurredAt: '2026-08-08T01:00:00Z',
      deviceEventId: 'evt-1',
    });

    expect(store.activeVisit?.id).toBe('v-2');
    expect(store.visits?.items.map((item) => item.id)).toEqual(['v-2', 'v-1']);
    expect(store.visits?.total).toBe(2);
  });

  it('签退成功后同步更新列表中对应拜访的状态', async () => {
    const checking = visitFixture('v-1', 'CHECKED_IN');
    mocks.visits.mockResolvedValue(ok({ items: [checking], page: 1, pageSize: 20, total: 1 }));
    mocks.checkOutVisit.mockResolvedValue(ok(visitFixture('v-1', 'CHECKED_OUT')));
    const store = useSalesStore();

    await store.loadVisits();
    await store.checkOutVisit('v-1', {
      idempotencyKey: 'k-2',
      clientOccurredAt: '2026-08-08T02:00:00Z',
      location: { longitude: 121.47, latitude: 31.23, accuracyMeters: 30, source: 'FEISHU' },
      deviceEventId: 'evt-2',
    });

    expect(store.activeVisit?.status).toBe('CHECKED_OUT');
    expect(store.visits?.items[0]?.status).toBe('CHECKED_OUT');
  });

  it('保存结果后同步详情和列表，录音规则由服务端会话返回', async () => {
    const checking = visitFixture('v-1', 'CHECKED_IN');
    mocks.visits.mockResolvedValue(ok({ items: [checking], page: 1, pageSize: 20, total: 1 }));
    mocks.submitVisitResult.mockResolvedValue(ok({
      ...checking,
      contactOutcome: 'CONTACTED',
      kpName: '王店长',
      kpPhone: '13800001234',
      intentionLevel: 'HIGH',
      resultNote: '下周跟进',
      resultSubmittedAt: '2026-08-09T03:00:00Z',
    }));
    mocks.recordings.mockResolvedValue(ok({
      sessionId: null,
      visitId: 'v-1',
      status: 'NOT_STARTED',
      evidenceStatus: 'PENDING',
      clipCount: 0,
      uploadedTotalDurationMs: 0,
      verifiedTotalDurationMs: 0,
      recordingEnabled: true,
      minimumRecordingSeconds: 600,
      minimumClipSeconds: 30,
      clips: [],
    }));
    const store = useSalesStore();

    await store.loadVisits();
    const updated = await store.submitVisitResult('v-1', {
      contactOutcome: 'CONTACTED', kpName: '王店长', kpPhone: '13800001234',
      intentionLevel: 'HIGH', resultNote: '下周跟进',
    });
    const recordings = await store.loadRecordings('v-1');

    expect(updated?.resultSubmittedAt).toBeTruthy();
    expect(store.visits?.items[0]?.kpName).toBe('王店长');
    expect(recordings?.recordingEnabled).toBe(true);
    expect(recordings?.minimumRecordingSeconds).toBe(600);
    expect(recordings?.minimumClipSeconds).toBe(30);
  });

  it('门头照由相机采集并固定声明FEISHU_CAMERA后上传', async () => {
    const uploadPhoto = vi.fn(async () => {});
    const discardPhoto = vi.fn(async () => {});
    setFeishuAdapter({
      ...mockAdapter,
      getCurrentLocation: async () => ({
        latitude: 31.23, longitude: 121.47, accuracy: 12, timestamp: Date.now(),
      }),
      captureStorefrontPhoto: async () => ({
        localPhotoId: 'photo-1', tempFilePath: 'ttfile://photo.jpg', capturedAt: Date.now(),
      }),
      uploadPhoto,
      discardPhoto,
    });
    mocks.visitEvidence.mockResolvedValue(ok({
      visitId: 'v-1', requiredStorefrontPhotoCount: 1, storefrontPhotoCount: 1,
      storefrontPhotoSatisfied: true, photos: [],
    }));
    const store = useSalesStore();

    const result = await store.captureAndUploadStorefrontPhoto('v-1');

    expect(result?.storefrontPhotoSatisfied).toBe(true);
    expect(uploadPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ localPhotoId: 'photo-1' }),
      expect.objectContaining({
        formData: expect.objectContaining({
          clientEvidenceId: 'photo-1', captureSource: 'FEISHU_CAMERA',
          longitude: '121.47', latitude: '31.23', accuracyMeters: '12',
        }),
      }),
    );
    expect(discardPhoto).toHaveBeenCalledTimes(1);
    expect(store.hasPendingStorefrontPhoto).toBe(false);
  });

  it('轨迹查询成功写入 track，失败只写入 trackError', async () => {
    const store = useSalesStore();
    mocks.workDayTrack.mockResolvedValue(ok({
      workDayId: 'wd-1',
      businessDate: '2026-08-09',
      status: 'ACTIVE',
      totalDistanceMeters: 0,
      trackedDurationMinutes: 0,
      points: [{ longitude: 121.47, latitude: 31.23, accuracyMeters: 20,
        clientOccurredAt: null, serverReceivedAt: '2026-08-09T01:00:00Z', source: 'FEISHU',
        qualityStatus: 'ACCEPTED' }],
      punches: [{ eventType: 'CHECK_IN', clientOccurredAt: null,
        serverReceivedAt: '2026-08-09T00:30:00Z', longitude: 121.47, latitude: 31.23,
        accuracyMeters: 15, evidenceStatus: 'VALID' }],
      visits: [],
      segments: [],
    }));
    const loaded = await store.loadTrack('2026-08-09');
    expect(loaded?.points).toHaveLength(1);
    expect(store.trackError).toBeNull();

    mocks.workDayTrack.mockRejectedValue(new Error('销售工作日不存在'));
    const failed = await store.loadTrack('2026-08-10');
    expect(failed).toBeNull();
    expect(store.track).toBeNull();
    expect(store.trackError).toContain('销售工作日不存在');
    expect(store.errorMessage).toBeNull();
  });

  it('应用级定位会话在页面外仍把采样点上传到当前工作日', async () => {
    const stopLocation = vi.fn(async () => {});
    setFeishuAdapter({
      ...mockAdapter,
      startLocation: async (onPoint) => {
        onPoint({ latitude: 31.23, longitude: 121.47, accuracy: 12, timestamp: 1_786_227_200_000 });
      },
      stopLocation,
    });
    mocks.uploadLocationPoints.mockResolvedValue(ok({
      workDayId: 'wd-1', acceptedCount: 1, duplicateCount: 0, rejectedCount: 0,
      lastReceivedAt: '2026-08-09T04:00:00Z',
    }));
    const store = useSalesStore();

    await expect(store.ensureLocationTracking('wd-1')).resolves.toBe(true);
    await vi.waitFor(() => expect(mocks.uploadLocationPoints).toHaveBeenCalledTimes(1));
    expect(store.locationStatus).toBe('active');
    expect(store.trackingWorkDayId).toBe('wd-1');

    await store.stopLocationTracking();
    expect(stopLocation).toHaveBeenCalledTimes(1);
    expect(store.trackingWorkDayId).toBeNull();
  });
});
