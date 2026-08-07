<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import { useSalesStore } from '@/stores/sales';
import type { LocationEvidence } from '@/api/core/sales';
import type { CapabilityStatus } from '@/types';

const salesStore = useSalesStore();
const adapter = getFeishuAdapter();
const locationStatus = ref<CapabilityStatus>(adapter.getLocationStatus());
const points = ref<{ latitude: number; longitude: number; accuracy: number; timestamp: number }[]>([]);
const localInterruptionCount = ref(0);
const lastInterruptionAt = ref(0);
let uploadChain: Promise<void> = Promise.resolve();

const workDate = localDate();
const workDay = computed(() => salesStore.workDay);
const workStatus = computed(() => workDay.value?.status || 'NOT_STARTED');
const pointCount = computed(() => Math.max(workDay.value?.locationPointCount || 0, points.value.length));
const interruptionCount = computed(() => Math.max(workDay.value?.interruptionCount || 0, localInterruptionCount.value));
const attendanceError = computed(() => salesStore.attendanceError);

const statusLabel = computed(() => ({
  NOT_STARTED: '未签到', ACTIVE: '工作中', FINISHED: '已签退', PENDING_REVIEW: '待复核',
})[workStatus.value] || workStatus.value);
const statusHint = computed(() => ({
  NOT_STARTED: '签到成功后才开始前台定位',
  ACTIVE: '当前处于工作期间，请保持飞书页面可用',
  FINISHED: '今日定位采集已停止',
  PENDING_REVIEW: '工作日已结束，等待异常复核',
})[workStatus.value] || '服务端返回了未知工作日状态');
const locationLabel = computed(() => ({
  idle: '未开始', loading: '读取中', unsupported: '客户端不支持', 'permission-denied': '未授权',
  ready: '待采样', active: '采集中', interrupted: '已中断', failed: '采样失败',
})[locationStatus.value]);

async function checkIn() {
  if (workStatus.value !== 'NOT_STARTED') return;
  try {
    locationStatus.value = 'loading';
    // 先获取一次真实客户端定位；只有服务端签到事务成功后才启动持续采样。
    const point = await adapter.getCurrentLocation();
    const created = await salesStore.checkIn({
      idempotencyKey: createIdempotencyKey('check-in'),
      clientInstanceId: clientInstanceId(),
      clientOccurredAt: new Date(point.timestamp).toISOString(),
      location: toEvidence(point),
      networkType: navigator.onLine ? 'ONLINE' : 'OFFLINE',
    });
    if (!created) {
      locationStatus.value = 'failed';
      return;
    }
    await startContinuousLocation(created.id);
    showToast('签到成功，已开始前台定位');
  } catch (error) {
    locationStatus.value = 'failed';
    showToast(error instanceof Error ? error.message : '签到失败');
  }
}

async function checkOut() {
  if (workStatus.value !== 'ACTIVE' || !workDay.value) return;
  try {
    locationStatus.value = 'loading';
    const point = await adapter.getCurrentLocation();
    const updated = await salesStore.checkOut(workDay.value.id, {
      idempotencyKey: createIdempotencyKey('check-out'),
      clientOccurredAt: new Date(point.timestamp).toISOString(),
      location: toEvidence(point),
      networkType: navigator.onLine ? 'ONLINE' : 'OFFLINE',
    });
    if (!updated) {
      locationStatus.value = 'interrupted';
      return;
    }
    await adapter.stopLocation();
    locationStatus.value = 'ready';
    showToast('签退成功，已停止定位');
  } catch (error) {
    locationStatus.value = 'failed';
    showToast(error instanceof Error ? error.message : '签退失败');
  }
}

async function startContinuousLocation(workDayId: string) {
  try {
    await adapter.startLocation(
      (point) => {
        points.value.push(point);
        locationStatus.value = 'active';
        queueLocationPoint(workDayId, point);
      },
      () => {
        locationStatus.value = 'interrupted';
        recordInterruption(workDayId);
      },
    );
  } catch (error) {
    locationStatus.value = 'failed';
    await recordInterruption(workDayId, 'LOCATION_FAILED');
    throw error;
  }
}

function queueLocationPoint(workDayId: string, point: { latitude: number; longitude: number; accuracy: number; timestamp: number }) {
  uploadChain = uploadChain
    .then(async () => {
      const result = await salesStore.uploadLocationPoints(workDayId, [{
        deviceEventId: `${clientInstanceId()}-${point.timestamp}-${createIdempotencyKey('point')}`.slice(0, 128),
        longitude: point.longitude,
        latitude: point.latitude,
        accuracyMeters: point.accuracy,
        clientOccurredAt: new Date(point.timestamp).toISOString(),
        source: 'FEISHU',
      }]);
      if (!result) locationStatus.value = 'interrupted';
    })
    .catch(() => {
      locationStatus.value = 'interrupted';
    });
}

function recordInterruption(workDayId: string, interruptionType = 'LOCATION_INTERRUPTED') {
  const now = Date.now();
  if (now - lastInterruptionAt.value < 5_000) return;
  lastInterruptionAt.value = now;
  localInterruptionCount.value += 1;
  void salesStore.reportInterruption(workDayId, {
    idempotencyKey: createIdempotencyKey('interruption'),
    interruptionType,
    startedAt: new Date(now).toISOString(),
    clientDetail: document.visibilityState === 'hidden' ? '页面进入后台' : '客户端定位回调失败',
  });
}

