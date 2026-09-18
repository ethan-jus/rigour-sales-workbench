import { apiClient } from './client';

export interface CurrentUserView {
  id: string;
  tenantId: string;
  tenantName: string;
  principalScope: string;
  username: string;
  displayName: string;
  roles: string[];
  permissions: string[];
}

function unwrap<T>(response: unknown): T {
  if (response && typeof response === 'object' && 'code' in response && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

function normalizeCurrentUser(value: CurrentUserView): CurrentUserView {
  return {
    ...value,
    roles: Array.isArray(value.roles) ? value.roles : [],
    permissions: Array.isArray(value.permissions) ? value.permissions : [],
  };
}

export const iamApi = {
  async currentUser(): Promise<CurrentUserView> {
    const response = await apiClient.get<CurrentUserView>('/me');
    return normalizeCurrentUser(unwrap<CurrentUserView>(response));
  },

};
