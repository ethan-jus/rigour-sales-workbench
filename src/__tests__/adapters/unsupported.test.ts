import { describe, it, expect, vi, beforeEach } from 'vitest';
import { unsupportedAdapter } from '@/adapters/feishu/unsupported';

// ============================================================================
// unsupportedAdapter 测试
//
// 验证生产非飞书环境所有操作均返回 unsupported 或抛出阻断错误，
// 禁止静默回落 mock。
// ============================================================================

describe('unsupportedAdapter', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEISHU_MOCK', 'false');
  });

  it('detectContainer 返回 unknown', () => {
    expect(unsupportedAdapter.detectContainer()).toBe('unknown');
  });

  it('getClientVersion 返回 null', () => {
    expect(unsupportedAdapter.getClientVersion()).toBeNull();
  });

  it('isJsapiAvailable 返回 false', () => {
    expect(unsupportedAdapter.isJsapiAvailable()).toBe(false);
  });

  it('requestAuthCode 抛出阻断错误', async () => {
    await expect(unsupportedAdapter.requestAuthCode()).rejects.toThrow('不是飞书客户端');
  });

  it('getLocationStatus 返回 unsupported', () => {
    expect(unsupportedAdapter.getLocationStatus()).toBe('unsupported');
  });

  it('startLocation 抛出阻断错误', async () => {
    await expect(
      unsupportedAdapter.startLocation(
        () => {},
        () => {},
      ),
    ).rejects.toThrow('不是飞书客户端');
  });

  it('stopLocation 静默无操作', async () => {
    await unsupportedAdapter.stopLocation();
    // 不应抛出异常
  });

  it('getAudioStatus 返回 unsupported', () => {
    expect(unsupportedAdapter.getAudioStatus()).toBe('unsupported');
  });

  it('startRecording 抛出阻断错误', () => {
    expect(() => unsupportedAdapter.startRecording()).toThrow('不是飞书客户端');
  });

  it('stopRecording 返回 null', async () => {
    const result = await unsupportedAdapter.stopRecording();
    expect(result).toBeNull();
  });

  it('destroy 静默无操作', () => {
    unsupportedAdapter.destroy();
    // 不应抛出异常
  });
});
