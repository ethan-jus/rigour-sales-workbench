import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getWorkbenchCapabilities } from '@/adapters/workbench';
import { loginWithMobileOidc } from '@/auth/mobile-oidc';
import { clearLegacyAuthToken, setAuthToken } from '@/auth/token-storage';
import { iamApi, type CurrentUserView } from '@/api/core/iam';
import { createRequestId, elapsedMs } from '@/diagnostics/trace';
import {
  SALES_FEATURES,
  hasPermission as hasCatalogPermission,
  inferGrantedFeatures,
  type AppFeature,
} from '@/features/catalog';

const isMockMode = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true';
const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID || 'demo';

export const useAuthStore = defineStore('auth', () => {
  const currentUser = ref<CurrentUserView | null>(null);
  const userId = ref<string | null>(null);
  const userName = ref('');
  const avatar = ref('');
  const tenantId = ref('');
  const isLoggedIn = computed(() => !!userId.value);
  const loginLoading = ref(false);
  const loginError = ref<string | null>(null);
  const roles = ref<string[]>([]);
  const permissions = ref<string[]>([]);
  const grantedFeatures = computed(() => inferGrantedFeatures(
    permissions.value,
    isMockMode,
  ));
  const isSalesUser = computed(() => Array.from(grantedFeatures.value).some((feature) => (
    SALES_FEATURES.has(feature)
  )));


  async function login() {
    const traceId = createRequestId('auth');
    const startedAt = Date.now();
    loginLoading.value = true;
    loginError.value = null;
    console.info('[AuthTrace] login-start', { traceId, mockMode: isMockMode });

    try {
      if (isMockMode) {
        userId.value = 'mock-user-001';
        userName.value = '张三（Mock）';
        avatar.value = '';
        tenantId.value = defaultTenantId;
        roles.value = ['MOCK_SALES'];
        permissions.value = [
          'sales:context:read',
          'sales:visit-target:read',
          'sales:visit-plan:own:read',
          'sales:work-day:write',
          'sales:location:write',
          'sales:track:own:read',
          'sales:visit:own:read',
          'sales:visit:own:write',
          'sales:recording:own:read',
          'sales:recording:own:write',
          'sales:evidence:own:read',
          'sales:evidence:own:write',
          'sales:poi:read',
        ];

        localStorage.setItem('auth_user_id', 'mock-user-001');
        localStorage.setItem('auth_tenant_id', defaultTenantId);
      } else {
        // App 模式：系统浏览器执行 OIDC Authorization Code + PKCE。
        const session = await loginWithMobileOidc();

        userId.value = session.user.userId;
        userName.value = session.user.name;
        avatar.value = session.user.avatar || '';
        tenantId.value = session.user.tenantId || defaultTenantId;

        await setAuthToken(session.token);
        localStorage.setItem('auth_user_id', session.user.userId);
        localStorage.setItem('auth_tenant_id', session.user.tenantId || defaultTenantId);
        localStorage.removeItem('auth_feishu_open_id');
        await refreshCurrentUser();
        console.info('[AuthTrace] oidc-login-succeeded', {
          traceId,
          hasToken: Boolean(session.token),
          hasUserId: Boolean(session.user.userId),
          elapsedMs: elapsedMs(startedAt),
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '登录失败';
      loginError.value = msg;
      console.error('[AuthTrace] login-failed', {
        traceId,
        elapsedMs: elapsedMs(startedAt),
        message: msg,
      });
      throw err;
    } finally {
      loginLoading.value = false;
    }
  }

  async function refreshCurrentUser(): Promise<CurrentUserView | null> {
    const loaded = await iamApi.currentUser();
    currentUser.value = loaded;
    userId.value = loaded.id;
    userName.value = loaded.displayName || loaded.username || userName.value;
    tenantId.value = loaded.tenantId || tenantId.value || defaultTenantId;
    roles.value = loaded.roles;
    permissions.value = loaded.permissions;
    localStorage.setItem('auth_user_id', loaded.id);
    localStorage.setItem('auth_tenant_id', loaded.tenantId || defaultTenantId);

    return loaded;
  }

  function hasPermission(permission: string): boolean {
    return hasCatalogPermission(permissions.value, permission);
  }

  function hasFeature(feature: AppFeature): boolean {
    return grantedFeatures.value.has(feature);
  }

  function logout() {
    getWorkbenchCapabilities().destroy();
    currentUser.value = null;
    userId.value = null;
    userName.value = '';
    avatar.value = '';
    tenantId.value = '';
    roles.value = [];
    permissions.value = [];
    clearLegacyAuthToken();
    localStorage.removeItem('auth_user_id');
    localStorage.removeItem('auth_tenant_id');
    localStorage.removeItem('auth_feishu_open_id');
  }

  return {
    currentUser,
    userId,
    userName,
    avatar,
    tenantId,
    roles,
    permissions,
    grantedFeatures,
    isSalesUser,
    isLoggedIn,
    loginLoading,
    loginError,
    login,
    refreshCurrentUser,
    hasPermission,
    hasFeature,
    logout,
  };
});
