/**
 * 统一错误处理模块。
 *
 * 职责：
 * - 将 fetch 异常、ApiError、JS 原生 Error 统一规范化为 NormalizedError
 * - 按错误类别（网络/认证/权限/业务/未知）分类，便于页面层统一展示
 *
 * 边界：
 * - 不处理错误重试、降级或 toast 展示，只做分类
 * - 网络错误仅识别 Failed to fetch，不覆盖超时、CORS、DNS 等细分场景
 *
 * 风险：
 * - Failed to fetch 字符串匹配依赖浏览器实现，跨浏览器兼容性需验证
 */

export enum ErrorCategory {
  /** 网络错误——断网、超时、CORS */
  NETWORK = 'NETWORK',
  /** 认证错误——Token 过期、未登录，需重新免登 */
  AUTH = 'AUTH',
  /** 权限错误——无数据范围权限，当前用户无权访问目标资源 */
  FORBIDDEN = 'FORBIDDEN',
  /** 业务错误——后端返回业务错误码，页面应展示具体错误信息 */
  BUSINESS = 'BUSINESS',
  /** 未知错误——无法归类的异常 */
  UNKNOWN = 'UNKNOWN',
}

export interface NormalizedError {
  category: ErrorCategory;
  code: string;
  message: string;
  requestId?: string;
  originalError?: unknown;
}

/**
 * 将任意错误规范化为 NormalizedError。
 *
 * 分类规则：
 * - TypeError('Failed to fetch') → NETWORK
 * - ApiError with httpStatus 401 → AUTH
 * - ApiError with httpStatus 403 → FORBIDDEN
 * - 其他 ApiError → BUSINESS
 * - 其余所有 → UNKNOWN
 */
export function normalizeError(error: unknown): NormalizedError {
  // 网络错误：fetch 无法连接
  if (error instanceof TypeError && error.message === 'Failed to fetch') {
    return {
      category: ErrorCategory.NETWORK,
      code: 'NETWORK_ERROR',
      message: '网络连接失败，请检查网络',
    };
  }

  // ApiError（来自 client.ts 的 handleResponse）
  if (error instanceof Error && error.name === 'ApiError') {
    const apiErr = error as Error & { code?: string; httpStatus?: number; requestId?: string };
    const httpStatus = apiErr.httpStatus ?? 0;

    if (httpStatus === 401) {
      return {
        category: ErrorCategory.AUTH,
        code: apiErr.code ?? 'AUTH_EXPIRED',
        message: '登录已过期，请重新登录',
        requestId: apiErr.requestId,
        originalError: error,
      };
    }

    if (httpStatus === 403) {
      return {
        category: ErrorCategory.FORBIDDEN,
        code: apiErr.code ?? 'FORBIDDEN',
        message: apiErr.message || '无权访问',
        requestId: apiErr.requestId,
        originalError: error,
      };
    }

    return {
      category: ErrorCategory.BUSINESS,
      code: apiErr.code ?? 'BUSINESS_ERROR',
      message: apiErr.message,
      requestId: apiErr.requestId,
      originalError: error,
    };
  }

  // 未归类的异常
  return {
    category: ErrorCategory.UNKNOWN,
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : '未知错误',
    originalError: error,
  };
}
