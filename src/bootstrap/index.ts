import { useAppStore } from '@/stores/app';
import { useAuthStore } from '@/stores/auth';
import { useSalesStore } from '@/stores/sales';
import { detectRuntimeContainer } from '@/adapters';
import { getJsbridgeFailureDetail, initFeishuJsbridge } from '@/adapters/feishu/jsbridge';
import { createRequestId, elapsedMs, pageTraceContext } from '@/diagnostics/trace';
import { localDate } from '@/utils/datetime';

// ============================================================================
// 应用启动引导
//
// 执行顺序：
// 1. 检测运行容器（飞书/Lark/浏览器）
// 2. 若在飞书容器中，注入 JSSDK 并完成签名（fail closed）
// 3. 执行免登获取授权码，交换平台 token
// 4. 记录启动状态供页面层读取
//
// 兼容说明：
// - Mock 模式下跳过 JSSDK 注入和签名，直接使用 mockAdapter
// - 飞书容器内 JSSDK 加载或鉴权失败时 fail closed：写入启动错误并 return，不继续免登
// - production 非飞书环境由 unsupportedAdapter 阻断，用户看到错误页
// ============================================================================
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
    clientVersion: env.clientVersion,
    jsapiAvailable: env.jsapiAvailable,
    mockMode: env.mockMode,
  });

  // 飞书容器内：注入 JSSDK 并签名
  if (!env.mockMode && env.container !== 'unknown') {
    console.info('[BootstrapTrace] jsbridge-start', { traceId });
    const jssdkReady = await initFeishuJsbridge();
    if (!jssdkReady) {
      const detail = getJsbridgeFailureDetail();
      const message =
        '飞书能力鉴权失败，应用已阻断。请检查 JSSDK 加载和后端签名配置。' +
        (detail ? `（${detail}）` : '');
      appStore.setBootstrapError(message);
      console.error('[BootstrapTrace] jsbridge-blocked', {
        traceId,
        elapsedMs: elapsedMs(startedAt),
        message,
      });
      return;
    }
    console.info('[BootstrapTrace] jsbridge-ready', { traceId, elapsedMs: elapsedMs(startedAt) });
    // 鉴权完成后重新读取 window.tt 顶层 API 可用性。
    const updatedEnv = detectRuntimeContainer();
    appStore.env = { ...updatedEnv, mockMode: false };
  }

  // 非 mock 且非飞书环境：警告
  if (!env.mockMode && env.container === 'unknown') {
    console.warn('[Bootstrap] 非飞书环境且未开启 mock，将使用 unsupportedAdapter 阻断');
  }

  // 飞书容器内检查 JSAPI 可用性
  if (env.container !== 'unknown' && !env.jsapiAvailable) {
    console.warn('[Bootstrap] 在飞书/Lark 中但 window.tt 不可用，请检查 JSSDK 注入');
  }

  try {
    console.info('[BootstrapTrace] auth-start', { traceId, elapsedMs: elapsedMs(startedAt) });
    await authStore.login();
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
