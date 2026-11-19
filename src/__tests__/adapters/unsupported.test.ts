import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unsupportedAdapter } from '@/adapters/workbench/unsupported';

// ============================================================================
// unsupportedAdapter 测试
//
// 验证浏览器环境所有操作均返回 unsupported 或抛出阻断错误，
// 禁止静默回落 mock。
// ============================================================================

describe('unsupportedAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_ENABLE_MOCK', 'false');
  });

  it('getLocationStatus 返回 unsupported', () => {
    expect(unsupportedAdapter.getLocationStatus()).toBe('unsupported');
  });

  it('getCurrentLocation 明确阻断', async () => {
    await expect(unsupportedAdapter.getCurrentLocation()).rejects.toThrow('当前浏览器无法使用此设备能力');
  });

  it('startLocation 抛出阻断错误', async () => {
    await expect(
      unsupportedAdapter.startLocation(
        () => {},
        () => {},
      ),
    ).rejects.toThrow('无法使用此设备能力');
  });

  it('stopLocation 静默无操作', async () => {
    await unsupportedAdapter.stopLocation();
    // 不应抛出异常
  });

  it('getAudioStatus 返回 unsupported', () => {
    expect(unsupportedAdapter.getAudioStatus()).toBe('unsupported');
  });

  it('startRecording 抛出阻断错误', () => {
    expect(() => unsupportedAdapter.startRecording()).toThrow('无法使用此设备能力');
  });

  it('stopRecording 返回 null', async () => {
    const result = await unsupportedAdapter.stopRecording();
    expect(result).toBeNull();
  });

  it('手机相机能力明确阻断', async () => {
    expect(unsupportedAdapter.getCameraStatus()).toBe('unsupported');
    await expect(unsupportedAdapter.captureStorefrontPhoto()).rejects.toThrow('无法使用此设备能力');
  });

  it('destroy 静默无操作', () => {
    unsupportedAdapter.destroy();
    // 不应抛出异常
  });
});
