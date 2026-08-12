import type { ApiResponse } from '@/types';

/**
 * HTTP 客户端核心模块。
 *
 * 职责：
 * - 封装 fetch 提供 get/post/put/delete 方法
 * - 自动注入标准请求头（Authorization、X-Tenant-Id、X-Request-Id、Accept-Language）
 * - Token 通过 localStorage 管理，免登后由 authStore 写入，登出时清除
 *
 * 边界：
 * - X-Tenant-Id 优先从当前登录会话动态获取，未登录时才使用开发环境默认值
 * - X-Request-Id 由前端生成，用于调用链追踪；Gateway 有校验/补全权
 * - 不实现刷新 Token 逻辑，Token 过期由后端 401 触发，前端展示登录过期提示
 *
 * 风险：
 * - 非 Mock 模式下，Token 必须由后端 /auth/login 返回，此处仅从 localStorage 读取
 * - 写请求不自动重试；超时后由页面保留幂等键语义并提示用户主动重试
 */
const BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api/v1';
const DEFAULT_TENANT_ID = import.meta.env.VITE_DEFAULT_TENANT_ID || 'demo';
const configuredTimeoutMs = Number(import.meta.env.VITE_API_TIMEOUT_MS || 15_000);
const REQUEST_TIMEOUT_MS = Number.isFinite(configuredTimeoutMs)
  && configuredTimeoutMs >= 1_000
  && configuredTimeoutMs <= 60_000
  ? configuredTimeoutMs
  : 15_000;

function currentTenantId(): string {
  return localStorage.getItem('auth_tenant_id') || DEFAULT_TENANT_ID;
}

function generateRequestId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 16; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `${Date.now().toString(36)}-${result}`;
}

function buildHeaders(overrides?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept-Language': 'zh-CN',
    'X-Tenant-Id': currentTenantId(),
    'X-Request-Id': generateRequestId(),
  };

  // Token 从 localStorage 读取（免登后由 authStore 或 apiClient.setToken 写入）
  const token = localStorage.getItem('auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  if (overrides) {
    Object.assign(headers, overrides);
  }

  return headers;
}

/**
 * multipart 上传所需的完整请求地址与鉴权头。
 * 与 buildHeaders 保持一致，但不含 JSON Content-Type（由浏览器/客户端按 multipart 自动生成）。
 */
export function buildUploadRequest(path: string): { url: string; headers: Record<string, string> } {
  const headers = buildHeaders();
  delete headers['Content-Type'];
  return { url: new URL(`${BASE_URL}${path}`, window.location.origin).toString(), headers };
}

async function handleResponse<T>(response: Response): Promise<ApiResponse<T>> {
  if (!response.ok) {
    const errorBody = await response.text();
    let parsed: ApiResponse | null = null;
    try {
      parsed = JSON.parse(errorBody);
    } catch {
      // 响应体不是 JSON 时，使用 HTTP 状态码作为错误码
    }
    throw new ApiError(
      parsed?.code || `HTTP_${response.status}`,
      parsed?.message || `请求失败: ${response.statusText}`,
      response.status,
      parsed?.requestId,
    );
  }
  return response.json();
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
      throw new ApiError('REQUEST_TIMEOUT', `请求超过 ${Math.round(REQUEST_TIMEOUT_MS / 1_000)} 秒，请重试`);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

/**
 * 前端 API 错误异常类。
 * 携带后端错误码、HTTP 状态码和 requestId，便于 normalizeError 分类处理。
 */
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus?: number,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 统一 HTTP 客户端实例 */
export const apiClient = {
  async get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    const url = new URL(`${BASE_URL}${path}`, window.location.origin);
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    }
    const response = await fetchWithTimeout(url.toString(), {
      method: 'GET',
      headers: buildHeaders(),
    });
    return handleResponse<T>(response);
  },

  async post<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: buildHeaders(),
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async put<T>(path: string, data?: unknown): Promise<ApiResponse<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: 'PUT',
      headers: buildHeaders(),
      body: data ? JSON.stringify(data) : undefined,
    });
    return handleResponse<T>(response);
  },

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
      method: 'DELETE',
      headers: buildHeaders(),
    });
    return handleResponse<T>(response);
  },

  /**
   * 设置认证 Token（免登后调用）。
   * 写入 localStorage，后续请求自动带 Authorization 头。
   */
  setToken(token: string): void {
    localStorage.setItem('auth_token', token);
  },

  /**
   * 清除认证 Token（登出时调用）。
   */
  clearToken(): void {
    localStorage.removeItem('auth_token');
  },
};
