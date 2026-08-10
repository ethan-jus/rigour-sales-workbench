<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import { useSalesStore } from '@/stores/sales';
import type { AttendanceMonthDayView, LocationEvidence } from '@/api/core/sales';
import { createIdempotencyKey } from '@/utils/id';
import { formatDurationMinutes, formatTime, localDate } from '@/utils/datetime';

const salesStore = useSalesStore();
const adapter = getFeishuAdapter();

const workDate = localDate();
const workDay = computed(() => salesStore.workDay);
const workStatus = computed(() => workDay.value?.status || 'NOT_STARTED');
const pointCount = computed(() => workDay.value?.locationPointCount || 0);
const interruptionCount = computed(() => workDay.value?.interruptionCount || 0);
const attendanceError = computed(() => salesStore.attendanceError);
const todaySummary = computed(() => salesStore.todaySummary);
const context = computed(() => salesStore.context);
const diagnosticPanels = ref<string[]>([]);
const policyEffectiveDate = computed(() => context.value?.fieldPolicy.effectiveFrom?.slice(0, 10) ?? '--');
const calendarMonth = ref(workDate.slice(0, 7));
const selectedCalendarDate = ref(workDate);
const monthDays = computed(() => salesStore.attendanceMonth?.month === calendarMonth.value
  ? salesStore.attendanceMonth.days : []);
const selectedCalendarDay = computed(() => monthDays.value.find(
  (day) => day.businessDate === selectedCalendarDate.value,
) ?? null);
const canGoNextMonth = computed(() => calendarMonth.value < workDate.slice(0, 7));
const calendarCells = computed<Array<AttendanceMonthDayView | null>>(() => {
  if (!monthDays.value.length) return [];
  const [year, month] = calendarMonth.value.split('-').map(Number);
  const mondayOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  return [...Array<null>(mondayOffset).fill(null), ...monthDays.value];
});
const monthStatusSummary = computed(() => ({
  meets: monthDays.value.filter((day) => day.attendanceStatus === 'MEETS_MINIMUM').length,
  attention: monthDays.value.filter((day) => ['SHORT', 'PENDING_REVIEW'].includes(day.attendanceStatus)).length,
  missing: monthDays.value.filter((day) => day.attendanceStatus === 'MISSING_CHECK_OUT').length,
  recorded: monthDays.value.filter((day) => day.workDayId != null).length,
}));

const statusLabel = computed(() => ({
  NOT_STARTED: '未签到', ACTIVE: '工作中', FINISHED: '已签退', PENDING_REVIEW: '待复核',
})[workStatus.value] || workStatus.value);
const statusHint = computed(() => ({
  NOT_STARTED: '签到成功后才开始前台定位',
  ACTIVE: '当前处于工作期间，请保持飞书页面可用',
  FINISHED: '已签退，可重新签到继续今日工作',
  PENDING_REVIEW: '工作日已结束，等待异常复核',
})[workStatus.value] || '服务端返回了未知工作日状态');
const locationLabel = computed(() => ({
  idle: '未开始', loading: '读取中', unsupported: '客户端不支持', 'permission-denied': '未授权',
  ready: '待采样', active: '采集中', interrupted: '已中断', failed: '采样失败',
})[salesStore.locationStatus]);

async function checkIn() {
  // NOT_STARTED 首次签到；FINISHED 重新签到（服务端重开同一工作日并新建定位会话）。
  if (workStatus.value !== 'NOT_STARTED' && workStatus.value !== 'FINISHED') return;
  const isReCheckIn = workStatus.value === 'FINISHED';
  try {
    salesStore.locationStatus = 'loading';
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
      // 后端拒绝签到（如不在签到窗口）不代表定位失败，保持待采样并展示业务错误。
      salesStore.locationStatus = 'ready';
      if (salesStore.attendanceError) showToast(salesStore.attendanceError);
      return;
    }
    await salesStore.ensureLocationTracking(created.id);
    await salesStore.loadAttendanceMonth(calendarMonth.value);
    showToast(isReCheckIn ? '已重新签到，继续前台定位' : '签到成功，已开始前台定位');
  } catch (error) {
    salesStore.locationStatus = 'failed';
    showToast(error instanceof Error ? error.message : '签到失败');
  }
}

