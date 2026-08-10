import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAuthStore } from '@/stores/auth';
import { useAppStore } from '@/stores/app';

// ============================================================================
// Stores 测试
// ============================================================================

describe('Stores', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubEnv('VITE_FEISHU_MOCK', 'true');
    vi.stubEnv('VITE_DEFAULT_TENANT_ID', 'demo');
    localStorage.clear();
  });

  describe('authStore', () => {
    it('初始状态为未登录', () => {
      const store = useAuthStore();
      expect(store.userId).toBeNull();
      expect(store.userName).toBe('');
      expect(store.isLoggedIn).toBe(false);
      expect(store.feishuOpenId).toBeNull();
    });

    it('logout 清除所有状态', () => {
      const store = useAuthStore();
      store.logout();
      expect(store.userId).toBeNull();
      expect(store.isLoggedIn).toBe(false);
      expect(store.feishuOpenId).toBeNull();
    });

    it('login 在 mock 模式下成功并设置 mock 身份', async () => {
      const store = useAuthStore();
      await store.login();
      expect(store.isLoggedIn).toBe(true);
      expect(store.userId).toBe('mock-user-001');
      expect(store.feishuOpenId).toBe('ou_mock_001');
      expect(store.tenantId).toBe('demo');

      // 验证 localStorage 写入
      expect(localStorage.getItem('auth_user_id')).toBe('mock-user-001');
      expect(localStorage.getItem('auth_tenant_id')).toBe('demo');
      expect(localStorage.getItem('auth_feishu_open_id')).toBe('ou_mock_001');
    });

    it('login 失败时 isLoggedIn 仍为 false', async () => {
      // 注入一个会失败的自定义 adapter，覆盖单例缓存
      vi.stubEnv('VITE_FEISHU_MOCK', 'false');
      vi.stubEnv('VITE_FEISHU_APP_ID', 'cli_test');
      const { setFeishuAdapter } = await import('@/adapters');
      setFeishuAdapter({
        detectContainer: () => 'unknown',
        getClientVersion: () => null,
        isJsapiAvailable: () => false,
        requestAuthCode: () => Promise.reject(new Error('模拟授权码获取失败')),
        getLocationStatus: () => 'unsupported',
        getCurrentLocation: async () => ({ latitude: 0, longitude: 0, accuracy: 0, timestamp: Date.now() }),
        startLocation: async () => {},
        stopLocation: async () => {},
        getAudioStatus: () => 'unsupported',
        startRecording: () => {},
        stopRecording: async () => null,
        uploadRecording: async () => {},
        discardRecording: async () => {},
        destroy: () => {},
      });
      const store = useAuthStore();
      try {
        await store.login();
      } catch {
        // 预期失败
      }
      expect(store.isLoggedIn).toBe(false);
    });
  });

  describe('appStore', () => {
    it('初始状态有环境信息', () => {
      const store = useAppStore();
      expect(store.env).toBeDefined();
      expect(store.isMockMode).toBe(true);
      expect(store.bootstrapReady).toBe(false);
    });

    it('setBootstrapReady 切换状态', () => {
      const store = useAppStore();
      store.setBootstrapReady();
      expect(store.bootstrapReady).toBe(true);
    });

    it('setBootstrapError 记录错误且 containerLabel 正确', () => {
      const store = useAppStore();
      store.setBootstrapError('启动失败');
      expect(store.bootstrapError).toBe('启动失败');
      expect(store.containerLabel).toBe('Mock (浏览器)');
    });
  });
});
