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
  salesStore: {
    loadWorkDay: vi.fn(),
    ensureLocationTracking: vi.fn(),
  },
  detectRuntimeContainer: vi.fn(),
  initFeishuJsbridge: vi.fn(),
  getJsbridgeFailureDetail: vi.fn(),
}));

vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.authStore }));
vi.mock('@/stores/sales', () => ({ useSalesStore: () => mocks.salesStore }));
vi.mock('@/adapters', () => ({ detectRuntimeContainer: mocks.detectRuntimeContainer }));
vi.mock('@/adapters/feishu/jsbridge', () => ({
  initFeishuJsbridge: mocks.initFeishuJsbridge,
  getJsbridgeFailureDetail: mocks.getJsbridgeFailureDetail,
}));

import { bootstrap } from '@/bootstrap';

describe('bootstrap 飞书鉴权门禁', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getJsbridgeFailureDetail.mockReturnValue(null);
    mocks.detectRuntimeContainer.mockReturnValue({
      container: 'feishu',
      clientVersion: '7.50.0',
      jsapiAvailable: true,
      mockMode: false,
    });
    mocks.salesStore.loadWorkDay.mockResolvedValue(null);
    mocks.salesStore.ensureLocationTracking.mockResolvedValue(true);
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

  it('鉴权失败时把具体失败原因拼进阻断信息，便于真机排查', async () => {
    mocks.initFeishuJsbridge.mockResolvedValue(false);
    mocks.getJsbridgeFailureDetail.mockReturnValue('jsapi-config: errno=1000123 签名无效');

    await bootstrap();

    expect(mocks.appStore.setBootstrapError).toHaveBeenCalledWith(
      expect.stringContaining('jsapi-config: errno=1000123 签名无效'),
    );
  });

  it('真实飞书鉴权成功后才执行免登', async () => {
    mocks.initFeishuJsbridge.mockResolvedValue(true);
    mocks.authStore.login.mockResolvedValue(undefined);

    await bootstrap();

    expect(mocks.initFeishuJsbridge).toHaveBeenCalledBefore(mocks.authStore.login);
    expect(mocks.authStore.login).toHaveBeenCalledTimes(1);
    expect(mocks.appStore.setBootstrapReady).toHaveBeenCalledTimes(1);
  });

  it('免登后恢复进行中工作日的应用级定位会话', async () => {
    mocks.initFeishuJsbridge.mockResolvedValue(true);
    mocks.authStore.login.mockResolvedValue(undefined);
    mocks.salesStore.loadWorkDay.mockResolvedValue({ id: 'wd-active', status: 'ACTIVE' });

    await bootstrap();
    await vi.waitFor(() => {
      expect(mocks.salesStore.ensureLocationTracking).toHaveBeenCalledWith('wd-active');
    });
  });
});
