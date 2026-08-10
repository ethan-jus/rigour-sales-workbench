import type { CapabilityStatus } from '@/types';

/** 飞书标准回调错误。官方字段为 errno/errString，部分接口返回 errMsg。 */
export interface FeishuCallbackError {
  errno?: number;
  errString?: string;
  errMsg?: string;
}

/** requestAccess/requestAuthCode 成功回调返回的一次性免登授权码。 */
export interface AuthCodeResult {
  code: string;
}

/** 飞书定位成功回调。timestamp 单位为毫秒。 */
export interface FeishuLocationResult {
  latitude: number;
  longitude: number;
  accuracy: number;
  verticalAccuracy?: number;
  horizontalAccuracy?: number;
  authorizationAccuracy?: 'reduced' | 'full';
  timestamp?: number;
  type?: 'wgs84' | 'gcj02';
}

/**
 * 飞书录音停止后交给上传层的本地片段。
 *
 * 官方 onStop 明确返回 tempFilePath；duration 由本地 startedAt/endedAt 计算，单位为毫秒，
 * 与 RecorderManager.start({ duration }) 的官方毫秒单位保持一致。localClipId 只是前端本地标识，
 * 不是飞书 fileId，也不能当作服务端媒体 ID。
 */
export interface RecorderStopResult {
  localClipId: string;
  tempFilePath: string;
  duration: number;
  startedAt: number;
  endedAt: number;
}

/** 录音片段上传目标；页面只描述目标，真实上传由 Adapter 用客户端能力完成。 */
export interface RecordingUploadRequest {
  /** 服务端片段上传完整地址（含 visitId）。 */
  url: string;
  /** 鉴权与租户请求头（Authorization/X-Tenant-Id/X-Request-Id）。 */
  headers: Record<string, string>;
  /** 附加表单字段（durationMs、recordedFrom、recordedTo）。 */
  formData: Record<string, string>;
  /** 片段文件名（multipart 的 filename）。 */
  fileName: string;
}

/** 连续录音单段到达飞书10分钟上限时的生命周期回调。 */
export interface RecordingObserver {
  onSegment: (clip: RecorderStopResult) => void;
  onError: (error: Error) => void;
}

/** 跨仓库标准 ApiResponse.data 中的飞书 JSSDK 鉴权参数。 */
export interface JsapiConfig {
  appId: string;
  timestamp: string | number;
  nonceStr: string;
  signature: string;
}

/**
 * 页面和 Store 只依赖此 Port；只有 real.ts 可以访问 window.tt。
 * Mock 必须由 VITE_FEISHU_MOCK=true 显式开启，生产非飞书环境使用阻断 Adapter。
 */
export interface IFeishuAdapter {
  detectContainer(): 'feishu' | 'lark' | 'unknown';
  getClientVersion(): string | null;
  isJsapiAvailable(): boolean;

  /** requestAccess 优先，errno=103 时降级 requestAuthCode，只返回一次性 code。 */
  requestAuthCode(): Promise<string>;

  getLocationStatus(): CapabilityStatus;
  /** 服务端确认签到前只读取一次定位；成功后才允许 startLocation 开始持续采样。 */
  getCurrentLocation(): Promise<{ latitude: number; longitude: number; accuracy: number; timestamp: number }>;
  /**
   * 使用 gcj02 进行前台尽力采样。PC 不支持 getLocation；页面后台、锁屏或 WebView 回收时
   * 不能保证继续运行，因此该接口不是后台持续定位能力。
   */
  startLocation(
    onPoint: (point: { latitude: number; longitude: number; accuracy: number; timestamp: number }) => void,
    onInterrupted: () => void,
  ): Promise<void>;
  stopLocation(): Promise<void>;

  getAudioStatus(): CapabilityStatus;
  /** 单段最多600000ms；达到边界自动切片续录，直到销售主动停止。 */
  startRecording(observer?: RecordingObserver): void;
  /** 返回可上传的临时文件路径；未开始录音时返回 null。 */
  stopRecording(): Promise<RecorderStopResult | null>;
  /**
   * 把 stopRecording 返回的临时文件上传到服务端。
   * 真实 Adapter 用 FileSystemManager 读取临时音频后走 HTTPS multipart；Mock 走同一服务端链路。
   */
  uploadRecording(clip: RecorderStopResult, target: RecordingUploadRequest): Promise<void>;
  /** 删除客户端短录音临时文件；音频不进入对象存储。 */
  discardRecording(clip: RecorderStopResult): Promise<void>;

  destroy(): void;
}
