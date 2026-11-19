type RecordingUploadFailureKind =
  | 'TIMEOUT'
  | 'NETWORK'
  | 'VALIDATION'
  | 'AUTH'
  | 'FORBIDDEN'
  | 'RATE_LIMIT'
  | 'SERVER'
  | 'HTTP';

interface UnifiedErrorBody {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  requestId?: unknown;
}

const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;
const configuredUploadTimeoutMs = Number(
  import.meta.env.VITE_RECORDING_UPLOAD_TIMEOUT_MS || DEFAULT_UPLOAD_TIMEOUT_MS,
);
const RECORDING_UPLOAD_TIMEOUT_MS = Number.isFinite(configuredUploadTimeoutMs)
  && configuredUploadTimeoutMs >= 15_000
  && configuredUploadTimeoutMs <= 300_000
  ? configuredUploadTimeoutMs
  : DEFAULT_UPLOAD_TIMEOUT_MS;

/**
 * 录音上传失败的稳定分类。页面只展示安全 message；code/requestId 用于定位，
 * 不把服务端原始 JSON、堆栈或底层网络异常直接暴露给销售。
 */
export class RecordingUploadError extends Error {
  constructor(
    public kind: RecordingUploadFailureKind,
    public code: string,
    message: string,
    public httpStatus?: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'RecordingUploadError';
  }
}

function safeText(value: unknown, maximumLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  let text = Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? ' ' : character;
  }).join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.startsWith('{') || text.startsWith('[')) return undefined;
  text = text
    .replace(/Bearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(/\b(token|secret|password)\s*[:=]\s*\S+/gi, '$1=[已隐藏]');
  return text.length > maximumLength
    ? `${text.slice(0, maximumLength - 1)}…`
    : text;
}

function safeRequestId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const requestId = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/.test(requestId) ? requestId : undefined;
}

function safeCode(value: unknown, status: number): string {
  if (typeof value !== 'string') return `HTTP_${status}`;
  const code = value.trim();
  return /^[A-Z0-9][A-Z0-9_.:-]{0,63}$/i.test(code) ? code : `HTTP_${status}`;
}

function parseUnifiedError(text: string): UnifiedErrorBody | null {
  if (!text.trim()) return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as UnifiedErrorBody
      : null;
  } catch {
    return null;
  }
}

function responseSummary(body: UnifiedErrorBody | null): string | undefined {
  const message = safeText(body?.message, 80);
  const detailItems = Array.isArray(body?.details)
    ? body.details.slice(0, 2)
    : [body?.details];
  const detailMessages = detailItems.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const detail = item as { message?: unknown; reason?: unknown };
    // details.field可能包含内部参数名；销售端只展示稳定的message/reason。
    return [safeText(detail.message, 64), safeText(detail.reason, 96)];
  });
  const parts = [message, ...detailMessages].filter((item, index, values): item is string => (
    Boolean(item) && values.indexOf(item) === index
  ));
  return safeText(parts.join('；'), 140);
}

function withRequestId(message: string, requestId?: string): string {
  return requestId ? `${message}（请求编号：${requestId}）` : message;
}

function responseFailure(
  response: Response,
  body: UnifiedErrorBody | null,
  fallbackRequestId?: string,
): RecordingUploadError {
  const status = response.status;
  const requestId = safeRequestId(body?.requestId)
    ?? safeRequestId(response.headers.get('x-request-id'))
    ?? safeRequestId(fallbackRequestId);
  const code = safeCode(body?.code, status);
  const summary = responseSummary(body);
  const serverDetail = summary ? `：${summary}` : '';

  if (status === 400 || status === 422) {
    return new RecordingUploadError(
      'VALIDATION',
      code,
      withRequestId(
        `录音未通过服务端校验${serverDetail}。请保持本页打开并点击重传；若仍失败，请将请求编号反馈给管理员`,
        requestId,
      ),
      status,
      requestId,
    );
  }
  if (status === 401) {
    return new RecordingUploadError(
      'AUTH',
      code,
      withRequestId('登录状态已失效，录音片段仍保留在本页；请恢复登录后点击重传', requestId),
      status,
      requestId,
    );
  }
  if (status === 403) {
    return new RecordingUploadError(
      'FORBIDDEN',
      code,
      withRequestId('当前账号不能上传本次录音，请联系管理员核对销售录音权限', requestId),
      status,
      requestId,
    );
  }
  if (status === 429) {
    return new RecordingUploadError(
      'RATE_LIMIT',
      code,
      withRequestId('录音上传请求过于频繁，请稍后点击重传', requestId),
      status,
      requestId,
    );
  }
  if (status >= 500) {
    return new RecordingUploadError(
      'SERVER',
      code,
      withRequestId('录音服务暂不可用，片段仍保留在本页；请稍后点击重传', requestId),
      status,
      requestId,
    );
  }
  return new RecordingUploadError(
    'HTTP',
    code,
    withRequestId(`录音上传失败（HTTP ${status}），片段仍保留在本页；请点击重传`, requestId),
    status,
    requestId,
  );
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'name' in error && error.name === 'AbortError');
}

/**
 * 使用原始 fetch 上传 multipart，但补齐长音频所需的独立超时和安全错误解析。
 * 写请求不自动重试，避免响应丢失时重复上传；页面保留同一 clientClipId 供用户主动重传。
 */
export async function uploadRecordingMultipart(
  url: string,
  init: RequestInit,
  fallbackRequestId?: string,
): Promise<void> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), RECORDING_UPLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (response.ok) return;
    const text = await response.text().catch(() => '');
    throw responseFailure(response, parseUnifiedError(text), fallbackRequestId);
  } catch (error) {
    if (error instanceof RecordingUploadError) throw error;
    const requestId = safeRequestId(fallbackRequestId);
    if (controller.signal.aborted || isAbortError(error)) {
      throw new RecordingUploadError(
        'TIMEOUT',
        'RECORDING_UPLOAD_TIMEOUT',
        withRequestId('录音上传超时，片段仍保留在本页；请检查网络后点击重传', requestId),
        undefined,
        requestId,
      );
    }
    throw new RecordingUploadError(
      'NETWORK',
      'RECORDING_UPLOAD_NETWORK_ERROR',
      withRequestId('录音上传网络中断，片段仍保留在本页；请检查网络后点击重传', requestId),
      undefined,
      requestId,
    );
  } finally {
    window.clearTimeout(timeoutId);
  }
}
