export interface RecorderStopResult {
  localClipId: string;
  tempFilePath: string;
  duration: number;
  startedAt: number;
  endedAt: number;
}

/** 设备相机返回的现场照片临时文件。 */
export interface CapturedPhoto {
  localPhotoId: string;
  tempFilePath: string;
  capturedAt: number;
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

/** 门头照上传目标。 */
export interface PhotoUploadRequest {
  url: string;
  headers: Record<string, string>;
  formData: Record<string, string>;
  fileName: string;
}

/** 连续录音切片回调。 */
export interface RecordingObserver {
  onSegment: (clip: RecorderStopResult) => void;
  onError: (error: Error) => void;
}
