import type { FeishuCallbackError, JsapiConfig } from './types';
import { createRequestId, elapsedMs, pageTraceContext, responseMeta } from '@/diagnostics/trace';

/** 飞书官方 H5 JSSDK 示例脚本版本；升级前必须重新对照官方文档并完成真机回归。 */
export const FEISHU_JSSDK_URL =
  'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js';

export const FEISHU_JSAPI_SIGN_ENDPOINT = '/api/v1/platform/feishu/jsapi-sign';

const JSAPI_LIST = [
  'requestAccess',
  'requestAuthCode',
  'getLocation',
  'getRecorderManager',
  'getFileSystemManager',
  'chooseImage',
];
const SCRIPT_LOAD_TIMEOUT_MS = 10_000;
const CONFIG_TIMEOUT_MS = 15_000;

interface H5SdkConfigOptions extends JsapiConfig {
  jsApiList: string[];
  onSuccess: (result?: unknown) => void;
  onFail: (error: FeishuCallbackError) => void;
}

interface H5Sdk {
  config: (options: H5SdkConfigOptions) => void;
}

interface SignedJsapiConfig {
  config: JsapiConfig;
  requestId: string;
}

declare global {
  interface Window {
    /** 网页应用鉴权对象；客户端 JSAPI 本身位于独立的 window.tt。 */
    h5sdk?: H5Sdk;
  }
}

let scriptLoadPromise: Promise<boolean> | null = null;
let jsbridgeReady = false;
let lastFailureDetail: string | null = null;

function recordFailure(phase: string, detail: string): void {
  lastFailureDetail = `${phase}: ${detail}`;
}

/** 最近一次鉴权失败的具体原因（阶段 + 细节），供阻断页展示，便于真机无控制台排查。 */
export function getJsbridgeFailureDetail(): string | null {
  return lastFailureDetail;
}

function errorMessage(error: FeishuCallbackError): string {
  return error.errString ?? error.errMsg ?? '未知飞书鉴权错误';
}

function loadOfficialJsSdk(): Promise<boolean> {
  if (window.h5sdk?.config) {
    console.info('[FeishuTrace] sdk-load-skipped', { reason: 'already-loaded' });
    return Promise.resolve(true);
  }
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve) => {
    const startedAt = Date.now();
    let settled = false;
    const finish = (result: boolean, reason: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      console.info('[FeishuTrace] sdk-load-finished', {
        ok: result,
        reason,
        elapsedMs: elapsedMs(startedAt),
      });
      resolve(result);
    };
    console.info('[FeishuTrace] sdk-load-start', {
      ...pageTraceContext(),
      sdkVersion: '1.5.44',
    });
    const timeoutId = setTimeout(() => {
      console.error('[FeishuJsbridge] 官方 H5 JSSDK 加载超时');
      recordFailure('sdk-load', 'timeout');
      finish(false, 'timeout');
    }, SCRIPT_LOAD_TIMEOUT_MS);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${FEISHU_JSSDK_URL}"]`,
    );
    if (existing) {
      // 已存在的脚本可能仍在加载，也可能 load 已结束但未正确注入 h5sdk。
      // 统一由事件或超时收敛，禁止永久等待。
      existing.addEventListener('load', () => finish(Boolean(window.h5sdk?.config), 'existing-load'), {
        once: true,
      });
      existing.addEventListener('error', () => {
        recordFailure('sdk-load', 'existing-script-error');
        finish(false, 'existing-error');
      }, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = FEISHU_JSSDK_URL;
    script.async = true;
    script.onload = () => {
      const ok = Boolean(window.h5sdk?.config);
      if (!ok) recordFailure('sdk-load', 'script-loaded-but-h5sdk-missing');
      finish(ok, 'script-load');
    };
    script.onerror = () => {
      recordFailure('sdk-load', 'script-error');
      finish(false, 'script-error');
    };
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function isJsapiConfig(value: unknown): value is JsapiConfig {
  if (!value || typeof value !== 'object') return false;
  const config = value as Partial<JsapiConfig>;
  return (
    typeof config.appId === 'string' &&
    config.appId.length > 0 &&
    (typeof config.timestamp === 'string' || typeof config.timestamp === 'number') &&
    typeof config.nonceStr === 'string' &&
    config.nonceStr.length > 0 &&
    typeof config.signature === 'string' &&
    config.signature.length > 0
  );
}

async function fetchSignature(): Promise<SignedJsapiConfig> {
  const requestId = createRequestId('jsapi-sign');
  const startedAt = Date.now();
  const signedUrl = window.location.href.split('#')[0];
  console.info('[FeishuTrace] signature-request-start', {
    requestId,
    ...pageTraceContext(),
    signedUrl,
  });

  try {
    const response = await fetch(FEISHU_JSAPI_SIGN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-Id': requestId,
      },
      body: JSON.stringify({ url: signedUrl }),
    });
    const rawBody = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      body = undefined;
    }
    const meta = responseMeta(body);
    const responseRequestId = meta.requestId ?? requestId;
    console.info('[FeishuTrace] signature-request-finished', {
      requestId: responseRequestId,
      clientRequestId: requestId,
      status: response.status,
      ok: response.ok,
      code: meta.code,
      elapsedMs: elapsedMs(startedAt),
    });

    if (!response.ok) {
      throw new Error(`飞书 JSSDK 签名端点失败: HTTP ${response.status} requestId=${responseRequestId}`);
    }

    const data =
      body && typeof body === 'object' && 'data' in body
        ? (body as { data?: unknown }).data
        : undefined;
    if (!isJsapiConfig(data)) {
      throw new Error(`飞书 JSSDK 签名响应缺少有效字段 requestId=${responseRequestId}`);
    }
    return { config: data, requestId: responseRequestId };
  } catch (error) {
    recordFailure('signature-request', error instanceof Error ? error.message : '网络请求异常');
    console.error('[FeishuTrace] signature-request-failed', {
      requestId,
      elapsedMs: elapsedMs(startedAt),
      message: error instanceof Error ? error.message : '网络请求异常',
    });
    throw error;
  }
}

