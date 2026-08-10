<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useSalesStore } from '@/stores/sales';
import { formatDistance, formatDurationMinutes, formatTime, localDate } from '@/utils/datetime';
import { isAmapConfigured, loadAmap, type AmapMapInstance } from '@/utils/amap';

const salesStore = useSalesStore();
const today = localDate();
const selectedDate = ref(today);
const workDay = computed(() => salesStore.workDay?.businessDate === selectedDate.value ? salesStore.workDay : null);
const visits = computed(() => salesStore.visits);
const track = computed(() => salesStore.track?.businessDate === selectedDate.value ? salesStore.track : null);

const activeTab = ref(0);
const datePickerVisible = ref(false);
const pickerDate = ref(selectedDate.value.split('-'));
const isMapFullscreen = ref(false);
const timeFrom = ref('00:00');
const timeTo = ref('23:59');
const mapContainer = ref<HTMLElement | null>(null);
const mapStatus = ref<'idle' | 'loading' | 'ready' | 'fallback' | 'failed'>('idle');
const mapError = ref<string | null>(null);
const selectedMapVisitId = ref<string | null>(null);
const amapReady = isAmapConfigured();
const maxSelectableDate = atLocalMidnight(new Date());
const minSelectableDate = new Date(2000, 0, 1);
let mapInstance: AmapMapInstance | null = null;
let mapOverlays: unknown[] = [];
let mapRenderGeneration = 0;

const isSelectedToday = computed(() => selectedDate.value === today);
const selectedDateObject = computed(() => parseBusinessDate(selectedDate.value));
const selectedDateLabel = computed(() => {
  const date = selectedDateObject.value;
  const weekday = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' }).format(date);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${weekday}`;
});
const selectedDateScope = computed(() => {
  if (isSelectedToday.value) return '今日';
  const date = selectedDateObject.value;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
});
const selectedDateLoading = computed(() => salesStore.attendanceLoading
  || salesStore.trackLoading || salesStore.visitsLoading);
const timeRangeValid = computed(() => timeFrom.value <= timeTo.value);
const hasTimeFilter = computed(() => timeFrom.value !== '00:00' || timeTo.value !== '23:59');
const filteredTrack = computed(() => {
  const current = track.value;
  if (!current || !timeRangeValid.value) return null;
  const points = current.points.filter((point) => withinTimeRange(point.clientOccurredAt ?? point.serverReceivedAt));
  const punches = current.punches.filter((punch) => withinTimeRange(punch.clientOccurredAt ?? punch.serverReceivedAt));
  const visits = current.visits.filter((visit) => withinTimeRange(visit.checkedInAt)
    || (visit.checkedOutAt != null && withinTimeRange(visit.checkedOutAt)));
  const visibleVisitIds = new Set(visits.map((visit) => visit.visitId));
  const segments = current.segments.filter((segment) => visibleVisitIds.has(segment.fromVisitId)
    && visibleVisitIds.has(segment.toVisitId));
  return { ...current, points, punches, visits, segments };
});
const filteredDistanceMeters = computed(() => {
  const points = (filteredTrack.value?.points ?? []).filter((point) => point.qualityStatus === 'ACCEPTED');
  let distance = 0;
  for (let index = 1; index < points.length; index += 1) {
    distance += haversineMeters(points[index - 1].longitude, points[index - 1].latitude,
      points[index].longitude, points[index].latitude);
  }
  return Math.round(distance);
});
const filteredDurationMinutes = computed(() => {
  const points = (filteredTrack.value?.points ?? []).filter((point) => point.qualityStatus === 'ACCEPTED');
  if (points.length < 2) return 0;
  return Math.max(0, Math.round((new Date(points.at(-1)!.serverReceivedAt).getTime()
    - new Date(points[0].serverReceivedAt).getTime()) / 60_000));
});
const evidenceSummary = computed(() => {
  const items = visits.value?.items ?? [];
  return {
    effective: items.filter((visit) => visit.reviewStatus === 'EFFECTIVE').length,
    pending: items.filter((visit) => visit.reviewStatus === 'PENDING_REVIEW').length,
    ineffective: items.filter((visit) => visit.reviewStatus === 'INEFFECTIVE').length,
    inProgress: items.filter((visit) => visit.reviewStatus === 'IN_PROGRESS').length,
  };
});
const selectedMapVisit = computed(() => filteredTrack.value?.visits
  .find((visit) => visit.visitId === selectedMapVisitId.value) ?? null);

