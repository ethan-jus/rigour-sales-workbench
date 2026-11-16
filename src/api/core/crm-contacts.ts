import { apiClient } from './client';

export interface ContactMethod {
  id: string;
  type: 'PHONE' | 'WECHAT_HINT';
  value: string;
  status: 'PENDING' | 'VERIFIED' | 'INVALID';
  verificationMethod: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  revision: number;
}
export interface StoreContact {
  id: string;
  name: string;
  role: string;
  primary: boolean;
  status: 'ACTIVE' | 'LEFT';
  revision: number;
  personRevision: number;
  methods: ContactMethod[];
  wecomRelations: {
    identityScope: string;
    externalUserId: string;
    employeeId: string;
    status: string;
    addedAt: string;
  }[];
}
const path = (store: string) => `/crm/stores/${encodeURIComponent(store)}`;
export const crmContactsApi = {
  list: (store: string) => apiClient.get<StoreContact[]>(`${path(store)}/contacts`),
  create: (
    store: string,
    command: {
      requestId: string;
      name: string;
      role: string;
      primary: boolean;
      phone: string;
      wechatHint: string;
    },
  ) => apiClient.post<StoreContact>(`${path(store)}/contacts`, command),
  update: (
    store: string,
    contact: string,
    command: {
      requestId: string;
      revision: number;
      personRevision: number;
      name: string;
      role: string;
      primary: boolean;
      status: string;
      reason: string;
    },
  ) =>
    apiClient.put<StoreContact>(`${path(store)}/contacts/${encodeURIComponent(contact)}`, command),
  link: (
    store: string,
    command: {
      requestId: string;
      sourceStoreId: string;
      contactId: string;
      role: string;
      primary: boolean;
      reason: string;
    },
  ) => apiClient.post<StoreContact>(`${path(store)}/contacts/link`, command),
  addMethod: (
    store: string,
    contact: string,
    command: { requestId: string; type: string; value: string; reason: string },
  ) =>
    apiClient.post<StoreContact>(
      `${path(store)}/contacts/${encodeURIComponent(contact)}/methods`,
      command,
    ),
  verify: (
    store: string,
    contact: string,
    method: string,
    command: {
      requestId: string;
      revision: number;
      status: string;
      verificationMethod: string;
      reason: string;
    },
  ) =>
    apiClient.put<StoreContact>(
      `${path(store)}/contacts/${encodeURIComponent(contact)}/methods/${encodeURIComponent(method)}/verification`,
      command,
    ),
  reception: (store: string, visit: string) =>
    apiClient.get<StoreContact[]>(`${path(store)}/visits/${encodeURIComponent(visit)}/contacts`),
  saveReception: (
    store: string,
    visit: string,
    command: { requestId: string; contactIds: string[] },
  ) =>
    apiClient.put<StoreContact[]>(
      `${path(store)}/visits/${encodeURIComponent(visit)}/contacts`,
      command,
    ),
  changes: (store: string, contact: string) =>
    apiClient.get<{ id: string; operation: string; reason: string; occurredAt: string }[]>(
      `${path(store)}/contacts/${encodeURIComponent(contact)}/changes`,
    ),
};