async function checkOut() {
  if (workStatus.value !== 'ACTIVE' || !workDay.value) return;
  try {
    salesStore.locationStatus = 'loading';
    const point = await adapter.getCurrentLocation();
    const updated = await salesStore.checkOut(workDay.value.id, {
      idempotencyKey: createIdempotencyKey('check-out'),
      clientOccurredAt: new Date(point.timestamp).toISOString(),
      location: toEvidence(point),
      networkType: navigator.onLine ? 'ONLINE' : 'OFFLINE',
    });
    if (!updated) {
      salesStore.locationStatus = 'ready';
      if (salesStore.attendanceError) showToast(salesStore.attendanceError);
      return;
    }
    await salesStore.stopLocationTracking();
    await salesStore.loadAttendanceMonth(calendarMonth.value);
    showToast('签退成功，已停止定位');
  } catch (error) {
    salesStore.locationStatus = 'failed';
    showToast(error instanceof Error ? error.message : '签退失败');
  }
}

function toEvidence(point: { latitude: number; longitude: number; accuracy: number }): LocationEvidence {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    accuracyMeters: point.accuracy,
    source: 'FEISHU',
  };
}

function clientInstanceId(): string {
  const existing = localStorage.getItem('sales_client_instance_id');
  if (existing) return existing;
  const value = createIdempotencyKey('client');
  localStorage.setItem('sales_client_instance_id', value);
  return value;
}

function changeCalendarMonth(delta: number): void {
  const [year, month] = calendarMonth.value.split('-').map(Number);
  const next = new Date(year, month - 1 + delta, 1);
  const nextValue = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
  if (nextValue > workDate.slice(0, 7)) return;
  calendarMonth.value = nextValue;
  selectedCalendarDate.value = nextValue === workDate.slice(0, 7) ? workDate : `${nextValue}-01`;
  void salesStore.loadAttendanceMonth(nextValue);
}

function monthTitle(): string {
  const [year, month] = calendarMonth.value.split('-').map(Number);
  return `${year}年${month}月`;
}

function dayNumber(day: AttendanceMonthDayView): number {
  return Number(day.businessDate.slice(-2));
}

function statusMeta(day: AttendanceMonthDayView): { key: string; label: string } {
  if (day.scheduleStatus === 'REST') return { key: 'rest', label: '休息' };
  return ({
    MEETS_MINIMUM: { key: 'meets', label: '达标' },
    SHORT: { key: 'short', label: '未达标' },
    MISSING_CHECK_OUT: { key: 'missing', label: '缺签退' },
    PENDING_REVIEW: { key: 'pending', label: '待复核' },
    IN_PROGRESS: { key: 'active', label: '工作中' },
    NO_RECORD: { key: 'none', label: '无记录' },
    FUTURE: { key: 'future', label: '' },
  } as Record<string, { key: string; label: string }>)[day.attendanceStatus]
    ?? { key: 'none', label: day.attendanceStatus };
}

