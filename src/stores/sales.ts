import { defineStore } from 'pinia';
import { ref } from 'vue';
import { normalizeError } from '@/api/core/error';
import {
  salesApi,
  type CheckInCommand,
  type CheckOutCommand,
  type InterruptionCommand,
  type LocationBatchResult,
  type LocationPointCommand,
  type SalesContextView,
  type VisitTargetPageView,
  type WorkDayView,
} from '@/api/core/sales';

export const useSalesStore = defineStore('sales', () => {
  const context = ref<SalesContextView | null>(null);
  const targets = ref<VisitTargetPageView | null>(null);
  const workDay = ref<WorkDayView | null>(null);
  const contextLoading = ref(false);
  const targetsLoading = ref(false);
  const attendanceLoading = ref(false);
  const errorMessage = ref<string | null>(null);
  const attendanceError = ref<string | null>(null);

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
    context.value = null;
    targets.value = null;
    workDay.value = null;
    errorMessage.value = null;
    attendanceError.value = null;
  }

  return {
    context,
    targets,
    contextLoading,
    targetsLoading,
    workDay,
    attendanceLoading,
    errorMessage,
    attendanceError,
    loadContext,
    loadTargets,
    loadWorkDay,
    checkIn,
    uploadLocationPoints,
    reportInterruption,
    checkOut,
    clear,
  };
});

function createIdempotencyKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}
