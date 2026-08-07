import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { realAdapter } from '@/adapters/feishu/real';

type CallbackOptions = Record<string, unknown>;

function installTt(api: Record<string, unknown>): void {
  window.tt = api as Window['tt'];
}

describe('realAdapter 官方 callback bridge', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_FEISHU_APP_ID', 'cli_test_app');
  });

  afterEach(() => {
    realAdapter.destroy();
    window.tt = undefined;
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it('从 window.tt 顶层调用 requestAccess，并使用 appID + 空 scopeList', async () => {
    const requestAccess = vi.fn((options: CallbackOptions) => {
      (options.success as (result: { code: string }) => void)({ code: 'access-code' });
    });
    installTt({ requestAccess });

    await expect(realAdapter.requestAuthCode()).resolves.toBe('access-code');
    expect(requestAccess).toHaveBeenCalledTimes(1);
    const options = requestAccess.mock.calls[0][0];
    expect(options.appID).toBe('cli_test_app');
    expect(options.scopeList).toEqual([]);
    expect(options).not.toHaveProperty('appId');
  });

  it('requestAccess errno=103 时降级，并以 appId 调用 requestAuthCode', async () => {
    const requestAuthCode = vi.fn((options: CallbackOptions) => {
      (options.success as (result: { code: string }) => void)({ code: 'legacy-code' });
    });
    installTt({
      requestAccess: (options: CallbackOptions) => {
        (options.fail as (error: { errno: number; errString: string }) => void)({
          errno: 103,
          errString: 'unsupported',
        });
      },
      requestAuthCode,
    });

    await expect(realAdapter.requestAuthCode()).resolves.toBe('legacy-code');
    const options = requestAuthCode.mock.calls[0][0];
    expect(options.appId).toBe('cli_test_app');
    expect(options).not.toHaveProperty('appID');
  });

  it('兼容 errString 与 errMsg 错误消息', async () => {
    installTt({
      requestAccess: (options: CallbackOptions) => {
        (options.fail as (error: { errno: number; errString: string }) => void)({
          errno: 401,
          errString: 'access denied',
        });
      },
    });
    await expect(realAdapter.requestAuthCode()).rejects.toThrow('access denied');

    installTt({
      requestAuthCode: (options: CallbackOptions) => {
        (options.fail as (error: { errno: number; errMsg: string }) => void)({
          errno: 500,
          errMsg: 'legacy failed',
        });
      },
    });
    await expect(realAdapter.requestAuthCode()).rejects.toThrow('legacy failed');
  });

  it('未配置 App ID 或 window.tt 不存在时明确失败', async () => {
    vi.stubEnv('VITE_FEISHU_APP_ID', '');
    await expect(realAdapter.requestAuthCode()).rejects.toThrow('VITE_FEISHU_APP_ID');

    vi.stubEnv('VITE_FEISHU_APP_ID', 'cli_test_app');
    window.tt = undefined;
    await expect(realAdapter.requestAuthCode()).rejects.toThrow('window.tt 不存在');
  });

  it('从 window.tt 顶层调用 getLocation，并传 gcj02/best/超时/缓存参数', async () => {
    const getLocation = vi.fn((options: CallbackOptions) => {
      (options.success as (result: {
        latitude: number;
        longitude: number;
        accuracy: number;
        timestamp: number;
      }) => void)({
        latitude: 30.2,
        longitude: 120.1,
        accuracy: 18,
        timestamp: 123456,
      });
    });
    installTt({ getLocation });
    const points: Array<{ timestamp: number }> = [];

    await realAdapter.startLocation((point) => points.push(point), vi.fn());

    expect(getLocation).toHaveBeenCalledTimes(1);
    expect(getLocation.mock.calls[0][0]).toMatchObject({
      type: 'gcj02',
      timeout: 10,
      cacheTimeout: 30,
      accuracy: 'best',
    });
    expect(points[0].timestamp).toBe(123456);
  });

  it('签到前置定位只调用一次 getLocation，不启动轮询', async () => {
    const getLocation = vi.fn((options: CallbackOptions) => {
      (options.success as (result: { latitude: number; longitude: number; accuracy: number; timestamp: number }) => void)({
        latitude: 30.2, longitude: 120.1, accuracy: 18, timestamp: 123456,
      });
    });
    installTt({ getLocation });

    await expect(realAdapter.getCurrentLocation()).resolves.toMatchObject({ latitude: 30.2, timestamp: 123456 });
    expect(getLocation).toHaveBeenCalledTimes(1);
  });

  it('PC/无定位 API 时显式 unsupported', () => {
    installTt({});
    expect(realAdapter.getLocationStatus()).toBe('unsupported');
    expect(realAdapter.getAudioStatus()).toBe('unsupported');
  });

  it('RecorderManager 返回 localClipId、tempFilePath 和本地毫秒时长', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    let onStart: (() => void) | undefined;
    let onStop: ((result: { tempFilePath: string }) => void) | undefined;
    const manager = {
      start: vi.fn(),
      stop: vi.fn(() => onStop?.({ tempFilePath: 'ttfile://recording.aac' })),
      onStart: vi.fn((callback: () => void) => {
        onStart = callback;
      }),
      onStop: vi.fn((callback: (result: { tempFilePath: string }) => void) => {
        onStop = callback;
      }),
      onError: vi.fn(),
    };
    const getRecorderManager = vi.fn(() => manager);
    installTt({ getRecorderManager });

    realAdapter.startRecording();
    vi.setSystemTime(2_000);
    onStart?.();
    vi.setSystemTime(5_500);
    const clip = await realAdapter.stopRecording();

    expect(getRecorderManager).toHaveBeenCalledTimes(1);
    expect(manager.start).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 600_000, format: 'aac' }),
    );
    expect(clip).toMatchObject({
      tempFilePath: 'ttfile://recording.aac',
      duration: 3_500,
      startedAt: 2_000,
      endedAt: 5_500,
    });
    expect(clip?.localClipId).toMatch(/^local-/);
    expect(clip).not.toHaveProperty('id');
    expect(clip).not.toHaveProperty('fileId');
  });

  it('重复 start 不创建第二段录音，未启动 stop 返回 null', async () => {
    const manager = {
      start: vi.fn(),
      stop: vi.fn(),
      onStart: vi.fn(),
      onStop: vi.fn(),
      onError: vi.fn(),
    };
    installTt({ getRecorderManager: () => manager });

    await expect(realAdapter.stopRecording()).resolves.toBeNull();
    realAdapter.startRecording();
    realAdapter.startRecording();
    expect(manager.start).toHaveBeenCalledTimes(1);
  });

  it('destroy 后忽略旧 RecorderManager 的异步 onStop', async () => {
    vi.useFakeTimers();
    let onStart: (() => void) | undefined;
    let onStop: ((result: { tempFilePath: string }) => void) | undefined;
    const manager = {
      start: vi.fn(),
      stop: vi.fn(() => {
        setTimeout(() => onStop?.({ tempFilePath: 'ttfile://late.aac' }), 10);
      }),
      onStart: vi.fn((callback: () => void) => {
        onStart = callback;
      }),
      onStop: vi.fn((callback: (result: { tempFilePath: string }) => void) => {
        onStop = callback;
      }),
      onError: vi.fn(),
    };
    installTt({ getRecorderManager: () => manager });

    realAdapter.startRecording();
    onStart?.();
    realAdapter.destroy();
    await vi.advanceTimersByTimeAsync(10);

    await expect(realAdapter.stopRecording()).resolves.toBeNull();
  });
});
