import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appStore: {
    env: {} as Record<string, unknown>,
    setBootstrapError: vi.fn(),
    setBootstrapReady: vi.fn(),
  },
  authStore: {
    login: vi.fn(),
    userId: null as string | null,
  },
  detectRuntimeContainer: vi.fn(),
  initFeishuJsbridge: vi.fn(),
}));

vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.authStore }));
vi.mock('@/adapters', () => ({ detectRuntimeContainer: mocks.detectRuntimeContainer }));
vi.mock('@/adapters/feishu/jsbridge', () => ({
  initFeishuJsbridge: mocks.initFeishuJsbridge,
}));

import { bootstrap } from '@/bootstrap';

describe('bootstrap 飞书鉴权门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectRuntimeContainer.mockReturnValue({
      container: 'feishu',
      clientVersion: '7.50.0',
      jsapiAvailable: true,
      mockMode: false,
    });
  });

  it('真实飞书鉴权失败时 setBootstrapError 后 return，不继续登录', async () => {
    mocks.initFeishuJsbridge.mockResolvedValue(false);

    await bootstrap();

    expect(mocks.appStore.setBootstrapError).toHaveBeenCalledWith(
      expect.stringContaining('鉴权失败'),
    );
    expect(mocks.authStore.login).not.toHaveBeenCalled();
    expect(mocks.appStore.setBootstrapReady).not.toHaveBeenCalled();
  });

  it('真实飞书鉴权成功后才执行免登', async () => {
    mocks.initFeishuJsbridge.mockResolvedValue(true);
    mocks.authStore.login.mockResolvedValue(undefined);

    await bootstrap();

    expect(mocks.initFeishuJsbridge).toHaveBeenCalledBefore(mocks.authStore.login);
    expect(mocks.authStore.login).toHaveBeenCalledTimes(1);
    expect(mocks.appStore.setBootstrapReady).toHaveBeenCalledTimes(1);
  });
});
