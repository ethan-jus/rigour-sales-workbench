import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import Vant from 'vant';
import type { RecordingSessionView, VisitView } from '@/api/core/sales';
import { mockAdapter, setFeishuAdapter } from '@/adapters';

const mocks = vi.hoisted(() => ({
  recordings: vi.fn(),
  discardRecordingClip: vi.fn(),
}));

vi.mock('vue-router', () => ({
  useRoute: () => ({ query: { visitId: 'visit-1' } }),
  onBeforeRouteLeave: vi.fn(),
}));

vi.mock('@/api/core/sales', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/api/core/sales')>();
  return {
    ...original,
    salesApi: {
      ...original.salesApi,
      recordings: mocks.recordings,
      discardRecordingClip: mocks.discardRecordingClip,
    },
  };
});

import VisitPage from '@/pages/VisitPage.vue';
import { useSalesStore } from '@/stores/sales';

function visitFixture(saved = false): VisitView {
  return {
    id: 'visit-1',
    workDayId: 'work-day-1',
    salesProfileId: 'profile-1',
    targetType: 'MY_STORE',
    customerId: 'customer-1',
    storeId: 'store-1',
    status: 'CHECKED_IN',
    checkedInAt: '2026-08-09T00:00:00Z',
    checkedOutAt: null,
    visitPolicyVersionId: 'policy-1',
    targetSnapshot: {
      targetType: 'MY_STORE',
      customerId: 'customer-1',
      storeId: 'store-1',
      customerName: '协和医院',
      storeName: '协和医院门店',
      storeAddress: '北京市东城区',
      longitude: 116.397,
      latitude: 39.908,
      assignedSalesProfileId: 'profile-1',
    },
    checkpoints: [],
    createdAt: '2026-08-09T00:00:00Z',
    contactOutcome: saved ? 'CONTACTED' : null,
    kpName: saved ? '王主任' : null,
    kpPhone: saved ? '13800001234' : null,
    intentionLevel: saved ? 'HIGH' : null,
    resultNote: saved ? '下周提交方案' : null,
    resultSubmittedAt: saved ? '2026-08-09T01:00:00Z' : null,
    visitType: 'FIRST_VISIT',
    reviewStatus: 'IN_PROGRESS',
  };
}

function recordingFixture(uploadedTotalDurationMs: number, minimumRecordingSeconds = 600): RecordingSessionView {
  return {
    sessionId: uploadedTotalDurationMs ? 'session-1' : null,
    visitId: 'visit-1',
    status: uploadedTotalDurationMs ? 'UPLOADED' : 'NOT_STARTED',
    clipCount: uploadedTotalDurationMs ? 1 : 0,
    uploadedTotalDurationMs,
    verifiedTotalDurationMs: 0,
    recordingEnabled: true,
    minimumRecordingSeconds,
    minimumClipSeconds: 30,
    clips: uploadedTotalDurationMs ? [{
      clipId: 'clip-1',
      sessionId: 'session-1',
      clientClipId: 'client-clip-1',
      clipIndex: 0,
      objectSizeBytes: 1024,
      clientDurationMs: uploadedTotalDurationMs,
      uploadStatus: 'RECEIVED',
      createdAt: '2026-08-09T00:10:00Z',
    }] : [],
  };
}

function ok<T>(data: T) {
  return { code: 'SUCCESS', message: 'ok', data, requestId: 'r-1', timestamp: '2026-08-09T00:00:00Z' };
}

