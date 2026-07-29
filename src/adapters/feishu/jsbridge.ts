import type { FeishuCallbackError, JsapiConfig } from './types';

/** 飞书官方 H5 JSSDK 示例脚本版本；升级前必须重新对照官方文档并完成真机回归。 */
export const FEISHU_JSSDK_URL =
  'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js';

export const FEISHU_JSAPI_SIGN_ENDPOINT = '/api/v1/platform/feishu/jsapi-sign';

const JSAPI_LIST = ['requestAccess', 'requestAuthCode', 'getLocation', 'getRecorderManager'];
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

declare global {
  interface Window {
    /** 网页应用鉴权对象；客户端 JSAPI 本身位于独立的 window.tt。 */
    h5sdk?: H5Sdk;
  }
}

let scriptLoadPromise: Promise<boolean> | null = null;
let jsbridgeReady = false;

function errorMessage(error: FeishuCallbackError): string {
  return error.errString ?? error.errMsg ?? '未知飞书鉴权错误';
}

function loadOfficialJsSdk(): Promise<boolean> {
  if (window.h5sdk?.config) return Promise.resolve(true);
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise((resolve) => {
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      resolve(result);
    };
    const timeoutId = setTimeout(() => {
      console.error('[FeishuJsbridge] 官方 H5 JSSDK 加载超时');
      finish(false);
    }, SCRIPT_LOAD_TIMEOUT_MS);

    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${FEISHU_JSSDK_URL}"]`,
    );
    if (existing) {
      // 已存在的脚本可能仍在加载，也可能 load 已结束但未正确注入 h5sdk。
      // 统一由事件或超时收敛，禁止永久等待。
      existing.addEventListener('load', () => finish(Boolean(window.h5sdk?.config)), {
        once: true,
      });
      existing.addEventListener('error', () => finish(false), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = FEISHU_JSSDK_URL;
    script.async = true;
    script.onload = () => finish(Boolean(window.h5sdk?.config));
    script.onerror = () => finish(false);
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

async function fetchSignature(): Promise<JsapiConfig> {
  const response = await fetch(FEISHU_JSAPI_SIGN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: window.location.href.split('#')[0] }),
  });

  if (!response.ok) {
    throw new Error(`飞书 JSSDK 签名端点失败: HTTP ${response.status}`);
  }

  const body: unknown = await response.json();
  const data =
    body && typeof body === 'object' && 'data' in body
      ? (body as { data?: unknown }).data
      : undefined;
  if (!isJsapiConfig(data)) {
    throw new Error('飞书 JSSDK 签名响应缺少有效的 data.appId/timestamp/nonceStr/signature');
  }
  return data;
}

/**
 * 加载官方 JSSDK，并以 window.h5sdk.config 完成网页应用 JSAPI 鉴权。
 * 免登 API 与网页 JSAPI 鉴权是不同协议边界；本工作台仍将鉴权作为真实环境启动门禁，
 * 因为登录后的定位与录音依赖该鉴权。任何失败都返回 false，由 bootstrap fail closed。
 */
export async function initFeishuJsbridge(): Promise<boolean> {
  if (typeof window === 'undefined') return false;

  try {
    const loaded = await loadOfficialJsSdk();
    if (!loaded || !window.h5sdk?.config) {
      console.error('[FeishuJsbridge] 官方 H5 JSSDK 加载失败或 window.h5sdk.config 不存在');
      return false;
    }

    const config = await fetchSignature();
    return await new Promise<boolean>((resolve) => {
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
        finish(false);
      }, CONFIG_TIMEOUT_MS);

      window.h5sdk!.config({
        appId: config.appId,
        timestamp: config.timestamp,
        nonceStr: config.nonceStr,
        signature: config.signature,
        jsApiList: [...JSAPI_LIST],
        onSuccess: () => {
          if (!window.tt) {
            console.error('[FeishuJsbridge] 鉴权成功但 window.tt 未注入，按失败阻断');
            finish(false);
            return;
          }
          finish(true);
        },
        onFail: (error) => {
          console.error(
            '[FeishuJsbridge] 网页应用鉴权失败:',
            error.errno,
            errorMessage(error),
          );
          finish(false);
        },
      });
    });
  } catch (error) {
    console.error('[FeishuJsbridge] 初始化失败:', error);
    jsbridgeReady = false;
    return false;
  }
}

export function isJsbridgeReady(): boolean {
  return jsbridgeReady;
}
