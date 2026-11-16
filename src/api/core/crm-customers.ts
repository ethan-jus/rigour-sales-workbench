import { apiClient } from './client';
import type { LocationEvidence } from './sales';

export interface CrmCustomer {
  id: string;
  name: string;
  address: string;
  publicPhone: string | null;
  ownerEmployeeId: string | null;
  currentOwnershipId: string | null;
  poolType: string;
  recordStatus: string;
  phase: string | null;
  deadlineAt: string | null;
  holdReason: string | null;
  cooperationStatus: string;
  customerTier: string;
  lastVisitAt: string | null;
  revision: number;
  businessStatus: string;
  claimBlockedReason: string | null;
}
export interface CrmCustomerQuery {
  view?: 'PUBLIC' | 'MINE';
  keyword?: string;
  phase?: string;
  protection?: string;
  cursor?: string;
}
export const crmCustomersApi = {
  context: (view: 'PUBLIC' | 'MINE' = 'MINE') => apiClient.get<{ employeeId: string | null; permissions: string[] }>('/crm/stores/context', { view }),
  list: (query: CrmCustomerQuery) => apiClient.get<{ items: CrmCustomer[]; total: number; nextCursor: string | null }>(
    '/crm/stores', { ...query, view: query.view ?? 'MINE', size: '20' },
  ),
  detail: (id: string) => apiClient.get<CrmCustomer>(`/crm/stores/${encodeURIComponent(id)}`, { view: 'MINE' }),
  visits: (id: string) => apiClient.get<{
    id: string; ownershipId: string; salespersonId: string; captureRef: string | null;
  }[]>(`/crm/stores/${encodeURIComponent(id)}/visits`, { view: 'MINE' }),
  claim: (id: string, command: { requestId: string; revision: number }) =>
    apiClient.post<void>(`/crm/stores/${encodeURIComponent(id)}/claim`, command),
  startVisit: (command: {
    requestId: string; storeId: string; ownershipId: string; workDayId: string; location: LocationEvidence;
  }) => apiClient.post<{ visitId: string; captureId: string }>('/sales/work/store-visits', command),
};
