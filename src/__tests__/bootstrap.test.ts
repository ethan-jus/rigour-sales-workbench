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
    lastCurrentLocation: null as null | {
      latitude: number;
      longitude: number;
      accuracy: number;
      timestamp: number;
    },
    loadWorkDay: vi.fn(),
    ensureLocationTracking: vi.fn(),
  },
  workbenchCapabilities: {
    getRuntimeLabel: vi.fn(),
    getCurrentLocation: vi.fn(),
  },
  detectRuntimeContainer: vi.fn(),
}));

vi.mock('@/stores/app', () => ({ useAppStore: () => mocks.appStore }));
vi.mock('@/stores/auth', () => ({ useAuthStore: () => mocks.authStore }));
vi.mock('@/stores/sales', () => ({ useSalesStore: () => mocks.salesStore }));
vi.mock('@/adapters', () => ({ detectRuntimeContainer: mocks.detectRuntimeContainer }));
vi.mock('@/adapters/workbench', () => ({ getWorkbenchCapabilities: () => mocks.workbenchCapabilities }));
import { bootstrap } from '@/bootstrap';

describe('工作台启动与平台登录', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.salesStore.lastCurrentLocation = null;
    mocks.workbenchCapabilities.getRuntimeLabel.mockReturnValue('unsupported');
    mocks.workbenchCapabilities.getCurrentLocation.mockResolvedValue({
      latitude: 31.2304,
      longitude: 121.4737,
      accuracy: 20,
      timestamp: 1_800_000_000_000,
    });
    mocks.detectRuntimeContainer.mockReturnValue({
      container: 'browser',
      mockMode: false,
    });
    mocks.salesStore.loadWorkDay.mockResolvedValue(null);
    mocks.salesStore.ensureLocationTracking.mockResolvedValue(true);
  });

  it('浏览器启动使用平台登录', async () => {
    mocks.authStore.login.mockResolvedValue(undefined);
    await bootstrap();
    expect(mocks.authStore.login).toHaveBeenCalledTimes(1);
    expect(mocks.appStore.setBootstrapReady).toHaveBeenCalledTimes(1);
  });

  it('平台登录失败时保留原因并阻断业务', async () => {
    mocks.authStore.login.mockRejectedValue(new Error('会话已过期'));
    await bootstrap();
    expect(mocks.appStore.setBootstrapError).toHaveBeenCalledWith('会话已过期');
    expect(mocks.appStore.setBootstrapReady).not.toHaveBeenCalled();
  });

  it('平台登录后恢复进行中工作日的应用级定位会话', async () => {
    mocks.authStore.login.mockResolvedValue(undefined);
    mocks.salesStore.loadWorkDay.mockResolvedValue({ id: 'wd-active', status: 'ACTIVE' });

    await bootstrap();
    await vi.waitFor(() => {
      expect(mocks.salesStore.ensureLocationTracking).toHaveBeenCalledWith('wd-active');
    });
  });

  it('App OIDC 启动时强制拿到一次定位并缓存首个点', async () => {
    vi.stubEnv('VITE_REQUIRE_LOCATION_ON_BOOT', 'true');
    mocks.detectRuntimeContainer.mockReturnValue({
      container: 'native-app',
      mockMode: false,
    });
    mocks.workbenchCapabilities.getRuntimeLabel.mockReturnValue('native-app');
    mocks.authStore.login.mockResolvedValue(undefined);

    await bootstrap();

    expect(mocks.workbenchCapabilities.getCurrentLocation).toHaveBeenCalledTimes(1);
    expect(mocks.salesStore.lastCurrentLocation).toEqual(expect.objectContaining({
      latitude: 31.2304,
      longitude: 121.4737,
    }));
    expect(mocks.appStore.setBootstrapReady).toHaveBeenCalledTimes(1);
  });

  it('App OIDC 启动定位失败时阻断进入业务', async () => {
    vi.stubEnv('VITE_REQUIRE_LOCATION_ON_BOOT', 'true');
    mocks.detectRuntimeContainer.mockReturnValue({
      container: 'native-app',
      mockMode: false,
    });
    mocks.workbenchCapabilities.getRuntimeLabel.mockReturnValue('native-app');
    mocks.workbenchCapabilities.getCurrentLocation.mockRejectedValue(new Error('系统定位已关闭'));
    mocks.authStore.login.mockResolvedValue(undefined);

    await bootstrap();

    expect(mocks.appStore.setBootstrapError).toHaveBeenCalledWith(
      expect.stringContaining('公司要求开启定位后才能使用瑞盖销售工作台'),
    );
    expect(mocks.appStore.setBootstrapReady).not.toHaveBeenCalled();
    expect(mocks.salesStore.ensureLocationTracking).not.toHaveBeenCalled();
  });
});
