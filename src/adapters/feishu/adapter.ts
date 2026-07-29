import type { IFeishuAdapter } from './types';

import { realAdapter } from './real';
import { mockAdapter } from './mock';
import { unsupportedAdapter } from './unsupported';

// ============================================================================
// 飞书 Adapter 工厂模块
//
// 职责：
// - 根据 VITE_FEISHU_MOCK 环境变量和 UA 检测，自动选择适配器
// - 提供显式 setFeishuAdapter() 供测试插入自定义适配器
// - detectRuntimeContainer() 独立于适配器实例，bootstrap 阶段即可调用
//
// 选择逻辑：
// 1. VITE_FEISHU_MOCK=true  → 显式 mock（浏览器开发、CI）
// 2. VITE_FEISHU_MOCK=false → 不在飞书容器 → 生产阻断（unsupportedAdapter）
// 3. VITE_FEISHU_MOCK=false → 在飞书容器内 → realAdapter（真实 JSAPI）
//
// 安全边界：
// - 生产非飞书环境禁止静默回落 mock，否则会伪登录——用户看到虚假身份，
//   后续 API 调用用 mock 用户 ID 请求后端，造成数据错乱
// - 只有 VITE_FEISHU_MOCK=true 显式开发/测试环境才允许 mock
// - 任何情况下不自动启动 watch/dev 或后台服务
//
// 风险：
// - UA 检测可能被篡改或伪造；若飞书修改 UA 格式，容器检测可能失效
// - VITE_FEISHU_MOCK=false 且非飞书容器时，用户看到阻断页面，需手动在飞书 App 中打开
// ============================================================================

const useMock = import.meta.env.VITE_FEISHU_MOCK === 'true';

let instance: IFeishuAdapter | null = null;

function isInFeishu(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('feishu') || ua.includes('lark');
}

/**
 * 获取当前环境的 Feishu Adapter 单例。
 *
 * 决策矩阵：
 *   VITE_FEISHU_MOCK=true  → mockAdapter
 *   VITE_FEISHU_MOCK=false + 飞书 UA → realAdapter
 *   VITE_FEISHU_MOCK=false + 非飞书 UA → unsupportedAdapter（阻断）
 *
 * 注意：VITE_FEISHU_MOCK 默认为 true（开发环境），生产部署时需设为 false。
 */
export function getFeishuAdapter(): IFeishuAdapter {
  if (instance) return instance;

  if (useMock) {
    instance = mockAdapter;
    console.log('[FeishuAdapter] 使用 Mock Adapter（VITE_FEISHU_MOCK=true）');
  } else if (isInFeishu()) {
    instance = realAdapter;
    console.log('[FeishuAdapter] 使用 Real Adapter（检测到飞书/Lark UA）');
  } else {
    // 生产环境且不在飞书容器：阻断，不静默降级
    instance = unsupportedAdapter;
    console.warn(
      '[FeishuAdapter] 生产非飞书环境，使用 unsupportedAdapter 阻断。',
      '如需开发/测试请设置 VITE_FEISHU_MOCK=true。',
    );
  }

  return instance;
}

/** 显式设置适配器（主要用于测试环境注入自定义实现） */
export function setFeishuAdapter(adapter: IFeishuAdapter): void {
  instance = adapter;
}

/**
 * 检测当前运行容器信息。
 * 不依赖适配器实例，在调用 getFeishuAdapter 前即可使用。
 * bootstrap 阶段通过此函数报告环境状态，决定是否需要 JSSDK 签名注入。
 */
export function detectRuntimeContainer(): {
  container: 'feishu' | 'lark' | 'unknown';
  clientVersion: string | null;
  jsapiAvailable: boolean;
  mockMode: boolean;
} {
  if (useMock) {
    return {
      container: 'unknown',
      clientVersion: null,
      jsapiAvailable: false,
      mockMode: true,
    };
  }

  if (typeof window === 'undefined') {
    return {
      container: 'unknown',
      clientVersion: null,
      jsapiAvailable: false,
      mockMode: false,
    };
  }

  const ua = navigator.userAgent.toLowerCase();

  let container: 'feishu' | 'lark' | 'unknown' = 'unknown';
  if (ua.includes('feishu')) container = 'feishu';
  else if (ua.includes('lark')) container = 'lark';

  const versionMatch = ua.match(/(?:feishu|lark)\/([\d.]+)/i);
  const clientVersion = versionMatch ? versionMatch[1] : null;

  // 飞书 JSAPI 通过 window.tt 全局对象暴露，检查其是否存在
  const jsapiAvailable =
    container !== 'unknown' && typeof (window as unknown as Record<string, unknown>).tt !== 'undefined';

  return {
    container,
    clientVersion,
    jsapiAvailable,
    mockMode: false,
  };
}
