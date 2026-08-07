/**
 * 浏览器侧链路诊断工具。
 *
 * <p>只生成请求标识和页面 origin/path，不读取或输出授权码、Token、查询参数和完整 URL。</p>
 */
export function createRequestId(scope: string): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${scope}-${Date.now().toString(36)}-${random}`;
}

export function elapsedMs(startedAt: number): number {
  return Date.now() - startedAt;
}

export function pageTraceContext(): { origin: string; path: string; online: boolean } {
  if (typeof window === 'undefined') {
    return { origin: '-', path: '-', online: false };
  }
  return {
    origin: window.location.origin,
    path: window.location.pathname,
    online: navigator.onLine,
  };
}

export function responseMeta(value: unknown): { code?: string; requestId?: string } {
  if (!value || typeof value !== 'object') return {};
  const body = value as { code?: unknown; requestId?: unknown };
  return {
    code: typeof body.code === 'string' ? body.code : undefined,
    requestId: typeof body.requestId === 'string' ? body.requestId : undefined,
  };
}
