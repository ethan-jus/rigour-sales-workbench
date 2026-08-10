import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('飞书 JSSDK 鉴权桥', () => {
  beforeEach(() => {
    vi.resetModules();
    window.h5sdk = undefined;
    window.tt = undefined;
    vi.stubGlobal('fetch', vi.fn());
    document
      .querySelectorAll('script[src*="h5-js-sdk"]')
      .forEach((script) => script.remove());
  });

  afterEach(() => {
    window.h5sdk = undefined;
    window.tt = undefined;
    document
      .querySelectorAll('script[src*="h5-js-sdk"]')
      .forEach((script) => script.remove());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('固定使用官方 1.5.44 CDN', async () => {
    const { FEISHU_JSSDK_URL } = await import('@/adapters/feishu/jsbridge');
    expect(FEISHU_JSSDK_URL).toBe(
      'https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.44.js',
    );
  });

  it('读取 ApiResponse.data 并调用 window.h5sdk.config 的 onSuccess/onFail 形态', async () => {
    const config = vi.fn((options: Record<string, unknown>) => {
      (options.onSuccess as () => void)();
    });
    window.tt = {};
    window.h5sdk = { config } as unknown as Window['h5sdk'];
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'OK',
          message: 'success',
          data: {
            appId: 'cli_test',
            timestamp: 123456,
            nonceStr: 'nonce',
            signature: 'signed',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const { initFeishuJsbridge } = await import('@/adapters/feishu/jsbridge');
    await expect(initFeishuJsbridge()).resolves.toBe(true);
    const options = config.mock.calls[0][0];
    expect(options).toMatchObject({
      appId: 'cli_test',
      timestamp: 123456,
      nonceStr: 'nonce',
      signature: 'signed',
      jsApiList: [
        'requestAccess',
        'requestAuthCode',
        'getLocation',
        'getRecorderManager',
        'getFileSystemManager',
      ],
    });
    expect(options.onSuccess).toEqual(expect.any(Function));
    expect(options.onFail).toEqual(expect.any(Function));
    expect(options).not.toHaveProperty('success');
    expect(options).not.toHaveProperty('fail');
  });

  it('onFail 或签名 data 不完整时返回 false', async () => {
    window.h5sdk = {
      config: (options: Record<string, unknown>) => {
        (options.onFail as (error: { errno: number; errString: string }) => void)({
          errno: 1001,
          errString: 'bad signature',
        });
      },
    } as unknown as Window['h5sdk'];
    window.tt = {};
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            appId: 'cli_test',
            timestamp: '123456',
            nonceStr: 'nonce',
            signature: 'signed',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    let module = await import('@/adapters/feishu/jsbridge');
    await expect(module.initFeishuJsbridge()).resolves.toBe(false);

    vi.resetModules();
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ data: { appId: 'cli_test' } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    module = await import('@/adapters/feishu/jsbridge');
    await expect(module.initFeishuJsbridge()).resolves.toBe(false);
  });

  it('已有同源脚本但无加载回调时在 10 秒后 settle 为 false', async () => {
    vi.useFakeTimers();
    const { FEISHU_JSSDK_URL, initFeishuJsbridge } = await import(
      '@/adapters/feishu/jsbridge'
    );
    const script = document.createElement('script');
    script.src = FEISHU_JSSDK_URL;
    document.head.appendChild(script);

    const result = initFeishuJsbridge();
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(result).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