onMounted(async () => {
  const [loaded] = await Promise.all([
    salesStore.loadWorkDay(workDate),
    salesStore.loadContext(),
    salesStore.loadActivitySummaries(workDate),
    salesStore.loadAttendanceMonth(calendarMonth.value),
  ]);
  if (loaded?.status === 'ACTIVE') {
    await salesStore.ensureLocationTracking(loaded.id);
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
        <div><span>上班签到</span><strong>{{ formatTime(workDay?.checkedInAt) }}</strong></div>
        <span class="time-line__line" />
        <div><span>下班签退</span><strong>{{ formatTime(workDay?.checkedOutAt) }}</strong></div>
      </div>

      <div class="attendance-summary surface-card">
        <div><span>今日拜访</span><strong>{{ todaySummary?.totalVisitCount ?? '--' }}</strong></div>
        <div><span>完成离店</span><strong>{{ todaySummary?.completedVisitCount ?? '--' }}</strong></div>
        <div><span>待核验</span><strong>{{ todaySummary?.pendingReviewVisitCount ?? '--' }}</strong></div>
      </div>

      <div v-if="workDay" class="workday-duration">
        <van-icon name="clock-o" />
        <span>服务端已核算工作时长</span>
        <strong>{{ formatDurationMinutes(workDay.verifiedWorkMinutes) }}</strong>
      </div>

      <div class="attendance-action">
        <van-button v-if="workStatus === 'NOT_STARTED'" type="primary" round block size="large" :loading="salesStore.attendanceLoading" @click="checkIn">上班签到</van-button>
        <van-button v-else-if="workStatus === 'ACTIVE'" type="danger" round block size="large" :loading="salesStore.attendanceLoading" @click="checkOut">下班签退</van-button>
        <van-button v-else-if="workStatus === 'FINISHED'" type="primary" round block size="large" :loading="salesStore.attendanceLoading" @click="checkIn">重新签到</van-button>
        <van-button v-else round block size="large" disabled>等待复核</van-button>
      </div>

      <div class="section-heading attendance-calendar-heading"><h2>本月出勤</h2><span>本人可见</span></div>
      <section class="attendance-calendar surface-card">
        <header class="attendance-calendar__header">
          <button type="button" aria-label="上个月" @click="changeCalendarMonth(-1)"><van-icon name="arrow-left" /></button>
          <div><strong>{{ monthTitle() }}</strong><small>{{ monthStatusSummary.recorded }} 天有外勤记录</small></div>
          <button type="button" aria-label="下个月" :disabled="!canGoNextMonth" @click="changeCalendarMonth(1)"><van-icon name="arrow" /></button>
        </header>
        <div class="attendance-calendar__summary">
          <div><strong>{{ monthStatusSummary.meets }}</strong><span>工时达标</span></div>
          <div><strong>{{ monthStatusSummary.attention }}</strong><span>未达标/待复核</span></div>
          <div><strong>{{ monthStatusSummary.missing }}</strong><span>缺签退</span></div>
        </div>
        <div class="attendance-calendar__weekdays">
          <span v-for="weekday in ['一', '二', '三', '四', '五', '六', '日']" :key="weekday">{{ weekday }}</span>
        </div>
        <div v-if="salesStore.attendanceMonthLoading && !calendarCells.length" class="attendance-calendar__loading">
          <van-loading size="20" /> 正在读取月度记录
        </div>
        <div v-else class="attendance-calendar__grid">
          <span v-for="(_, index) in calendarCells.filter((cell) => cell == null)" :key="`blank-${index}`" class="attendance-calendar__blank" />
          <button
            v-for="day in monthDays"
            :key="day.businessDate"
            type="button"
            class="attendance-calendar__day"
            :class="[`attendance-calendar__day--${statusMeta(day).key}`, { 'attendance-calendar__day--selected': selectedCalendarDate === day.businessDate }]"
            @click="selectedCalendarDate = day.businessDate"
          >
            <strong>{{ dayNumber(day) }}</strong><i /><small>{{ statusMeta(day).label }}</small>
          </button>
        </div>
        <div v-if="selectedCalendarDay" class="attendance-calendar__detail">
          <div><strong>{{ selectedCalendarDay.businessDate }} · {{ statusMeta(selectedCalendarDay).label || '未来日期' }}</strong><span>{{ selectedCalendarDay.scheduleStatus === 'UNKNOWN' ? '未接入排班' : '已有排班事实' }}</span></div>
          <p v-if="selectedCalendarDay.workDayId">
            签到 {{ formatTime(selectedCalendarDay.checkedInAt) }} · 签退 {{ formatTime(selectedCalendarDay.checkedOutAt) }} ·
            工时 {{ formatDurationMinutes(selectedCalendarDay.verifiedWorkMinutes) }}
            <template v-if="selectedCalendarDay.minimumWorkMinutes != null"> / 最低 {{ formatDurationMinutes(selectedCalendarDay.minimumWorkMinutes) }}</template>
          </p>
          <p v-else>当天没有 Sales Work 工作日记录；未结合排班、请假和人工认定，不能据此判定旷工。</p>
        </div>
        <div class="attendance-calendar__legend">
          <span><i class="legend--meets" />达标</span><span><i class="legend--short" />未达标/待复核</span>
          <span><i class="legend--missing" />缺签退</span><span><i class="legend--active" />进行中</span><span><i class="legend--none" />无记录</span>
        </div>
      </section>

      <div class="section-heading"><h2>当前执行规则</h2><span>服务端规则</span></div>
      <div class="policy-card surface-card">
        <div><strong>{{ context?.fieldPolicy.policyName || '规则读取中' }}</strong><span>自 {{ policyEffectiveDate }} 生效</span></div>
        <p v-if="context">标准工作时长 {{ formatDurationMinutes(context.fieldPolicy.standardWorkMinutes) }}；定位按 {{ context.fieldPolicy.locationIntervalMinutes }} 分钟间隔尽力采集。</p>
        <p v-else>{{ salesStore.errorMessage || '正在读取当前规则' }}</p>
      </div>

      <van-collapse v-model="diagnosticPanels" class="diagnostic-collapse">
        <van-collapse-item name="location">
          <template #title><span>定位采集诊断</span></template>
          <template #value><span :class="{ 'diagnostic-warning': interruptionCount > 0 || salesStore.locationStatus === 'failed' }">{{ interruptionCount > 0 ? `${interruptionCount} 次中断` : locationLabel }}</span></template>
          <div class="evidence-grid">
            <div><span>定位状态</span><strong>{{ locationLabel }}</strong></div>
            <div><span>采样点</span><strong>{{ pointCount }}</strong></div>
            <div><span>中断次数</span><strong>{{ interruptionCount }}</strong></div>
          </div>
          <p class="diagnostic-note">这里用于排查定位权限和采集质量，销售日常只需在出现异常提示时关注。</p>
        </van-collapse-item>
      </van-collapse>

      <van-notice-bar
        class="attendance-notice"
        left-icon="info-o"
        text="签到、签退和工作时长以服务端记录为准；正式考勤结果仍由 HR/Payroll 确认。"
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
.attendance-calendar-heading { margin-top: 24px; }
.attendance-calendar { overflow: hidden; }
.attendance-calendar__header { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; padding: 14px 12px 10px; text-align: center; }
.attendance-calendar__header button { display: grid; width: 34px; height: 34px; padding: 0; color: var(--workbench-primary); background: #edf4ff; border: 0; border-radius: 10px; place-items: center; }
.attendance-calendar__header button:disabled { color: #b9c1cf; background: #f3f5f8; }
.attendance-calendar__header strong { display: block; color: var(--workbench-ink); font-size: 15px; }
.attendance-calendar__header small { display: block; margin-top: 2px; color: var(--workbench-muted); font-size: 10px; }
.attendance-calendar__summary { display: grid; grid-template-columns: repeat(3, 1fr); margin: 0 12px 12px; padding: 10px 0; background: #f7f9fc; border-radius: 10px; text-align: center; }
.attendance-calendar__summary div { border-right: 1px solid var(--workbench-line); }
.attendance-calendar__summary div:last-child { border: 0; }
.attendance-calendar__summary strong { display: block; color: var(--workbench-ink); font-size: 16px; }
.attendance-calendar__summary span { display: block; margin-top: 2px; color: var(--workbench-muted); font-size: 9px; }
.attendance-calendar__weekdays, .attendance-calendar__grid { display: grid; grid-template-columns: repeat(7, 1fr); }
.attendance-calendar__weekdays { padding: 0 10px; color: var(--workbench-muted); font-size: 10px; text-align: center; }
.attendance-calendar__grid { gap: 2px; padding: 7px 10px 12px; }
.attendance-calendar__blank { min-height: 57px; }
.attendance-calendar__day { display: flex; flex-direction: column; align-items: center; min-width: 0; min-height: 57px; padding: 6px 1px 4px; color: var(--workbench-ink); background: transparent; border: 1px solid transparent; border-radius: 9px; }
.attendance-calendar__day strong { font-size: 12px; font-weight: 600; }
.attendance-calendar__day i { width: 6px; height: 6px; margin-top: 4px; background: #c7cfdb; border-radius: 50%; }
.attendance-calendar__day small { margin-top: 3px; overflow: hidden; color: var(--workbench-muted); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.attendance-calendar__day--selected { background: #f5f8fd; border-color: #cdd7e7; }
.attendance-calendar__day--meets i { background: #2468f2; }
.attendance-calendar__day--short i, .attendance-calendar__day--pending i { background: #e7a11a; }
.attendance-calendar__day--missing i { background: #df4f5f; }
.attendance-calendar__day--active i { background: #7c55d9; box-shadow: 0 0 0 3px rgba(124, 85, 217, 0.12); }
.attendance-calendar__day--rest i { background: #24a66a; }
.attendance-calendar__day--future { opacity: 0.45; }
.attendance-calendar__loading { display: flex; gap: 8px; align-items: center; justify-content: center; min-height: 150px; color: var(--workbench-muted); font-size: 11px; }
.attendance-calendar__detail { margin: 0 12px; padding: 11px 12px; background: #f7f9fc; border-radius: 10px; }
.attendance-calendar__detail > div { display: flex; justify-content: space-between; gap: 8px; }
.attendance-calendar__detail strong { color: var(--workbench-ink); font-size: 11px; }
.attendance-calendar__detail span { color: #a47422; font-size: 9px; }
.attendance-calendar__detail p { margin: 5px 0 0; color: var(--workbench-muted); font-size: 10px; line-height: 1.55; }
.attendance-calendar__legend { display: flex; flex-wrap: wrap; gap: 7px 12px; padding: 10px 14px 14px; color: var(--workbench-muted); font-size: 9px; }
.attendance-calendar__legend span { display: inline-flex; gap: 4px; align-items: center; }
.attendance-calendar__legend i { width: 7px; height: 7px; border-radius: 50%; }
.legend--meets { background: #2468f2; }.legend--short { background: #e7a11a; }.legend--missing { background: #df4f5f; }.legend--active { background: #7c55d9; }.legend--none { background: #c7cfdb; }
.attendance-summary { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 14px; padding: 16px 8px; text-align: center; }
.attendance-summary div { border-right: 1px solid var(--workbench-line); }
.attendance-summary div:last-child { border: 0; }
.attendance-summary span { display: block; color: var(--workbench-muted); font-size: 11px; }
.attendance-summary strong { display: block; margin-top: 6px; color: var(--workbench-ink); font-size: 18px; }
.workday-duration { display: flex; gap: 7px; align-items: center; margin-top: 10px; padding: 0 4px; color: var(--workbench-muted); font-size: 11px; }
.workday-duration strong { margin-left: auto; color: var(--workbench-ink); }
.policy-card { padding: 16px; }
.policy-card > div { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.policy-card strong { color: var(--workbench-ink); font-size: 14px; }
.policy-card span { color: var(--workbench-primary); font-size: 11px; }
.policy-card p { margin: 8px 0 0; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; }
.diagnostic-collapse { margin-top: 14px; overflow: hidden; border: 1px solid var(--workbench-line); border-radius: 14px; }
.diagnostic-warning { color: #c45656; }
.evidence-grid { display: grid; grid-template-columns: repeat(3, 1fr); padding: 18px 8px; text-align: center; }
.evidence-grid div { border-right: 1px solid var(--workbench-line); }
.evidence-grid div:last-child { border: 0; }
.evidence-grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.evidence-grid strong { display: block; margin-top: 6px; color: var(--workbench-ink); font-size: 14px; }
.diagnostic-note { margin: 0 8px 8px; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; }
.attendance-notice { margin-top: 16px; border-radius: 12px; }
.attendance-notice--error { margin-top: 8px; }
.legal-note { margin: 10px 4px 0; text-align: center; }
</style>
