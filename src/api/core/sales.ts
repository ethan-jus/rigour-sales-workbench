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
  effectiveFrom: string | null;
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

export interface NearbyStoreView {
  poiId: string;
  name: string;
  address: string | null;
  type: string | null;
  typeCode: string | null;
  longitude: number | null;
  latitude: number | null;
  distanceMeters: number | null;
  storeId: string | null;
  alreadyInMyStores: boolean;
  source: string;
}

export interface NearbyStorePageView {
  items: NearbyStoreView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface PoiTargetCommand {
  poiId: string;
  name: string;
  address: string | null;
  longitude: number;
  latitude: number;
  distanceMeters: number | null;
}

export interface CreateVisitCommand {
  idempotencyKey: string;
  workDayId: string;
  targetType: 'MY_STORE' | 'POI';
  storeId?: string;
  poi?: PoiTargetCommand;
  location: LocationEvidence;
  clientOccurredAt: string;
  deviceEventId: string;
}

export interface CheckOutVisitCommand {
  idempotencyKey: string;
  clientOccurredAt: string;
  location: LocationEvidence;
  deviceEventId: string;
}

export interface VisitTargetSnapshotView {
  targetType: string;
  customerId: string | null;
  storeId: string | null;
  customerName: string | null;
  storeName: string;
  storeAddress: string | null;
  longitude: number | null;
  latitude: number | null;
  assignedSalesProfileId: string | null;
}

export interface VisitCheckpointView {
  id: string;
  checkpointType: string;
  deviceEventId: string;
  clientOccurredAt: string | null;
  serverReceivedAt: string;
  longitude: number;
  latitude: number;
  accuracyMeters: number | null;
  distanceToTargetMeters: number | null;
  evidenceStatus: string;
}

export interface VisitView {
  id: string;
  workDayId: string;
  salesProfileId: string;
  targetType: string;
  customerId: string | null;
  storeId: string | null;
  status: 'CHECKED_IN' | 'CHECKED_OUT' | string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  visitPolicyVersionId: string;
  targetSnapshot: VisitTargetSnapshotView | null;
  checkpoints: VisitCheckpointView[];
  createdAt: string;
  contactOutcome: VisitContactOutcome | null;
  kpName: string | null;
  kpPhone: string | null;
  intentionLevel: string | null;
  resultNote: string | null;
  resultSubmittedAt: string | null;
  visitType: 'FIRST_VISIT' | 'REVISIT' | string;
  reviewStatus: 'IN_PROGRESS' | 'PENDING_REVIEW' | 'EFFECTIVE' | 'INEFFECTIVE' | string;
}

export type VisitContactOutcome = 'CONTACTED' | 'STORE_CLOSED' | 'KP_ABSENT' | 'REFUSED' | 'OTHER_NO_CONTACT';

export interface VisitPageView {
  items: VisitView[];
  page: number;
  pageSize: number;
  total: number;
}

export interface VisitActivitySummaryView {
  from: string;
  to: string;
  totalVisitCount: number;
  completedVisitCount: number;
  inProgressVisitCount: number;
  effectiveVisitCount: number;
  pendingReviewVisitCount: number;
  firstVisitCount: number;
  revisitCount: number;
  uniqueStoreCount: number;
  assignedStoreCount: number;
}

export interface VisitResultCommand {
  contactOutcome: VisitContactOutcome;
  kpName: string | null;
  kpPhone: string | null;
  intentionLevel: string | null;
  resultNote: string | null;
}

export interface RecordingClipView {
  clipId: string;
  sessionId: string;
  clientClipId: string;
  clipIndex: number;
  objectSizeBytes: number;
  clientDurationMs: number | null;
  uploadStatus: string;
  createdAt: string;
}

export interface RecordingSessionView {
  sessionId: string | null;
  visitId: string;
  status: string;
  clipCount: number;
  uploadedTotalDurationMs: number;
  verifiedTotalDurationMs: number;
  recordingEnabled: boolean;
  minimumRecordingSeconds: number;
  minimumClipSeconds: number;
  clips: RecordingClipView[];
}

export interface DiscardRecordingClipCommand {
  clientClipId: string;
  durationMs: number;
  recordedFrom: string;
  recordedTo: string;
  reason: 'TOO_SHORT';
}

export interface DiscardRecordingClipView {
  clientClipId: string;
  durationMs: number;
  disposition: 'DISCARDED_NOT_STORED' | string;
  recordedAt: string;
}

export interface TrackPointView {
  longitude: number;
  latitude: number;
  accuracyMeters: number | null;
  clientOccurredAt: string | null;
  serverReceivedAt: string;
  source: string;
  qualityStatus: string;
}

export interface TrackPunchView {
  eventType: string;
  clientOccurredAt: string | null;
  serverReceivedAt: string;
  longitude: number | null;
  latitude: number | null;
  accuracyMeters: number | null;
  evidenceStatus: string;
}

export interface TrackVisitView {
  visitId: string;
  sequence: number;
  storeId: string | null;
  storeName: string;
  longitude: number | null;
  latitude: number | null;
  status: string;
  checkedInAt: string;
  checkedOutAt: string | null;
  dwellMinutes: number;
  visitType: string;
  reviewStatus: string;
}

export interface TrackTravelSegmentView {
  fromVisitId: string;
  toVisitId: string;
  fromSequence: number;
  toSequence: number;
  fromStoreName: string;
  toStoreName: string;
  distanceMeters: number;
  durationMinutes: number;
  distanceSource: 'TRACK' | 'STRAIGHT_LINE' | string;
}

export interface WorkDayTrackView {
  workDayId: string;
  businessDate: string;
  status: string;
  totalDistanceMeters: number;
  trackedDurationMinutes: number;
  points: TrackPointView[];
  punches: TrackPunchView[];
  visits: TrackVisitView[];
  segments: TrackTravelSegmentView[];
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

export interface AttendanceMonthDayView {
  businessDate: string;
  workDayId: string | null;
  scheduleStatus: 'WORK_RECORDED' | 'REST' | 'UNKNOWN' | string;
  attendanceStatus: 'MEETS_MINIMUM' | 'SHORT' | 'MISSING_CHECK_OUT' | 'PENDING_REVIEW'
    | 'IN_PROGRESS' | 'NO_RECORD' | 'FUTURE' | string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  verifiedWorkMinutes: number;
  minimumWorkMinutes: number | null;
  evidenceQuality: string | null;
}

export interface AttendanceMonthView {
  month: string;
  today: string;
  days: AttendanceMonthDayView[];
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

