import { describe, it, expect, vi } from 'vitest';
import { mockAdapter } from '@/adapters/feishu/mock';
import { detectRuntimeContainer } from '@/adapters';

// ============================================================================
// Mock Feishu Adapter 测试
// ============================================================================

describe('Mock Feishu Adapter', () => {
  it('detectContainer 返回 unknown', () => {
    expect(mockAdapter.detectContainer()).toBe('unknown');
  });

  it('getClientVersion 返回 mock 版本号', () => {
    expect(mockAdapter.getClientVersion()).toBe('7.0.0-mock');
  });

  it('isJsapiAvailable 返回 false', () => {
    expect(mockAdapter.isJsapiAvailable()).toBe(false);
  });

  // =========================================================================
  // requestAuthCode
  // =========================================================================
  it('requestAuthCode 返回以 mock-auth-code- 开头的 code', async () => {
    const code = await mockAdapter.requestAuthCode();
    expect(code).toContain('mock-auth-code-');
    expect(typeof code).toBe('string');
  });

  // =========================================================================
  // 定位
  // =========================================================================
  it('getLocationStatus 返回 ready', () => {
    expect(mockAdapter.getLocationStatus()).toBe('ready');
  });

  it('getCurrentLocation 返回签到前置定位点', async () => {
    const point = await mockAdapter.getCurrentLocation();
    expect(point.latitude).toBeGreaterThan(39);
    expect(point.longitude).toBeGreaterThan(116);
    expect(point.accuracy).toBe(15);
  });

  it('startLocation 至少发射一个点并清理', async () => {
    const points: Array<{ latitude: number; longitude: number; accuracy: number }> = [];
    const interruptions: number[] = [];

    await mockAdapter.startLocation(
      (pt) => points.push(pt),
      () => interruptions.push(1),
    );

    expect(points.length).toBeGreaterThanOrEqual(1);
    expect(points[0].latitude).toBeGreaterThan(39);
    expect(points[0].longitude).toBeGreaterThan(116);
    expect(points[0].accuracy).toBe(15);

    await mockAdapter.stopLocation();
  });

  it('stopLocation 安全清理（多次调用不报错）', async () => {
    await mockAdapter.stopLocation();
    await mockAdapter.stopLocation();
    // 不应抛出异常
  });

  // =========================================================================
  // 录音
  // =========================================================================
  it('getAudioStatus 返回 ready', () => {
    expect(mockAdapter.getAudioStatus()).toBe('ready');
  });

  it('startRecording 后 stopRecording 返回可上传的本地片段', async () => {
    mockAdapter.startRecording();
    const clip = await mockAdapter.stopRecording();
    expect(clip).not.toBeNull();
    expect(clip!.localClipId).toContain('mock-local');
    expect(clip!.tempFilePath).toMatch(/^mock:\/\/recordings\//);
    expect(clip!.duration).toBeGreaterThanOrEqual(0);
    expect(clip!.startedAt).toBeLessThanOrEqual(clip!.endedAt);
    expect(clip).not.toHaveProperty('fileId');
  });

  it('未 startRecording 时 stopRecording 返回 null', async () => {
    // 确保没有在录音中（前一个测试可能残留）
    const clip = await mockAdapter.stopRecording();
    expect(clip).toBeNull();
  });

  it('重复 startRecording 不报错（幂等）', () => {
    mockAdapter.startRecording();
    mockAdapter.startRecording(); // 应忽略并 console.warn
    // 不应抛出
  });

  // =========================================================================
  // destroy
  // =========================================================================
  it('destroy 清理所有资源', () => {
    mockAdapter.destroy();
    // 不应抛出异常
  });
});

describe('detectRuntimeContainer', () => {
  it('VITE_FEISHU_MOCK=true 时返回 mockMode=true', () => {
    vi.stubEnv('VITE_FEISHU_MOCK', 'true');
    const env = detectRuntimeContainer();
    expect(env.mockMode).toBe(true);
  });
});
