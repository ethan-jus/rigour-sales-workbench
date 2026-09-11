import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RecordingUploadError,
  uploadRecordingMultipart,
} from '@/adapters/feishu/recording-upload';

describe('录音multipart上传错误协议', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('400只提取统一响应的message/details.reason并保留requestId', async () => {
    const responseBody = {
      code: 'SALES_RECORDING_MEDIA_INVALID',
      message: '录音文件校验失败',
      details: [
        { field: 'internal.media.decoder', reason: '音频内容无法解码，请确认录音片段有效' },
        { field: 'internal.stack', message: '可以保留片段后重传' },
      ],
      requestId: 'req-upload-400',
      debug: 'Bearer secret-token',
      stackTrace: 'internal stack must not be displayed',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify(responseBody),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )));

    const failure = await uploadRecordingMultipart('https://sales.example.com/upload', {
      method: 'POST', body: new FormData(),
    }, 'client-request-id').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RecordingUploadError);
    expect(failure).toMatchObject({
      kind: 'VALIDATION',
      code: 'SALES_RECORDING_MEDIA_INVALID',
      httpStatus: 400,
      requestId: 'req-upload-400',
    });
    expect((failure as Error).message).toContain('录音文件校验失败');
    expect((failure as Error).message).toContain('音频内容无法解码');
    expect((failure as Error).message).toContain('请求编号：req-upload-400');
    expect((failure as Error).message).not.toContain('secret-token');
    expect((failure as Error).message).not.toContain('stackTrace');
    expect((failure as Error).message).not.toContain('internal.media.decoder');
    expect((failure as Error).message).not.toContain('internal.stack');
    expect((failure as Error).message.length).toBeLessThan(260);
  });

  it('原始fetch超时与网络中断使用不同稳定分类', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: RequestInfo | URL, init?: RequestInit) => (
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      })
    )));

    const timeoutAssertion = expect(uploadRecordingMultipart(
      'https://sales.example.com/upload',
      { method: 'POST' },
      'req-timeout',
    )).rejects.toMatchObject({
      kind: 'TIMEOUT',
      code: 'RECORDING_UPLOAD_TIMEOUT',
      requestId: 'req-timeout',
    });
    await vi.advanceTimersByTimeAsync(120_000);
    await timeoutAssertion;

    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(uploadRecordingMultipart(
      'https://sales.example.com/upload',
      { method: 'POST' },
      'req-network',
    )).rejects.toMatchObject({
      kind: 'NETWORK',
      code: 'RECORDING_UPLOAD_NETWORK_ERROR',
      requestId: 'req-network',
    });
  });
});