  nearbyStores(
    longitude: number,
    latitude: number,
    radiusMeters: number,
    query = '',
    page = 1,
    pageSize = 20,
  ): Promise<ApiResponse<NearbyStorePageView>> {
    return apiClient.get<NearbyStorePageView>('/sales/me/nearby-stores', {
      longitude: String(longitude),
      latitude: String(latitude),
      radiusMeters: String(radiusMeters),
      q: query,
      page: String(page),
      pageSize: String(pageSize),
    });
  },

  createVisit(command: CreateVisitCommand): Promise<ApiResponse<VisitView>> {
    return apiClient.post<VisitView>('/sales/me/visits', command);
  },

  visits(page = 1, pageSize = 20, date?: string): Promise<ApiResponse<VisitPageView>> {
    return apiClient.get<VisitPageView>('/sales/me/visits', {
      page: String(page),
      pageSize: String(pageSize),
      ...(date ? { date } : {}),
    });
  },

  activitySummary(from: string, to: string): Promise<ApiResponse<VisitActivitySummaryView>> {
    return apiClient.get<VisitActivitySummaryView>('/sales/me/activity-summary', { from, to });
  },

  visit(visitId: string): Promise<ApiResponse<VisitView>> {
    return apiClient.get<VisitView>(`/sales/me/visits/${visitId}`);
  },

  checkOutVisit(visitId: string, command: CheckOutVisitCommand): Promise<ApiResponse<VisitView>> {
    return apiClient.post<VisitView>(`/sales/me/visits/${visitId}/check-out`, command);
  },

  submitVisitResult(visitId: string, command: VisitResultCommand): Promise<ApiResponse<VisitView>> {
    return apiClient.put<VisitView>(`/sales/me/visits/${visitId}/result`, command);
  },

  recordings(visitId: string): Promise<ApiResponse<RecordingSessionView>> {
    return apiClient.get<RecordingSessionView>(`/sales/me/visits/${visitId}/recordings`);
  },

  discardRecordingClip(
    visitId: string,
    command: DiscardRecordingClipCommand,
  ): Promise<ApiResponse<DiscardRecordingClipView>> {
    return apiClient.post<DiscardRecordingClipView>(
      `/sales/me/visits/${visitId}/recordings/discarded-clips`,
      command,
    );
  },

  workDay(date: string): Promise<ApiResponse<WorkDayView>> {
    return apiClient.get<WorkDayView>(`/sales/me/work-days/${date}`);
  },

  attendanceMonth(month: string): Promise<ApiResponse<AttendanceMonthView>> {
    return apiClient.get<AttendanceMonthView>('/sales/me/work-days/month', { month });
  },

  workDayTrack(date: string): Promise<ApiResponse<WorkDayTrackView>> {
    return apiClient.get<WorkDayTrackView>(`/sales/me/work-days/${date}/track`);
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