// 轨迹时间线：Punch 打点与定位点合并按服务端时间升序，供地图降级列表使用。
const timeline = computed(() => {
  const current = filteredTrack.value;
  if (!current) return [];
  const rows = [
    ...current.punches.map((punch) => ({
      key: `punch-${punch.eventType}-${punch.serverReceivedAt}`,
      time: punch.serverReceivedAt,
      title: punch.eventType === 'CHECK_IN' ? '签到' : punch.eventType === 'CHECK_OUT' ? '签退' : punch.eventType,
      detail: punch.longitude != null && punch.latitude != null
        ? `位置 ${punch.longitude.toFixed(5)}, ${punch.latitude.toFixed(5)}`
        : '未记录位置',
      kind: 'punch' as const,
    })),
    ...current.points.map((point, index) => ({
      key: `point-${index}-${point.serverReceivedAt}`,
      time: point.serverReceivedAt,
      title: '定位点',
      detail: `位置 ${point.longitude.toFixed(5)}, ${point.latitude.toFixed(5)} · ${point.qualityStatus}`,
      kind: 'point' as const,
    })),
    ...current.visits.map((visit) => ({
      key: `visit-${visit.visitId}`,
      time: visit.checkedInAt,
      title: `第${visit.sequence}家 · ${visit.storeName}`,
      detail: `${visit.visitType === 'REVISIT' ? '复访' : '首访'} · 停留 ${formatDurationMinutes(visit.dwellMinutes)} · ${reviewStatusLabel(visit.reviewStatus)}`,
      kind: 'visit' as const,
    })),
  ];
  return rows.sort((a, b) => a.time.localeCompare(b.time));
});

onMounted(() => {
  void loadSelectedDate();
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  destroyMap();
  document.body.classList.remove('track-map-fullscreen-lock');
  window.removeEventListener('keydown', handleKeydown);
});

watch(selectedDate, destroyMap, { flush: 'sync' });
watch([timeFrom, timeTo], destroyMap, { flush: 'sync' });

// 地图容器同时依赖 workDay 和 amapReady 的 v-if，三个条件任一变化都要重试渲染；
// 否则 track 先于 workDay 到达时容器不存在，地图永远不会初始化。
watch([activeTab, filteredTrack, workDay], async ([tab, current, day]) => {
  if (tab !== 0 || !current || !day || !amapReady || mapInstance || mapStatus.value === 'loading') return;
  await renderMap();
}, { flush: 'post', immediate: true });

async function loadSelectedDate(): Promise<void> {
  const date = selectedDate.value;
  await Promise.all([
    salesStore.loadWorkDay(date),
    salesStore.loadTrack(date),
    salesStore.loadVisits(1, date),
  ]);
}

function openDatePicker(): void {
  pickerDate.value = selectedDate.value.split('-');
  datePickerVisible.value = true;
}

function onDateConfirm({ selectedValues }: { selectedValues: Array<string | number> }): void {
  datePickerVisible.value = false;
  const [year, month, day] = selectedValues;
  if (!year || !month || !day) return;
  const nextDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (nextDate === selectedDate.value) return;
  selectedDate.value = nextDate;
  void loadSelectedDate();
}

function goToday(): void {
  if (isSelectedToday.value) return;
  selectedDate.value = today;
  void loadSelectedDate();
}

function resetTimeRange(): void {
  timeFrom.value = '00:00';
  timeTo.value = '23:59';
}

function toggleMapFullscreen(): void {
  isMapFullscreen.value = !isMapFullscreen.value;
  document.body.classList.toggle('track-map-fullscreen-lock', isMapFullscreen.value);
  void resizeMap();
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && isMapFullscreen.value) toggleMapFullscreen();
}

async function resizeMap(): Promise<void> {
  await nextTick();
  window.setTimeout(() => {
    mapInstance?.resize();
    if (mapOverlays.length) mapInstance?.setFitView(mapOverlays);
  }, 0);
}