function time(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
}

function toEvidence(point: { latitude: number; longitude: number; accuracy: number }): LocationEvidence {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: point.accuracy,
    source: 'FEISHU',
  };
}

function localDate(): string {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function clientInstanceId(): string {
  const existing = localStorage.getItem('sales_client_instance_id');
  if (existing) return existing;
  const value = createIdempotencyKey('client');
  localStorage.setItem('sales_client_instance_id', value);
  return value;
}

function createIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

onMounted(async () => {
  const loaded = await salesStore.loadWorkDay(workDate);
  if (loaded?.status === 'ACTIVE') {
    try {
      await startContinuousLocation(loaded.id);
    } catch {
      // 已存在的服务端工作日保持 ACTIVE；页面已记录定位中断，用户可稍后重试。
    }
  }
});
</script>

<template>
  <div class="workbench-page attendance-page">
    <van-nav-bar title="外勤考勤" :fixed="true" :placeholder="true" />
    <div class="workbench-body">
      <section class="attendance-hero" :class="`attendance-hero--${workStatus.toLowerCase()}`">
        <div class="status-copy">
          <span>今日工作状态</span>
          <strong>{{ statusLabel }}</strong>
          <p>{{ statusHint }}</p>
        </div>
        <span class="status-mark"><van-icon name="clock-o" size="28" /></span>
      </section>

      <div class="time-line surface-card">
        <div><span>上班签到</span><strong>{{ time(workDay?.checkedInAt) }}</strong></div>
        <span class="time-line__line" />
        <div><span>下班签退</span><strong>{{ time(workDay?.checkedOutAt) }}</strong></div>
      </div>

      <div class="attendance-action">
        <van-button v-if="workStatus === 'NOT_STARTED'" type="primary" round block size="large" :loading="salesStore.attendanceLoading" @click="checkIn">上班签到</van-button>
        <van-button v-else-if="workStatus === 'ACTIVE'" type="danger" round block size="large" :loading="salesStore.attendanceLoading" @click="checkOut">下班签退</van-button>
        <van-button v-else round block size="large" disabled>今日已签退</van-button>
      </div>

      <div class="section-heading"><h2>定位与证据</h2><span>前台尽力采样</span></div>
      <div class="evidence-grid surface-card">
        <div><span>定位状态</span><strong>{{ locationLabel }}</strong></div>
        <div><span>采样点</span><strong>{{ pointCount }}</strong></div>
        <div><span>中断次数</span><strong>{{ interruptionCount }}</strong></div>
      </div>

      <van-notice-bar
        class="attendance-notice"
        left-icon="info-o"
        text="飞书能力可以在浏览器Mock中测试，但签到、定位、签退和日结候选均由Sales Work服务端保存。"
        wrapable
      />
      <van-notice-bar v-if="attendanceError" class="attendance-notice attendance-notice--error" left-icon="warning-o" :text="attendanceError" wrapable />
      <p class="skeleton-note legal-note">定位中断只记录证据质量，不能单独判定旷工或扣减绩效。</p>
    </div>
  </div>
</template>

<style scoped>
.attendance-hero { display: flex; align-items: center; justify-content: space-between; padding: 22px; color: #fff; background: linear-gradient(145deg, #1d56c7, #2f7af2); border-radius: 18px; box-shadow: 0 14px 30px rgba(36, 104, 242, 0.22); }
.attendance-hero--active { background: linear-gradient(145deg, #087a58, #16a36a); }
.attendance-hero--finished { background: linear-gradient(145deg, #4b5870, #758197); }
.status-copy span { color: rgba(255, 255, 255, 0.72); font-size: 12px; }
.status-copy strong { display: block; margin-top: 4px; font-size: 24px; }
.status-copy p { margin: 7px 0 0; color: rgba(255, 255, 255, 0.72); font-size: 11px; }
.status-mark { display: grid; width: 52px; height: 52px; background: rgba(255, 255, 255, 0.14); border-radius: 16px; place-items: center; }
.time-line { display: grid; grid-template-columns: 1fr 42px 1fr; align-items: center; margin-top: 14px; padding: 18px; text-align: center; }
.time-line span { color: var(--workbench-muted); font-size: 11px; }
.time-line strong { display: block; margin-top: 6px; color: var(--workbench-ink); font-size: 18px; }
.time-line__line { width: 100%; height: 1px; background: var(--workbench-line); }
.attendance-action { margin-top: 16px; }
.evidence-grid { display: grid; grid-template-columns: repeat(3, 1fr); padding: 18px 8px; text-align: center; }
.evidence-grid div { border-right: 1px solid var(--workbench-line); }
.evidence-grid div:last-child { border: 0; }
.evidence-grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.evidence-grid strong { display: block; margin-top: 6px; color: var(--workbench-ink); font-size: 14px; }
.attendance-notice { margin-top: 16px; border-radius: 12px; }
.attendance-notice--error { margin-top: 8px; }
.legal-note { margin: 10px 4px 0; text-align: center; }
</style>
