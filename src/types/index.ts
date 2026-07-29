/** 飞书容器类型 */
export type FeishuContainer = 'feishu' | 'lark' | 'unknown';

/** 客户端运行环境信息 */
export interface RuntimeEnv {
  container: FeishuContainer;
  clientVersion: string | null;
  jsapiAvailable: boolean;
  mockMode: boolean;
}

/** 能力状态：各 adapter 能力统一状态模型 */
export type CapabilityStatus =
  | 'idle'
  | 'loading'
  | 'unsupported'
  | 'permission-denied'
  | 'ready'
  | 'active'
  | 'interrupted'
  | 'failed';

/** 飞书用户身份信息 */
export interface FeishuIdentity {
  userId: string;
  name: string;
  avatar: string;
  tenantId: string;
  openId?: string;
}

/** 定位采样点 */
export interface LocationPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
  address?: string;
}

/** 定位采样结果 */
export interface LocationResult {
  status: CapabilityStatus;
  points: LocationPoint[];
  interruptionCount: number;
  lastActiveAt: number | null;
}

/** 录音片段 */
export interface AudioClip {
  id: string;
  url: string;
  duration: number;
  sha256?: string;
  startedAt: number;
  endedAt: number;
}

/** 录音结果 */
export interface AudioResult {
  status: CapabilityStatus;
  clips: AudioClip[];
  totalDuration: number;
}

/** 审批跳转参数 */
export interface ApprovalNavigateParams {
  approvalCode: string;
  instanceId?: string;
  openId?: string;
}

/** 消息发送参数 */
export interface FeishuMessageParams {
  content: string;
  msgType?: 'text' | 'post' | 'interactive';
  openId?: string;
  userId?: string;
}

/** API 标准响应 */
export interface ApiResponse<T = unknown> {
  code: string;
  message: string;
  data: T;
  requestId: string;
  timestamp: string;
}

/** API 标准分页结果 */
export interface PaginatedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}