function destroyMap(): void {
  mapRenderGeneration += 1;
  mapInstance?.destroy();
  mapInstance = null;
  mapOverlays = [];
  mapStatus.value = 'idle';
  mapError.value = null;
  selectedMapVisitId.value = null;
  if (isMapFullscreen.value) {
    isMapFullscreen.value = false;
    document.body.classList.remove('track-map-fullscreen-lock');
  }
}

async function renderMap() {
  const current = filteredTrack.value;
  if (!current || !mapContainer.value) return;
  const generation = ++mapRenderGeneration;
  mapStatus.value = 'loading';
  try {
    const amap = await loadAmap();
    if (generation !== mapRenderGeneration || current !== filteredTrack.value || !mapContainer.value) return;
    // 飞书 Adapter 固定请求 gcj02，与高德底图坐标系一致；服务端按原值保存和返回。
    const path = current.points
      .filter((point) => point.qualityStatus === 'ACCEPTED')
      .map((point): [number, number] => [point.longitude, point.latitude]);
    const workDayMarkers = current.punches
      .filter((punch) => punch.longitude != null && punch.latitude != null)
      .map((punch) => ({
        position: [punch.longitude as number, punch.latitude as number] as [number, number],
        title: punch.eventType === 'CHECK_IN' ? '上班签到' : '下班签退',
        time: punch.serverReceivedAt,
      }));
    const visitMarkers = current.visits
      .filter((visit) => visit.longitude != null && visit.latitude != null)
      .map((visit) => ({
        visit,
        position: [visit.longitude as number, visit.latitude as number] as [number, number],
      }));
    if (path.length === 0 && workDayMarkers.length === 0 && visitMarkers.length === 0) {
      mapStatus.value = 'fallback';
      return;
    }
    const center = path[0] ?? visitMarkers[0]?.position ?? workDayMarkers[0]!.position;
    mapInstance = new amap.Map(mapContainer.value, { zoom: 14, center });
    const overlays: unknown[] = [];
    if (path.length >= 2) {
      const polyline = new amap.Polyline({
        path,
        strokeColor: '#aebbd0',
        strokeWeight: 4,
        strokeOpacity: 0.65,
        lineJoin: 'round',
        showDir: true,
      });
      mapInstance.add(polyline);
      overlays.push(polyline);
    }
    for (const segment of current.segments) {
      const fromVisit = current.visits.find((visit) => visit.visitId === segment.fromVisitId);
      const toVisit = current.visits.find((visit) => visit.visitId === segment.toVisitId);
      if (!fromVisit?.checkedOutAt || !toVisit?.checkedInAt
          || fromVisit.longitude == null || fromVisit.latitude == null
          || toVisit.longitude == null || toVisit.latitude == null) continue;
      const segmentPath: [number, number][] = [
        [fromVisit.longitude, fromVisit.latitude],
        ...current.points
          .filter((point) => eventTime(point.clientOccurredAt ?? point.serverReceivedAt)
            >= eventTime(fromVisit.checkedOutAt!)
            && eventTime(point.clientOccurredAt ?? point.serverReceivedAt)
            <= eventTime(toVisit.checkedInAt)
            && point.qualityStatus === 'ACCEPTED')
          .map((point): [number, number] => [point.longitude, point.latitude]),
        [toVisit.longitude, toVisit.latitude],
      ];
      const segmentLine = new amap.Polyline({
        path: segmentPath,
        strokeColor: '#2468f2',
        strokeWeight: 6,
        strokeOpacity: 0.9,
        lineJoin: 'round',
        showDir: true,
      });
      mapInstance.add(segmentLine);
      overlays.push(segmentLine);
    }
    for (const marker of workDayMarkers) {
      const isCheckIn = marker.title === '上班签到';
      const overlay = new amap.Marker({
        position: marker.position,
        title: `${marker.title} ${formatTime(marker.time)}`,
        content: `<span class="sales-map-punch sales-map-punch--${isCheckIn ? 'in' : 'out'}">${isCheckIn ? '上' : '下'}</span>`,
        anchor: 'bottom-center',
        zIndex: 110,
      });
      mapInstance.add(overlay);
      overlays.push(overlay);
    }
    for (const marker of visitMarkers) {
      const overlay = new amap.Marker({
        position: marker.position,
        title: `第${marker.visit.sequence}家 ${marker.visit.storeName}`,
        content: `<span class="sales-map-visit-marker" aria-label="第${marker.visit.sequence}家拜访">${marker.visit.sequence}</span>`,
        anchor: 'bottom-center',
        zIndex: 120 + marker.visit.sequence,
      });
      overlay.on?.('click', () => {
        selectedMapVisitId.value = marker.visit.visitId;
      });
      mapInstance.add(overlay);
      overlays.push(overlay);
    }
    mapOverlays = overlays;
    mapInstance.setFitView(overlays.length ? overlays : undefined);
    mapStatus.value = 'ready';
  } catch (error) {
    if (generation !== mapRenderGeneration) return;
    mapError.value = error instanceof Error ? error.message : '地图加载失败';
    mapStatus.value = 'failed';
  }
}

function atLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseBusinessDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function withinTimeRange(value: string): boolean {
  const date = new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return time >= timeFrom.value && time <= timeTo.value;
}

function eventTime(value: string): number {
  return new Date(value).getTime();
}

function haversineMeters(longitude1: number, latitude1: number, longitude2: number, latitude2: number): number {
  const radians = (value: number) => value * Math.PI / 180;
  const lat1 = radians(latitude1);
  const lat2 = radians(latitude2);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(longitude2 - longitude1);
  const value = Math.sin(deltaLat / 2) ** 2
    + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function reviewStatusLabel(value: string): string {
  return ({
    IN_PROGRESS: '进行中', PENDING_REVIEW: '待核验', EFFECTIVE: '有效拜访', INEFFECTIVE: '未通过',
  } as Record<string, string>)[value] ?? value;
}
</script>

<template>
  <div class="workbench-page">
    <van-nav-bar title="我的记录" :fixed="true" :placeholder="true" />
    <div class="date-switcher surface-card">
      <button
        type="button"
        class="date-switcher__main"
        data-testid="track-date-button"
        :disabled="selectedDateLoading"
        @click="openDatePicker"
      >
        <span><small>轨迹与拜访日期</small><strong>{{ selectedDateLabel }}</strong></span>
        <van-icon name="calendar-o" size="22" />
      </button>
      <van-button v-if="!isSelectedToday" size="small" plain type="primary" :disabled="selectedDateLoading" @click="goToday">
        回到今天
      </van-button>
    </div>

    <van-tabs v-model:active="activeTab" sticky offset-top="46">
      <van-tab title="每日轨迹">
        <div v-if="workDay" class="record-card surface-card">
          <div class="record-card__header"><strong>{{ selectedDateScope }}工作日</strong><span>{{ workDay.status }}</span></div>
          <van-cell title="上班签到" :value="formatTime(workDay.checkedInAt)" />
          <van-cell title="下班签退" :value="formatTime(workDay.checkedOutAt)" />
          <div class="record-card__grid">
            <div><span>轨迹里程</span><strong>{{ formatDistance(track?.totalDistanceMeters) }}</strong></div>
            <div><span>拜访门店</span><strong>{{ track?.visits.length ?? 0 }} 家</strong></div>
            <div><span>轨迹跨度</span><strong>{{ formatDurationMinutes(track?.trackedDurationMinutes) }}</strong></div>
          </div>
          <p>距离按定位点累计，仅作为工作轨迹证据；有效拜访仍以最终复核状态为准。</p>
        </div>
        <div v-else-if="selectedDateLoading" class="record-state">
          <van-loading type="spinner" /><p>正在读取{{ selectedDateScope }}轨迹</p>
        </div>
        <div v-else class="record-state">
          <van-icon class="record-icon" name="location-o" size="34" />
          <strong>{{ salesStore.attendanceError || `${selectedDateScope}尚未创建工作日` }}</strong>
          <p v-if="isSelectedToday">签到后由Sales Work接收前台定位采样；中断只形成证据质量记录。</p>
          <p v-else>该日期没有可展示的考勤与定位轨迹。</p>
        </div>

        <template v-if="workDay">
          <div v-if="track" class="time-filter surface-card">
            <div class="time-filter__heading">
              <strong>查看时间范围</strong>
              <button v-if="hasTimeFilter" type="button" @click="resetTimeRange">查看全天</button>
            </div>
            <div class="time-filter__inputs">
              <label>开始<input v-model="timeFrom" type="time" aria-label="轨迹开始时间" /></label>
              <span>至</span>
              <label>结束<input v-model="timeTo" type="time" aria-label="轨迹结束时间" /></label>
            </div>
            <p v-if="!timeRangeValid" class="time-filter__error">结束时间不能早于开始时间</p>
            <p v-else>{{ hasTimeFilter ? '当前范围' : '全天' }}：{{ formatDistance(filteredDistanceMeters) }} · {{ formatDurationMinutes(filteredDurationMinutes) }} · {{ filteredTrack?.visits.length ?? 0 }} 家门店</p>
          </div>
          <div v-if="salesStore.trackLoading && !track" class="record-state record-state--compact">
            <van-loading type="spinner" /><p>正在加载地图轨迹</p>
          </div>
          <div v-else-if="salesStore.trackError && !track" class="record-state record-state--compact">
            <van-icon class="record-icon" name="warning-o" size="30" />
            <strong>轨迹加载失败</strong>
            <p>{{ salesStore.trackError }}</p>
            <van-button class="record-state__retry" size="small" plain type="primary" @click="loadSelectedDate">重新加载</van-button>
          </div>
          <div
            v-if="filteredTrack && amapReady"
            class="track-map-wrap surface-card"
            :class="{ 'track-map-wrap--fullscreen': isMapFullscreen }"
          >
            <div class="track-map__toolbar">
              <div><small>{{ selectedDateScope }}轨迹</small><strong>{{ filteredTrack?.visits.length ?? 0 }} 家门店 · {{ filteredTrack?.points.length ?? 0 }} 个定位点</strong></div>
              <button
                type="button"
                class="track-map__fullscreen-button"
                data-testid="track-fullscreen-button"
                :aria-pressed="isMapFullscreen"
                @click="toggleMapFullscreen"
              >
                <van-icon :name="isMapFullscreen ? 'cross' : 'expand-o'" />
                {{ isMapFullscreen ? '退出全屏' : '全屏查看' }}
              </button>
            </div>
            <div ref="mapContainer" class="track-map" />
            <div v-if="selectedMapVisit" class="track-map__visit-card">
              <span class="track-map__visit-sequence">{{ selectedMapVisit.sequence }}</span>
              <div>
                <strong>{{ selectedMapVisit.storeName }}</strong>
                <p>
                  到店 {{ formatTime(selectedMapVisit.checkedInAt) }}
                  <template v-if="selectedMapVisit.checkedOutAt"> · 离店 {{ formatTime(selectedMapVisit.checkedOutAt) }}</template>
                  · 停留 {{ formatDurationMinutes(selectedMapVisit.dwellMinutes) }}
                </p>
              </div>
              <button type="button" aria-label="关闭拜访点详情" @click="selectedMapVisitId = null"><van-icon name="cross" /></button>
            </div>
            <div class="track-map__legend">
              <span><i class="track-map__legend-visit">1</i>数字为拜访顺序</span>
              <span><i class="track-map__legend-in">上</i>签到</span>
              <span><i class="track-map__legend-out">下</i>签退</span>
            </div>
            <p v-if="mapStatus === 'loading'" class="track-map__hint"><van-loading size="16" /> 地图加载中</p>
            <p v-else-if="mapStatus === 'failed'" class="track-map__hint track-map__hint--error">
              {{ mapError }}，已降级为时间线
            </p>
          </div>
          <div v-if="filteredTrack?.segments.length" class="segment-list surface-card">
            <div class="record-card__header"><strong>拜访间行程</strong><span>{{ filteredTrack.segments.length }} 段</span></div>
            <div v-for="segment in filteredTrack.segments" :key="`${segment.fromVisitId}-${segment.toVisitId}`" class="segment-row">
              <i />
              <div><strong>第{{ segment.fromSequence }}家 → 第{{ segment.toSequence }}家</strong><p>{{ segment.fromStoreName }} → {{ segment.toStoreName }}</p></div>
              <span>{{ formatDistance(segment.distanceMeters) }}<small>{{ formatDurationMinutes(segment.durationMinutes) }}{{ segment.distanceSource === 'STRAIGHT_LINE' ? ' · 直线估算' : '' }}</small></span>
            </div>
          </div>
          <div v-if="filteredTrack && (!amapReady || mapStatus === 'fallback' || mapStatus === 'failed')" class="track-timeline surface-card">
            <div class="record-card__header"><strong>轨迹时间线</strong><span>{{ timeline.length }} 条</span></div>
            <van-steps v-if="timeline.length" direction="vertical" :active="timeline.length - 1">
              <van-step v-for="row in timeline" :key="row.key">
                <h4>{{ row.title }} · {{ formatTime(row.time) }}</h4>
                <p>{{ row.detail }}</p>
              </van-step>
            </van-steps>
            <p v-else class="track-timeline__empty">{{ selectedDateScope }}暂无定位点和打卡打点。</p>
            <p v-if="!amapReady" class="track-timeline__note">未配置高德地图 Key（VITE_AMAP_JS_KEY），当前展示时间线视图。</p>
          </div>
        </template>
      </van-tab>
      <van-tab title="拜访记录">
        <van-cell-group v-if="visits?.items.length" inset class="visit-list">
          <van-cell
            v-for="visit in visits.items"
            :key="visit.id"
            icon="shop-o"
            is-link
            :to="{ path: '/visit', query: { visitId: visit.id } }"
          >
            <template #title>
              <strong>{{ visit.targetSnapshot?.storeName || '门店拜访' }}</strong>
              <span class="visit-status" :class="`visit-status--${visit.status.toLowerCase()}`">
                {{ reviewStatusLabel(visit.reviewStatus) }}
              </span>
            </template>
            <template #label>
              <span>{{ visit.visitType === 'REVISIT' ? '复访' : '首访' }} · 到店 {{ formatTime(visit.checkedInAt) }}</span>
              <span v-if="visit.checkedOutAt"> · 离店 {{ formatTime(visit.checkedOutAt) }}</span>
            </template>
          </van-cell>
        </van-cell-group>
        <div v-else-if="salesStore.visitsLoading" class="record-state">
          <van-loading type="spinner" /><p>正在读取拜访记录</p>
        </div>
        <div v-else class="record-state">
          <van-icon class="record-icon" name="orders-o" size="34" />
          <strong>{{ salesStore.visitsError || `${selectedDateScope}暂无拜访记录` }}</strong>
          <p>{{ salesStore.visitsError || '切换上方日期可查看其他工作日。' }}</p>
        </div>
      </van-tab>
      <van-tab title="证据状态">
        <div class="evidence-summary surface-card">
          <div><span>确认有效</span><strong>{{ evidenceSummary.effective }}</strong></div>
          <div><span>待核验</span><strong>{{ evidenceSummary.pending }}</strong></div>
          <div><span>未通过</span><strong>{{ evidenceSummary.ineffective }}</strong></div>
          <div><span>进行中</span><strong>{{ evidenceSummary.inProgress }}</strong></div>
        </div>
        <van-notice-bar class="evidence-notice" left-icon="info-o" text="这里只展示所选日期的服务端复核状态；录音上传或已离店不自动等于有效拜访。" wrapable />
      </van-tab>
    </van-tabs>

    <van-popup v-model:show="datePickerVisible" position="bottom" round :safe-area-inset-bottom="true">
      <van-date-picker
        v-model="pickerDate"
        title="选择轨迹与拜访日期"
        :min-date="minSelectableDate"
        :max-date="maxSelectableDate"
        confirm-button-text="查看该日记录"
        @confirm="onDateConfirm"
        @cancel="datePickerVisible = false"
      />
    </van-popup>
  </div>
</template>

<style scoped>
.record-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 18px 14px;
  padding: 52px 30px;
  color: var(--workbench-muted);
  text-align: center;
  background: #fff;
  border: 1px solid var(--workbench-line);
  border-radius: 16px;
}
.record-state--compact { padding: 30px 24px; }
.record-state__retry { margin-top: 14px; }
.date-switcher { display: flex; align-items: center; gap: 10px; margin: 14px 14px 0; padding: 8px 10px 8px 14px; }
.date-switcher__main { display: flex; flex: 1; align-items: center; justify-content: space-between; min-width: 0; padding: 4px 0; color: var(--workbench-primary); text-align: left; background: transparent; border: 0; }
.date-switcher__main:disabled { cursor: wait; opacity: 0.62; }
.date-switcher__main span { display: flex; flex-direction: column; min-width: 0; }
.date-switcher__main small { color: var(--workbench-muted); font-size: 11px; }
.date-switcher__main strong { margin-top: 3px; overflow: hidden; color: var(--workbench-ink); font-size: 15px; text-overflow: ellipsis; white-space: nowrap; }
.record-card { margin: 18px 14px; padding: 6px 0 14px; overflow: hidden; }
.record-card__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; color: var(--workbench-ink); }
.record-card__header span { color: var(--workbench-primary); font-size: 12px; }
.record-card__grid { display: grid; grid-template-columns: repeat(3, 1fr); padding: 14px 8px; text-align: center; border-top: 1px solid var(--workbench-line); }
.record-card__grid div { border-right: 1px solid var(--workbench-line); }
.record-card__grid div:last-child { border-right: 0; }
.record-card__grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.record-card__grid strong { display: block; margin-top: 5px; color: var(--workbench-ink); font-size: 14px; }
.record-card > p { margin: 0 16px; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; }
.record-icon { color: #8ba9dd; }
.record-state strong { margin-top: 16px; color: var(--workbench-ink); font-size: 15px; }
.record-state p { margin: 8px 0 0; font-size: 12px; line-height: 1.7; }
.visit-list { margin: 14px; }
.visit-status { margin-left: 8px; padding: 1px 6px; border-radius: 8px; font-size: 10px; }
.visit-status--checked_in { color: var(--workbench-primary); background: #edf4ff; }
.visit-status--checked_out { color: #389e6d; background: #e9f8f0; }
.track-map-wrap { position: relative; display: flex; flex-direction: column; margin: 14px; padding: 10px; }
.track-map__toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 2px 2px 10px; }
.track-map__toolbar > div { display: flex; flex-direction: column; min-width: 0; }
.track-map__toolbar small { color: var(--workbench-muted); font-size: 11px; }
.track-map__toolbar strong { margin-top: 2px; color: var(--workbench-ink); font-size: 14px; }
.track-map__fullscreen-button { display: inline-flex; align-items: center; gap: 5px; flex: none; min-height: 34px; padding: 0 10px; color: var(--workbench-primary); font-size: 12px; background: #edf4ff; border: 0; border-radius: 9px; }
.track-map { width: 100%; height: 320px; border-radius: 12px; overflow: hidden; background: #eef2f8; }
.track-map__visit-card { position: absolute; z-index: 4; right: 22px; bottom: 48px; left: 22px; display: grid; grid-template-columns: 34px minmax(0, 1fr) 26px; gap: 10px; align-items: center; padding: 11px 12px; background: rgba(255, 255, 255, 0.96); border: 1px solid rgba(36, 104, 242, 0.18); border-radius: 12px; box-shadow: 0 8px 24px rgba(24, 43, 77, 0.16); backdrop-filter: blur(8px); }
.track-map__visit-sequence { display: grid; width: 34px; height: 34px; color: #fff; font-size: 14px; font-weight: 700; background: #2468f2; border-radius: 50%; place-items: center; }
.track-map__visit-card strong { display: block; overflow: hidden; color: var(--workbench-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.track-map__visit-card p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 10px; }
.track-map__visit-card button { display: grid; width: 26px; height: 26px; padding: 0; color: var(--workbench-muted); background: #f1f4f8; border: 0; border-radius: 50%; place-items: center; }
.track-map__legend { display: flex; gap: 12px; align-items: center; padding: 9px 2px 0; color: var(--workbench-muted); font-size: 10px; }
.track-map__legend span { display: inline-flex; gap: 4px; align-items: center; }
.track-map__legend i { display: grid; width: 18px; height: 18px; color: #fff; font-size: 9px; font-style: normal; font-weight: 700; border-radius: 50%; place-items: center; }
.track-map__legend-visit { background: #2468f2; }
.track-map__legend-in { background: #16a36a; }
.track-map__legend-out { background: #5f6c80; }
.track-map-wrap--fullscreen { position: fixed; z-index: 3000; inset: 0; width: 100%; height: 100vh; height: 100dvh; margin: 0; padding: max(10px, env(safe-area-inset-top)) 10px max(10px, env(safe-area-inset-bottom)); background: #fff; border: 0; border-radius: 0; }
.track-map-wrap--fullscreen .track-map { flex: 1; min-height: 0; height: auto; border-radius: 0; }
.track-map-wrap--fullscreen .track-map__toolbar { padding: 2px 2px 10px; }
.track-map__hint { display: flex; gap: 6px; align-items: center; margin: 8px 4px 0; color: var(--workbench-muted); font-size: 11px; }
.track-map__hint--error { color: #c45656; }
.time-filter { margin: 14px; padding: 14px; }
.time-filter__heading { display: flex; align-items: center; justify-content: space-between; }
.time-filter__heading strong { color: var(--workbench-ink); font-size: 13px; }
.time-filter__heading button { padding: 0; color: var(--workbench-primary); font-size: 11px; background: transparent; border: 0; }
.time-filter__inputs { display: grid; grid-template-columns: 1fr auto 1fr; gap: 8px; align-items: end; margin-top: 10px; color: var(--workbench-muted); font-size: 11px; }
.time-filter__inputs label { display: flex; flex-direction: column; gap: 4px; }
.time-filter__inputs input { min-width: 0; height: 38px; padding: 0 10px; color: var(--workbench-ink); font: inherit; font-size: 14px; background: #f7f9fc; border: 1px solid var(--workbench-line); border-radius: 9px; }
.time-filter > p { margin: 8px 0 0; color: var(--workbench-muted); font-size: 11px; }
.time-filter .time-filter__error { color: #c45656; }
.segment-list { margin: 14px; padding: 4px 0 8px; }
.segment-row { display: grid; grid-template-columns: 4px minmax(0, 1fr) auto; gap: 10px; align-items: center; padding: 11px 16px; border-top: 1px solid var(--workbench-line); }
.segment-row i { width: 4px; height: 34px; background: #2468f2; border-radius: 4px; }
.segment-row strong { color: var(--workbench-ink); font-size: 12px; }
.segment-row p { margin: 3px 0 0; overflow: hidden; color: var(--workbench-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.segment-row > span { color: var(--workbench-ink); font-size: 12px; font-weight: 600; text-align: right; }
.segment-row small { display: block; margin-top: 3px; color: var(--workbench-muted); font-size: 9px; font-weight: 400; }
.evidence-summary { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; margin: 14px; overflow: hidden; background: var(--workbench-line); }
.evidence-summary div { padding: 24px 16px; text-align: center; background: #fff; }
.evidence-summary span { display: block; color: var(--workbench-muted); font-size: 11px; }
.evidence-summary strong { display: block; margin-top: 7px; color: var(--workbench-ink); font-size: 22px; }
.evidence-notice { margin: 0 14px; border-radius: 12px; }
.track-timeline { margin: 14px; padding: 6px 0 16px; }
.track-timeline h4 { margin: 0; color: var(--workbench-ink); font-size: 13px; }
.track-timeline p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 11px; }
.track-timeline__empty { padding: 12px 18px 0; line-height: 1.7; }
.track-timeline__note { padding: 10px 18px 0; color: #b5781b; font-size: 11px; }
:global(body.track-map-fullscreen-lock) { overflow: hidden; }
:global(.sales-map-visit-marker), :global(.sales-map-punch) { position: relative; display: grid; box-sizing: border-box; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight: 700; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 4px 12px rgba(24, 43, 77, 0.28); place-items: center; }
:global(.sales-map-visit-marker) { width: 38px; height: 38px; font-size: 14px; background: #2468f2; }
:global(.sales-map-visit-marker::after) { position: absolute; bottom: -7px; width: 0; height: 0; border-top: 9px solid #2468f2; border-right: 6px solid transparent; border-left: 6px solid transparent; content: ''; }
:global(.sales-map-punch) { width: 32px; height: 32px; font-size: 11px; }
:global(.sales-map-punch--in) { background: #16a36a; }
:global(.sales-map-punch--out) { background: #5f6c80; }
</style>