/**
 * 加载官方 JSSDK，并以 window.h5sdk.config 完成网页应用 JSAPI 鉴权。
 * 免登 API 与网页 JSAPI 鉴权是不同协议边界；本工作台仍将鉴权作为真实环境启动门禁，
 * 因为登录后的定位与录音依赖该鉴权。任何失败都返回 false，由 bootstrap fail closed。
 */
export async function initFeishuJsbridge(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  const traceId = createRequestId('jsbridge');
  const startedAt = Date.now();
  console.info('[FeishuTrace] jsbridge-init-start', { traceId, ...pageTraceContext() });

  try {
    const loaded = await loadOfficialJsSdk();
    if (!loaded || !window.h5sdk?.config) {
      if (!lastFailureDetail) recordFailure('sdk-load', 'h5sdk.config-unavailable');
      console.error('[FeishuJsbridge] 官方 H5 JSSDK 加载失败或 window.h5sdk.config 不存在');
      console.error('[FeishuTrace] jsbridge-init-blocked', {
        traceId,
        phase: 'sdk-load',
        elapsedMs: elapsedMs(startedAt),
      });
      return false;
    }

    const signed = await fetchSignature();
    console.info('[FeishuTrace] jsapi-config-start', {
      traceId,
      requestId: signed.requestId,
      appId: signed.config.appId,
      timestamp: signed.config.timestamp,
      nonceStr: signed.config.nonceStr,
      url: window.location.href.split('#')[0],
    });
    const ready = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        jsbridgeReady = result;
        resolve(result);
      };
      const timeoutId = setTimeout(() => {
        console.error('[FeishuJsbridge] window.h5sdk.config 回调超时');
        recordFailure('jsapi-config', 'callback-timeout');
        finish(false);
      }, CONFIG_TIMEOUT_MS);

      window.h5sdk!.config({
        appId: signed.config.appId,
        timestamp: signed.config.timestamp,
        nonceStr: signed.config.nonceStr,
        signature: signed.config.signature,
        jsApiList: [...JSAPI_LIST],
        onSuccess: () => {
          if (!window.tt) {
            console.error('[FeishuJsbridge] 鉴权成功但 window.tt 未注入，按失败阻断');
            recordFailure('jsapi-config', 'window.tt-missing-after-success');
            console.error('[FeishuTrace] jsapi-config-failed', {
              traceId,
              requestId: signed.requestId,
              reason: 'window.tt-missing-after-success',
            });
            finish(false);
            return;
          }
          lastFailureDetail = null;
          console.info('[FeishuTrace] jsapi-config-succeeded', {
            traceId,
            requestId: signed.requestId,
            elapsedMs: elapsedMs(startedAt),
          });
          finish(true);
        },
        onFail: (error) => {
          console.error(
            '[FeishuJsbridge] 网页应用鉴权失败:',
            error.errno,
            errorMessage(error),
          );
          recordFailure('jsapi-config', `errno=${error.errno} ${errorMessage(error)}`);
          console.error('[FeishuTrace] jsapi-config-failed', {
            traceId,
            requestId: signed.requestId,
            errno: error.errno,
            message: errorMessage(error),
            elapsedMs: elapsedMs(startedAt),
          });
          finish(false);
        },
      });
    });
    console.info('[FeishuTrace] jsbridge-init-finished', {
      traceId,
      requestId: signed.requestId,
      ok: ready,
      elapsedMs: elapsedMs(startedAt),
    });
    return ready;
  } catch (error) {
    console.error('[FeishuJsbridge] 初始化失败:', error);
    if (!lastFailureDetail) {
      recordFailure('jsbridge-init', error instanceof Error ? error.message : '初始化异常');
    }
    console.error('[FeishuTrace] jsbridge-init-failed', {
      traceId,
      elapsedMs: elapsedMs(startedAt),
      message: error instanceof Error ? error.message : '初始化异常',
    });
    jsbridgeReady = false;
    return false;
  }
}

export function isJsbridgeReady(): boolean {
  return jsbridgeReady;
}
