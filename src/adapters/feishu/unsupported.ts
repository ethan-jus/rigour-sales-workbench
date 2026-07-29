import type { IFeishuAdapter } from './types';
import type { CapabilityStatus } from '@/types';

// ============================================================================
// 非飞书生产环境阻断适配器
//
// 使用场景：VITE_FEISHU_MOCK=false 且 UA 检测不在飞书/Lark 容器内。
// 所有操作均返回 unsupported 或抛出明确错误，禁止静默回落 mock。
//
// 原因：生产环境静默回落 mock 会导致伪登录——用户以为自己已登录，
// 实际上使用的是虚假身份，后续所有操作都是无效的。
// ============================================================================

const UNSUPPORTED_MSG = '当前环境不是飞书客户端，请使用飞书 App 打开此页面。非飞书开发/测试请显式设置 VITE_FEISHU_MOCK=true。';

function blocked(): never {
  throw new Error(UNSUPPORTED_MSG);
}

export const unsupportedAdapter: IFeishuAdapter = {
  detectContainer() {
    return 'unknown';
  },

  getClientVersion() {
    return null;
  },

  isJsapiAvailable() {
    return false;
  },

  requestAuthCode(): Promise<string> {
    return Promise.reject(new Error(UNSUPPORTED_MSG));
  },

  getLocationStatus(): CapabilityStatus {
    return 'unsupported';
  },

  async startLocation(_onPoint, _onInterrupted) {
    blocked();
  },

  async stopLocation() {
    // 静默无操作——从未启动过定位，不需要清理
  },

  getAudioStatus(): CapabilityStatus {
    return 'unsupported';
  },

  startRecording() {
    blocked();
  },

  async stopRecording() {
    return null;
  },

  destroy() {
    // 无资源需要释放
  },
};