describe('VisitPage 真实拜访状态流', () => {
  let wrapper: VueWrapper | null = null;

  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    setFeishuAdapter(mockAdapter);
    mocks.recordings.mockReset();
    mocks.discardRecordingClip.mockReset();
    mocks.discardRecordingClip.mockResolvedValue(ok({
      clientClipId: 'short-clip',
      durationMs: 10_000,
      disposition: 'DISCARDED_NOT_STORED',
      recordedAt: '2026-08-09T00:00:10Z',
    }));
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = null;
    vi.useRealTimers();
  });

  async function render(visit: VisitView, recording: RecordingSessionView) {
    const store = useSalesStore();
    store.activeVisit = visit;
    mocks.recordings.mockResolvedValue(ok(recording));
    wrapper = mount(VisitPage, {
      global: {
        plugins: [Vant],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await flushPromises();
    return wrapper;
  }

  it('进行中拜访不再同时展示到店签到和到店签退按钮', async () => {
    const page = await render(visitFixture(false), recordingFixture(0));
    const buttonLabels = page.findAll('button').map((button) => button.text());

    expect(page.text()).toContain('拜访中');
    expect(page.text()).toContain('距离要求预计还剩 600 秒');
    expect(buttonLabels).not.toContain('已到店签到');
    expect(buttonLabels).not.toContain('到店签退');
    expect(buttonLabels).toContain('开始现场录音');
    expect(buttonLabels).toContain('保存拜访记录');
  });

  it('录音与结果都完成后只给出明确的完成拜访主操作', async () => {
    const page = await render(visitFixture(true), recordingFixture(600_000));
    const buttonLabels = page.findAll('button').map((button) => button.text());

    expect(page.text()).toContain('拜访记录已保存');
    expect(page.text()).toContain('录音要求已完成');
    expect(buttonLabels).toContain('继续现场录音（不限制总时长）');
    expect(buttonLabels).toContain('完成拜访并离店');
    expect(buttonLabels).not.toContain('保存拜访结果');
    expect(buttonLabels).not.toContain('到店签退');
  });

  it('结果已保存时录音不足也允许完成离店', async () => {
    const page = await render(visitFixture(true), recordingFixture(0));
    const buttonLabels = page.findAll('button').map((button) => button.text());

    expect(page.text()).toContain('录音不足只影响有效拜访核验');
    expect(buttonLabels).toContain('开始现场录音');
    expect(buttonLabels).toContain('完成拜访并离店');
  });

  it('录音权限读取失败时展示可恢复错误而不是无说明灰色按钮', async () => {
    const store = useSalesStore();
    store.activeVisit = visitFixture(false);
    mocks.recordings.mockRejectedValue(new Error('没有访问该资源的权限'));
    wrapper = mount(VisitPage, {
      global: {
        plugins: [Vant],
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    });
    await flushPromises();

    expect(wrapper.text()).toContain('录音能力暂不可用');
    expect(wrapper.text()).toContain('没有访问该资源的权限');
    expect(wrapper.findAll('button').map((button) => button.text())).toContain('重新加载');
  });

  it('启用录音但要求0秒时失败关闭，不得显示已完成', async () => {
    const page = await render(visitFixture(false), recordingFixture(0, 0));

    expect(page.text()).toContain('录音规则配置异常');
    expect(page.text()).toContain('尚未开始录音 · 规则时长无效');
    expect(page.text()).not.toContain('录音要求已完成');
    expect(page.findAll('button').map((button) => button.text())).not.toContain('完成拜访并离店');
  });

  it('不足30秒录音不上传音频，只登记短录音审计并从时长中排除', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T00:00:00Z'));
    const page = await render(visitFixture(false), recordingFixture(0));

    await page.findAll('button').find((button) => button.text() === '开始现场录音')!.trigger('click');
    await vi.advanceTimersByTimeAsync(10_000);
    await page.findAll('button').find((button) => button.text() === '停止并上传录音')!.trigger('click');
    await flushPromises();

    expect(mocks.discardRecordingClip).toHaveBeenCalledWith(
      'visit-1',
      expect.objectContaining({ durationMs: 10_000, reason: 'TOO_SHORT' }),
    );
    expect(page.text()).toContain('本次已丢弃 1 段过短录音');
    expect(page.text()).toContain('已上传 0 秒');
  });
});
