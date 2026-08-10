import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { getFeishuAdapter } from '@/adapters';
import { createRequestId, elapsedMs, responseMeta } from '@/diagnostics/trace';

// ============================================================================
// 用户认证状态
//
// 职责：
// - 通过飞书 Adapter 获取一次性授权码 code
// - Mock 模式：跳过后端交换，直接使用固定 mock 身份
// - 真实模式：POST code 给后端 /auth/feishu/exchange，换取 platform token 和用户信息
// - 管理登录中/登录成功/登录失败状态
//
// 安全边界：
// - App Secret 永远不进前端；code→token 交换在后端完成
// - Token 写入 localStorage 供 apiClient 读取；登出时清除
// - 登录失败不自动重试，由页面层决定是否提示用户重试
//
// 风险：
// - 真实环境中 code→token 交换依赖 Platform 后端 /auth/feishu/exchange 就绪
// - 后端不可达时登录失败，authStore.loginError 记录详细错误
// ============================================================================

const AUTH_EXCHANGE_ENDPOINT = '/api/v1/auth/feishu/exchange';

const isMockMode = import.meta.env.VITE_FEISHU_MOCK === 'true';
const defaultTenantId = import.meta.env.VITE_DEFAULT_TENANT_ID || 'demo';

/** 后端授权码交换返回的 user 对象结构 */
interface ExchangeUser {
  userId: string;
  name: string;
  avatar?: string;
  tenantId?: string;
}

export const useAuthStore = defineStore('auth', () => {
  const userId = ref<string | null>(null);
  const userName = ref('');
  const avatar = ref('');
  const tenantId = ref('');
  const isLoggedIn = computed(() => !!userId.value);
  const loginLoading = ref(false);
  const loginError = ref<string | null>(null);

  /** 飞书用户 open_id，用于后端映射 platform_user_id ↔ feishu_user_id */
  const feishuOpenId = ref<string | null>(null);

  async function login() {
    const traceId = createRequestId('auth');
    const startedAt = Date.now();
    loginLoading.value = true;
    loginError.value = null;
    console.info('[AuthTrace] login-start', { traceId, mockMode: isMockMode });

    try {
      const adapter = getFeishuAdapter();

      if (isMockMode) {
        // Mock 模式：返回固定 mock 身份，跳过后端交换
        const code = await adapter.requestAuthCode();
        console.info('[AuthTrace] mock-auth-code-received', {
          traceId,
          hasCode: Boolean(code),
          elapsedMs: elapsedMs(startedAt),
        });

        userId.value = 'mock-user-001';
        userName.value = '张三（Mock）';
        avatar.value = '';
        tenantId.value = defaultTenantId;
        feishuOpenId.value = 'ou_mock_001';

        localStorage.setItem('auth_user_id', 'mock-user-001');
        localStorage.setItem('auth_tenant_id', defaultTenantId);
        localStorage.setItem('auth_feishu_open_id', 'ou_mock_001');
      } else {
        // 真实模式：获取授权码 → POST 给后端交换 token
        const code = await adapter.requestAuthCode();
        console.info('[AuthTrace] feishu-auth-code-received', {
          traceId,
          hasCode: Boolean(code),
          elapsedMs: elapsedMs(startedAt),
        });

        const response = await fetch(AUTH_EXCHANGE_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': defaultTenantId,
            'X-Request-Id': traceId,
          },
          body: JSON.stringify({ code }),
        });

        const rawBody = await response.text();
        let body: unknown;
        try {
          body = JSON.parse(rawBody);
        } catch {
          body = undefined;
        }
        const meta = responseMeta(body);
        const responseRequestId = meta.requestId ?? traceId;
        console.info('[AuthTrace] exchange-finished', {
          traceId,
          requestId: responseRequestId,
          status: response.status,
          ok: response.ok,
          code: meta.code,
          elapsedMs: elapsedMs(startedAt),
        });

        if (!response.ok) {
          throw new Error(`授权码交换失败: HTTP ${response.status} requestId=${responseRequestId}`);
        }

        const rawData =
          body && typeof body === 'object' && 'data' in body
            ? (body as { data?: unknown }).data
            : undefined;
        const data =
          rawData && typeof rawData === 'object'
            ? (rawData as { token?: unknown; user?: ExchangeUser; feishuOpenId?: unknown })
            : undefined;
        if (!data || typeof data.token !== 'string' || !data.user) {
          throw new Error(`后端返回数据不完整 requestId=${responseRequestId}`);
        }

        const token: string = data.token;
        const user: ExchangeUser = data.user;
        const feishuId: string | null =
          typeof data.feishuOpenId === 'string' ? data.feishuOpenId : null;

        userId.value = user.userId;
        userName.value = user.name;
        avatar.value = user.avatar || '';
        tenantId.value = user.tenantId || defaultTenantId;
        feishuOpenId.value = feishuId;

        localStorage.setItem('auth_token', token);
        localStorage.setItem('auth_user_id', user.userId);
        localStorage.setItem('auth_tenant_id', user.tenantId || defaultTenantId);
        if (feishuId) {
          localStorage.setItem('auth_feishu_open_id', feishuId);
        }
        console.info('[AuthTrace] login-succeeded', {
          traceId,
          requestId: responseRequestId,
          hasToken: Boolean(token),
          hasUserId: Boolean(user.userId),
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

  function logout() {
    getFeishuAdapter().destroy();
    userId.value = null;
    userName.value = '';
    avatar.value = '';
    tenantId.value = '';
    feishuOpenId.value = null;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user_id');
    localStorage.removeItem('auth_tenant_id');
    localStorage.removeItem('auth_feishu_open_id');
  }

  return {
    userId,
    userName,
    avatar,
    tenantId,
    feishuOpenId,
    isLoggedIn,
    loginLoading,
    loginError,
    login,
    logout,
  };
});
