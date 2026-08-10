import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getFeishuAdapter } from '@/adapters';
import { normalizeError } from '@/api/core/error';
import { createIdempotencyKey } from '@/utils/id';
import type { CapabilityStatus } from '@/types';
import {
  salesApi,
  type AttendanceMonthView,
  type CheckOutVisitCommand,
  type CheckInCommand,
  type CheckOutCommand,
  type CreateVisitCommand,
  type DiscardRecordingClipCommand,
  type InterruptionCommand,
  type LocationBatchResult,
  type LocationPointCommand,
  type NearbyStorePageView,
  type RecordingSessionView,
  type SalesContextView,
  type VisitPageView,
  type VisitActivitySummaryView,
  type VisitResultCommand,
  type VisitTargetPageView,
  type VisitView,
  type WorkDayTrackView,
  type WorkDayView,
} from '@/api/core/sales';

export const useSalesStore = defineStore('sales', () => {
  const context = ref<SalesContextView | null>(null);
  const targets = ref<VisitTargetPageView | null>(null);
  const nearbyStores = ref<NearbyStorePageView | null>(null);
  const visits = ref<VisitPageView | null>(null);
  const activeVisit = ref<VisitView | null>(null);
  const recordingSession = ref<RecordingSessionView | null>(null);
  const todaySummary = ref<VisitActivitySummaryView | null>(null);
  const monthSummary = ref<VisitActivitySummaryView | null>(null);
  const workDay = ref<WorkDayView | null>(null);
  const attendanceMonth = ref<AttendanceMonthView | null>(null);
  const track = ref<WorkDayTrackView | null>(null);
  const contextLoading = ref(false);
  const targetsLoading = ref(false);
  const nearbyLoading = ref(false);
  const visitsLoading = ref(false);
  const visitLoading = ref(false);
  const attendanceLoading = ref(false);
  const attendanceMonthLoading = ref(false);
  const trackLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const nearbyError = ref<string | null>(null);
  const visitsError = ref<string | null>(null);
  const visitError = ref<string | null>(null);
  const attendanceError = ref<string | null>(null);
  const trackError = ref<string | null>(null);
  const recordingError = ref<string | null>(null);
  const summaryLoading = ref(false);
  const summaryError = ref<string | null>(null);
  const locationStatus = ref<CapabilityStatus>(getFeishuAdapter().getLocationStatus());
  const trackingWorkDayId = ref<string | null>(null);
  let uploadChain: Promise<void> = Promise.resolve();
  let lastInterruptionAt = 0;

  async function loadContext(force = false): Promise<SalesContextView | null> {
    if (context.value && !force) return context.value;
    contextLoading.value = true;
    errorMessage.value = null;
    try {
      context.value = (await salesApi.context()).data;
      return context.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      contextLoading.value = false;
    }
  }

  async function loadTargets(query = '', page = 1): Promise<VisitTargetPageView | null> {
    targetsLoading.value = true;
    errorMessage.value = null;
    try {
      targets.value = (await salesApi.visitTargets(query, page)).data;
      return targets.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      targetsLoading.value = false;
    }
  }

  async function loadNearbyStores(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    query = '',
    page = 1,
  ): Promise<NearbyStorePageView | null> {
    nearbyLoading.value = true;
    nearbyError.value = null;
    try {
      nearbyStores.value = (await salesApi.nearbyStores(longitude, latitude, radiusMeters, query, page)).data;
      return nearbyStores.value;
    } catch (error) {
      nearbyError.value = normalizeError(error).message;
      return null;
    } finally {
      nearbyLoading.value = false;
    }
  }

  async function createVisit(command: CreateVisitCommand): Promise<VisitView | null> {
    visitLoading.value = true;
    visitError.value = null;
    try {
      activeVisit.value = (await salesApi.createVisit(command)).data;
      recordingSession.value = null;
      prependVisit(activeVisit.value);
      return activeVisit.value;
    } catch (error) {
      visitError.value = normalizeError(error).message;
      return null;
    } finally {
      visitLoading.value = false;
    }
  }

  async function loadVisits(page = 1, date?: string): Promise<VisitPageView | null> {
    visitsLoading.value = true;
    visitsError.value = null;
    try {
      visits.value = (await salesApi.visits(page, 20, date)).data;
      return visits.value;
    } catch (error) {
      visitsError.value = normalizeError(error).message;
      return null;
    } finally {
      visitsLoading.value = false;
    }
  }

  async function loadActivitySummaries(date: string): Promise<void> {
    summaryLoading.value = true;
    summaryError.value = null;
    const monthStart = `${date.slice(0, 7)}-01`;
    try {
      const [todayResponse, monthResponse] = await Promise.all([
        salesApi.activitySummary(date, date),
        salesApi.activitySummary(monthStart, date),
      ]);
      todaySummary.value = todayResponse.data;
      monthSummary.value = monthResponse.data;
    } catch (error) {
      todaySummary.value = null;
      monthSummary.value = null;
      summaryError.value = normalizeError(error).message;
    } finally {
      summaryLoading.value = false;
    }
  }

  async function loadVisit(visitId: string): Promise<VisitView | null> {
    visitLoading.value = true;
    visitError.value = null;
    if (activeVisit.value?.id !== visitId) activeVisit.value = null;
    try {
      activeVisit.value = (await salesApi.visit(visitId)).data;
      return activeVisit.value;
    } catch (error) {
      visitError.value = normalizeError(error).message;
      return null;
    } finally {
      visitLoading.value = false;
    }
  }

  async function checkOutVisit(visitId: string, command: CheckOutVisitCommand): Promise<VisitView | null> {
    visitLoading.value = true;
    visitError.value = null;
    try {
      activeVisit.value = (await salesApi.checkOutVisit(visitId, command)).data;
      patchVisit(activeVisit.value);
      return activeVisit.value;
    } catch (error) {
      visitError.value = normalizeError(error).message;
      return null;
    } finally {
      visitLoading.value = false;
    }
  }

  async function submitVisitResult(visitId: string, command: VisitResultCommand): Promise<VisitView | null> {
    visitLoading.value = true;
    visitError.value = null;
    try {
      activeVisit.value = (await salesApi.submitVisitResult(visitId, command)).data;
      patchVisit(activeVisit.value);
      return activeVisit.value;
    } catch (error) {
      visitError.value = normalizeError(error).message;
      return null;
    } finally {
      visitLoading.value = false;
    }
  }

  async function loadRecordings(visitId: string): Promise<RecordingSessionView | null> {
    recordingError.value = null;
    if (recordingSession.value?.visitId !== visitId) recordingSession.value = null;
    try {
      recordingSession.value = (await salesApi.recordings(visitId)).data;
      return recordingSession.value;
    } catch (error) {
      recordingSession.value = null;
      recordingError.value = normalizeError(error).message;
      return null;
    }
  }

  async function recordDiscardedClip(
    visitId: string,
    command: DiscardRecordingClipCommand,
  ): Promise<string | null> {
    try {
      await salesApi.discardRecordingClip(visitId, command);
      return null;
    } catch (error) {
      return normalizeError(error).message;
    }
  }

  async function loadWorkDay(date: string): Promise<WorkDayView | null> {
    attendanceLoading.value = true;
    attendanceError.value = null;
    try {
      workDay.value = (await salesApi.workDay(date)).data;
      return workDay.value;
    } catch (error) {
      const normalized = normalizeError(error);
      if (normalized.code === 'SALES_WORK_DAY_NOT_FOUND') {
        workDay.value = null;
        return null;
      }
      attendanceError.value = normalized.message;
      return null;
    } finally {
      attendanceLoading.value = false;
    }
  }

  async function loadAttendanceMonth(month: string): Promise<AttendanceMonthView | null> {
    attendanceMonthLoading.value = true;
    attendanceError.value = null;
    try {
      attendanceMonth.value = (await salesApi.attendanceMonth(month)).data;
      return attendanceMonth.value;
    } catch (error) {
      attendanceMonth.value = null;
      attendanceError.value = normalizeError(error).message;
      return null;
    } finally {
      attendanceMonthLoading.value = false;
    }
  }

  async function loadTrack(date: string): Promise<WorkDayTrackView | null> {
    trackLoading.value = true;
    trackError.value = null;
    try {
      track.value = (await salesApi.workDayTrack(date)).data;
      return track.value;
    } catch (error) {
      track.value = null;
      trackError.value = normalizeError(error).message;
      return null;
    } finally {
      trackLoading.value = false;
    }
  }

  async function checkIn(command: CheckInCommand): Promise<WorkDayView | null> {
    attendanceLoading.value = true;
    attendanceError.value = null;
    try {
      workDay.value = (await salesApi.checkIn(command)).data;
      return workDay.value;
    } catch (error) {
      attendanceError.value = normalizeError(error).message;
      return null;
    } finally {
      attendanceLoading.value = false;
    }
  }

  async function uploadLocationPoints(workDayId: string, points: LocationPointCommand[]): Promise<LocationBatchResult | null> {
    attendanceError.value = null;
    try {
      const result = (await salesApi.uploadLocationPoints(workDayId, {
        idempotencyKey: createIdempotencyKey('location'),
        points,
      })).data;
      if (workDay.value?.id === workDayId) {
        workDay.value = {
          ...workDay.value,
          locationPointCount: workDay.value.locationPointCount + result.acceptedCount,
        };
      }
      return result;
    } catch (error) {
      attendanceError.value = normalizeError(error).message;
      return null;
    }
  }

  /**
   * 应用级定位会话。页面跳转不会停止；应用恢复且服务端工作日仍 ACTIVE 时可重新启动。
   * 飞书 WebView 退到后台仍只能尽力采样，中断事实由服务端记录。
   */
  async function ensureLocationTracking(workDayId: string): Promise<boolean> {
    if (trackingWorkDayId.value === workDayId
        && ['loading', 'ready', 'active'].includes(locationStatus.value)) {
      return true;
    }
    const adapter = getFeishuAdapter();
    trackingWorkDayId.value = workDayId;
    locationStatus.value = 'loading';
    try {
      await adapter.startLocation(
        (point) => {
          if (trackingWorkDayId.value !== workDayId) return;
          locationStatus.value = 'active';
          queueTrackedPoint(workDayId, point);
        },
        () => {
          if (trackingWorkDayId.value !== workDayId) return;
          locationStatus.value = 'interrupted';
          recordLocationInterruption(workDayId);
        },
      );
      if (locationStatus.value === 'loading') locationStatus.value = 'ready';
      return true;
    } catch (error) {
      trackingWorkDayId.value = null;
      locationStatus.value = 'failed';
      recordLocationInterruption(workDayId, 'LOCATION_FAILED');
      attendanceError.value = error instanceof Error ? error.message : '定位采样启动失败';
      return false;
    }
  }

  async function stopLocationTracking(): Promise<void> {
    trackingWorkDayId.value = null;
    await getFeishuAdapter().stopLocation();
    locationStatus.value = getFeishuAdapter().getLocationStatus();
  }

  function queueTrackedPoint(
    workDayId: string,
    point: { latitude: number; longitude: number; accuracy: number; timestamp: number },
  ): void {
    uploadChain = uploadChain.then(async () => {
      if (trackingWorkDayId.value !== workDayId) return;
      const result = await uploadLocationPoints(workDayId, [{
        deviceEventId: `${salesClientInstanceId()}-${point.timestamp}-${createIdempotencyKey('point')}`.slice(0, 128),
        longitude: point.longitude,
        latitude: point.latitude,
        accuracyMeters: point.accuracy,
        clientOccurredAt: new Date(point.timestamp).toISOString(),
        source: 'FEISHU',
      }]);
      if (!result) {
        locationStatus.value = 'interrupted';
        recordLocationInterruption(workDayId, 'LOCATION_UPLOAD_FAILED');
      }
    }).catch(() => {
      locationStatus.value = 'interrupted';
      recordLocationInterruption(workDayId, 'LOCATION_UPLOAD_FAILED');
    });
  }

  function recordLocationInterruption(
    workDayId: string,
    interruptionType = 'LOCATION_INTERRUPTED',
  ): void {
    const now = Date.now();
    if (now - lastInterruptionAt < 5_000) return;
    lastInterruptionAt = now;
    void reportInterruption(workDayId, {
      idempotencyKey: createIdempotencyKey('interruption'),
      interruptionType,
      startedAt: new Date(now).toISOString(),
      clientDetail: document.visibilityState === 'hidden' ? '页面进入后台' : '客户端定位或上传中断',
    });
  }

  function salesClientInstanceId(): string {
    const existing = localStorage.getItem('sales_client_instance_id');
    if (existing) return existing;
    const value = createIdempotencyKey('client');
    localStorage.setItem('sales_client_instance_id', value);
    return value;
  }

  async function reportInterruption(workDayId: string, command: InterruptionCommand): Promise<WorkDayView | null> {
    attendanceError.value = null;
    try {
      workDay.value = (await salesApi.reportInterruption(workDayId, command)).data;
      return workDay.value;
    } catch (error) {
      attendanceError.value = normalizeError(error).message;
      return null;
    }
  }

  async function checkOut(workDayId: string, command: CheckOutCommand): Promise<WorkDayView | null> {
    attendanceLoading.value = true;
    attendanceError.value = null;
    try {
      workDay.value = (await salesApi.checkOut(workDayId, command)).data;
      return workDay.value;
    } catch (error) {
      attendanceError.value = normalizeError(error).message;
      return null;
    } finally {
      attendanceLoading.value = false;
    }
  }

  function clear() {
    void stopLocationTracking();
    context.value = null;
    targets.value = null;
    nearbyStores.value = null;
    visits.value = null;
    activeVisit.value = null;
    recordingSession.value = null;
    todaySummary.value = null;
    monthSummary.value = null;
    attendanceMonth.value = null;
    workDay.value = null;
    track.value = null;
    errorMessage.value = null;
    nearbyError.value = null;
    visitsError.value = null;
    visitError.value = null;
    attendanceError.value = null;
    trackError.value = null;
    recordingError.value = null;
    summaryError.value = null;
  }

  /** 新建拜访后插入列表头部，避免返回轨迹页时看到旧列表。 */
  function prependVisit(visit: VisitView): void {
    if (!visits.value) return;
    visits.value = {
      ...visits.value,
      items: [visit, ...visits.value.items.filter((item) => item.id !== visit.id)],
      total: visits.value.total + 1,
    };
  }

  /** 签退等状态变化后同步列表中的对应记录。 */
  function patchVisit(visit: VisitView): void {
    if (!visits.value) return;
    visits.value = {
      ...visits.value,
      items: visits.value.items.map((item) => (item.id === visit.id ? visit : item)),
    };
  }

  return {
    context,
    targets,
    nearbyStores,
    visits,
    activeVisit,
    recordingSession,
    todaySummary,
    monthSummary,
    track,
    contextLoading,
    targetsLoading,
    nearbyLoading,
    visitsLoading,
    visitLoading,
    trackLoading,
    workDay,
    attendanceMonth,
    attendanceLoading,
    attendanceMonthLoading,
    errorMessage,
    nearbyError,
    visitsError,
    visitError,
    attendanceError,
    trackError,
    recordingError,
    summaryLoading,
    summaryError,
    locationStatus,
    trackingWorkDayId,
    loadContext,
    loadTargets,
    loadNearbyStores,
    createVisit,
    loadVisits,
    loadActivitySummaries,
    loadVisit,
    checkOutVisit,
    submitVisitResult,
    loadRecordings,
    recordDiscardedClip,
    loadWorkDay,
    loadAttendanceMonth,
    loadTrack,
    checkIn,
    uploadLocationPoints,
    ensureLocationTracking,
    stopLocationTracking,
    reportInterruption,
    checkOut,
    clear,
  };
});
