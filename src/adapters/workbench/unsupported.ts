import type { WorkbenchCapabilities } from './types';
import type { CapabilityStatus } from '@/types';

const UNSUPPORTED_MSG = '当前浏览器无法使用此设备能力，请在瑞盖销售作业 App 中操作。';

function blocked(): never {
  throw new Error(UNSUPPORTED_MSG);
}

export const unsupportedAdapter: WorkbenchCapabilities = {
  getRuntimeLabel() { return 'unsupported'; },

  getLocationStatus(): CapabilityStatus {
    return 'unsupported';
  },

  getCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number; timestamp: number }> {
    return Promise.reject(new Error(UNSUPPORTED_MSG));
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

  async uploadRecording() {
    blocked();
  },

  async discardRecording() {
    blocked();
  },

  getCameraStatus(): CapabilityStatus {
    return 'unsupported';
  },

  async captureStorefrontPhoto() {
    blocked();
  },

  async uploadPhoto() {
    blocked();
  },

  async discardPhoto() {
    blocked();
  },

  destroy() {
    // 无资源需要释放
  },
};
