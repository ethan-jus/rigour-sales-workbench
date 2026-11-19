import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useSalesStore } from '@/stores/sales';
import { detectRuntimeContainer } from '@/adapters';
import { getWorkbenchCapabilities } from '@/adapters/workbench';
import { createRequestId, elapsedMs, pageTraceContext } from '@/diagnostics/trace';
import { localDate } from '@/utils/datetime';

export async function bootstrap(): Promise<void> {
  const traceId = createRequestId('bootstrap');
  const startedAt = Date.now();
  const appStore = useAppStore();
  const authStore = useAuthStore();

  const env = detectRuntimeContainer();
  appStore.env = env;

  console.info('[BootstrapTrace] bootstrap-start', {
    traceId,
    ...pageTraceContext(),
    container: env.container,
    mockMode: env.mockMode,
  });

  try {
    console.info('[BootstrapTrace] auth-start', { traceId, elapsedMs: elapsedMs(startedAt) });
    await authStore.login();
    await ensureMandatoryLocation(traceId);
    appStore.setBootstrapReady();
    void restoreActiveLocationTracking(traceId);
    console.info('[BootstrapTrace] bootstrap-ready', {
      traceId,
      elapsedMs: elapsedMs(startedAt),
      hasUserId: Boolean(authStore.userId),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bootstrap 失败';
    appStore.setBootstrapError(msg);
    console.error('[BootstrapTrace] auth-failed', {
      traceId,
      elapsedMs: elapsedMs(startedAt),
      message: msg,
    });
    // Mock 模式下登录失败不阻止应用启动（开发容错）
    if (env.mockMode) {
      appStore.setBootstrapReady();
    }
  }
}

/** App 原生环境强制拿到一次定位；拒绝授权或系统定位关闭时不进入业务。 */
async function ensureMandatoryLocation(traceId: string): Promise<void> {
  const capabilities = getWorkbenchCapabilities();
  const runtime = capabilities.getRuntimeLabel();
  const configured = import.meta.env.VITE_REQUIRE_LOCATION_ON_BOOT;
  const required = configured === 'true' || (configured !== 'false' && runtime === 'native-app');
  if (!required) return;
  try {
    const point = await capabilities.getCurrentLocation();
    const salesStore = useSalesStore();
    salesStore.lastCurrentLocation = point;
    console.info('[BootstrapTrace] mandatory-location-ready', {
      traceId,
      runtime,
      accuracy: point.accuracy,
      timestamp: point.timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '定位权限不可用';
    console.warn('[BootstrapTrace] mandatory-location-blocked', { traceId, runtime, message });
    throw new Error(`${message}。公司要求开启定位后才能使用瑞盖销售工作台。`, {
      cause: error,
    });
  }
}

/** 应用刷新后恢复进行中工作日的定位会话；失败只形成中断，不阻断工作台启动。 */
async function restoreActiveLocationTracking(traceId: string): Promise<void> {
  const salesStore = useSalesStore();
  const workDay = await salesStore.loadWorkDay(localDate());
  if (workDay?.status !== 'ACTIVE') return;
  const restored = await salesStore.ensureLocationTracking(workDay.id);
  console.info('[BootstrapTrace] location-tracking-restored', {
    traceId,
    workDayId: workDay.id,
    restored,
  });
}
