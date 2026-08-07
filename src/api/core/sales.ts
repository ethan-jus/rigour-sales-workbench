import { apiClient } from './client';
import type { ApiResponse } from '@/types';

export interface FieldPolicyView {
  id: string;
  policyCode: string;
  policyName: string;
  versionNo: number;
  publishStatus: string;
  timezoneId: string;
  businessDayCutoff: string;
  checkInWindowStart: string | null;
  checkInWindowEnd: string | null;
  checkOutWindowStart: string | null;
  checkOutWindowEnd: string | null;
  standardWorkMinutes: number;
  minimumWorkMinutes: number;
  requireCheckOut: boolean;
  allowAdjustment: boolean;
  adjustmentDeadlineHours: number | null;
  locationEnabled: boolean;
  locationIntervalMinutes: number;
  minimumLocationAccuracyMeters: number | null;
  offlineUploadDeadlineMinutes: number;
}

export interface SalesContextView {
  userId: string;
  employeeId: string;
  salesProfileId: string;
  salesNo: string;
  cityOrgId: string | null;
  profileStatus: string;
  permissions: string[];
  fieldPolicy: FieldPolicyView;
}

export interface VisitTargetView {
  projectionId: string;
  targetType: string;
  customerId: string | null;
  storeId: string;
  customerName: string | null;
  storeName: string;
  storeAddress: string | null;
  longitude: number | null;
  latitude: number | null;
  storeStatus: string;
  sourceVersion: number;
  sourceUpdatedAt: string;
}

export interface VisitTargetPageView {
  items: VisitTargetView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface LocationEvidence {
  longitude: number;
  latitude: number;
  accuracyMeters: number;
  source: string;
}

export interface CheckInCommand {
  idempotencyKey: string;
  clientInstanceId: string;
  clientOccurredAt: string;
  location: LocationEvidence;
  deviceIdHash?: string;
  networkType?: string;
}

export interface LocationPointCommand {
  deviceEventId: string;
  longitude: number;
  latitude: number;
  accuracyMeters: number;
  clientOccurredAt: string;
  source: string;
}

export interface LocationBatchResult {
  workDayId: string;
  acceptedCount: number;
  duplicateCount: number;
  rejectedCount: number;
  lastReceivedAt: string;
}

export interface WorkDayView {
  id: string;
  employeeId: string;
  salesProfileId: string;
  businessDate: string;
  timezoneId: string;
  fieldPolicyVersionId: string;
  status: 'NOT_STARTED' | 'ACTIVE' | 'FINISHED' | 'PENDING_REVIEW' | string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  locationSessionId: string | null;
  locationPointCount: number;
  interruptionCount: number;
  verifiedWorkMinutes: number;
  evidenceQuality: string;
}

export interface CheckOutCommand {
  idempotencyKey: string;
  clientOccurredAt: string;
  location: LocationEvidence;
  deviceIdHash?: string;
  networkType?: string;
}

export interface InterruptionCommand {
  idempotencyKey: string;
  interruptionType: string;
  startedAt: string;
  endedAt?: string;
  durationSeconds?: number;
  clientDetail?: string;
}

export const salesApi = {
  context(): Promise<ApiResponse<SalesContextView>> {
    return apiClient.get<SalesContextView>('/sales/me/context');
  },

  visitTargets(query = '', page = 1, pageSize = 20): Promise<ApiResponse<VisitTargetPageView>> {
    return apiClient.get<VisitTargetPageView>('/sales/me/visit-targets', {
      q: query,
      page: String(page),
      pageSize: String(pageSize),
    });
  },

  workDay(date: string): Promise<ApiResponse<WorkDayView>> {
    return apiClient.get<WorkDayView>(`/sales/me/work-days/${date}`);
  },

  checkIn(command: CheckInCommand): Promise<ApiResponse<WorkDayView>> {
    return apiClient.post<WorkDayView>('/sales/work-days/check-in', command);
  },

  uploadLocationPoints(workDayId: string, command: { idempotencyKey: string; points: LocationPointCommand[] }): Promise<ApiResponse<LocationBatchResult>> {
    return apiClient.post<LocationBatchResult>(`/sales/work-days/${workDayId}/location-points:batch`, command);
  },

  reportInterruption(workDayId: string, command: InterruptionCommand): Promise<ApiResponse<WorkDayView>> {
    return apiClient.post<WorkDayView>(`/sales/work-days/${workDayId}/interruptions`, command);
  },

  checkOut(workDayId: string, command: CheckOutCommand): Promise<ApiResponse<WorkDayView>> {
    return apiClient.post<WorkDayView>(`/sales/work-days/${workDayId}/check-out`, command);
  },
};
