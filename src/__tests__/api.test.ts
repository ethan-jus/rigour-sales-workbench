import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeError, ErrorCategory } from '@/api/core/error';
import { apiClient, ApiError, buildUploadRequest } from '@/api/core/client';

describe('normalizeError', () => {
  it('fetch 失败归类为网络错误', () => {
    const err = new TypeError('Failed to fetch');
    const result = normalizeError(err);
    expect(result.category).toBe(ErrorCategory.NETWORK);
    expect(result.code).toBe('NETWORK_ERROR');
  });

  it('401 归类为认证错误', () => {
    const err = new ApiError('AUTH_EXPIRED', 'token expired', 401);
    const result = normalizeError(err);
    expect(result.category).toBe(ErrorCategory.AUTH);
    expect(result.code).toBe('AUTH_EXPIRED');
  });

  it('403 归类为权限错误', () => {
    const err = new ApiError('IAM_FORBIDDEN', 'no permission', 403);
    const result = normalizeError(err);
    expect(result.category).toBe(ErrorCategory.FORBIDDEN);
    expect(result.code).toBe('IAM_FORBIDDEN');
  });

  it('其他业务错误归类为业务错误', () => {
    const err = new ApiError('ORDER_NOT_FOUND', '订单不存在', 404);
    const result = normalizeError(err);
    expect(result.category).toBe(ErrorCategory.BUSINESS);
    expect(result.code).toBe('ORDER_NOT_FOUND');
  });

  it('未知错误归类为未知', () => {
    const err = new Error('something broke');
    const result = normalizeError(err);
    expect(result.category).toBe(ErrorCategory.UNKNOWN);
  });
});

describe('apiClient', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
    vi.stubEnv('VITE_DEFAULT_TENANT_ID', 'demo');
    localStorage.clear();
  });

  it('setToken 和 clearToken 工作正常', () => {
    apiClient.setToken('test-token');
    expect(localStorage.getItem('auth_token')).toBe('test-token');

    apiClient.clearToken();
    expect(localStorage.getItem('auth_token')).toBeNull();
  });

  it('ApiError 携带 requestId', () => {
    const err = new ApiError('TEST', 'msg', 500, 'req-123');
    expect(err.requestId).toBe('req-123');
    expect(err.name).toBe('ApiError');
    expect(err.code).toBe('TEST');
    expect(err.message).toBe('msg');
    expect(err.httpStatus).toBe(500);
  });

  it('录音上传地址为H5 HTTPS multipart可用的绝对地址且不固定 Content-Type', () => {
    localStorage.setItem('auth_token', 'upload-token');
    const request = buildUploadRequest('/sales/me/visits/v-1/recordings/clips');

    expect(request.url).toBe(`${window.location.origin}/api/v1/sales/me/visits/v-1/recordings/clips`);
    expect(request.headers.Authorization).toBe('Bearer upload-token');
    expect(request.headers['Content-Type']).toBeUndefined();
  });
});
