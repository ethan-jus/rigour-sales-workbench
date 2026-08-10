import type { CapabilityStatus } from '@/types';
import type {
  AuthCodeResult,
  FeishuCallbackError,
  FeishuLocationResult,
  IFeishuAdapter,
  RecordingObserver,
  RecorderStopResult,
} from './types';

interface RequestAccessOptions {
  appID: string;
  scopeList: string[];
  success: (result: AuthCodeResult) => void;
  fail: (error: FeishuCallbackError) => void;
}

interface RequestAuthCodeOptions {
  appId: string;
  success: (result: AuthCodeResult) => void;
  fail: (error: FeishuCallbackError) => void;
}

interface GetLocationOptions {
  type: 'gcj02';
  /** 单位为秒；best 模式官方推荐上限等待 10 秒。 */
  timeout: number;
  /** 单位为秒；30 秒内允许复用客户端缓存点。 */
  cacheTimeout: number;
  accuracy: 'best';
  success: (result: FeishuLocationResult) => void;
  fail: (error: FeishuCallbackError) => void;
}

interface RecorderManager {
  start: (options: {
    /** 单位为毫秒；官方最大值 600000，即 10 分钟。 */
    duration: number;
    format: 'aac' | 'mp3';
    sampleRate: number;
    numberOfChannels: number;
    encodeBitRate: number;
    frameSize: number;
  }) => void;
  stop: () => void;
  onStart: (callback: () => void) => void;
  onStop: (callback: (result: { tempFilePath: string }) => void) => void;
  onError: (callback: (error: FeishuCallbackError) => void) => void;
}

interface FileSystemManager {
  readFile: (options: {
    filePath: string;
    success: (result: { data: string | ArrayBuffer }) => void;
    fail: (error: FeishuCallbackError) => void;
  }) => void;
  unlink: (options: {
    filePath: string;
    success: () => void;
    fail: (error: FeishuCallbackError) => void;
  }) => void;
}

interface FeishuJsapi {
  requestAccess?: (options: RequestAccessOptions) => void;
  requestAuthCode?: (options: RequestAuthCodeOptions) => void;
  getLocation?: (options: GetLocationOptions) => void;
  getRecorderManager?: () => RecorderManager;
  getFileSystemManager?: () => FileSystemManager;
}

declare global {
  interface Window {
    /** 飞书 H5 JSSDK 将客户端 API 直接暴露在 window.tt。 */
    tt?: FeishuJsapi;
  }
}

const ERRNO_REQUEST_ACCESS_UNSUPPORTED = 103;
const LOCATION_INTERVAL_MS = 20 * 60 * 1000;
const RECORDING_LIMIT_MS = 600_000;
const RECORDING_STOP_TIMEOUT_MS = 30_000;

let locationTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;

let recorderManager: RecorderManager | null = null;
let recorderListenersRegistered = false;
let recorderDestroyed = false;
let recorderGeneration = 0;
let recordingRequestedAt: number | null = null;
let recordingStartedAt: number | null = null;
let isRecording = false;
let continuousRecordingRequested = false;
let recordingObserver: RecordingObserver | null = null;
let localClipSequence = 0;
let lastClip: RecorderStopResult | null = null;
let pendingStop:
  | {
      resolve: (clip: RecorderStopResult) => void;
      reject: (error: Error) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  | null = null;

function getJsapi(): FeishuJsapi {
  if (typeof window === 'undefined' || !window.tt) {
    throw new Error('飞书 H5 JSAPI 不可用：window.tt 不存在');
  }
  return window.tt;
}

function getErrorNumber(error: FeishuCallbackError): number | undefined {
  return error.errno;
}

function getErrorMessage(error: FeishuCallbackError): string {
  return error.errString ?? error.errMsg ?? '未知飞书客户端错误';
}

function formatError(apiName: string, error: FeishuCallbackError): Error {
  const errno = getErrorNumber(error);
  return new Error(`${apiName} 失败: errno=${errno ?? 'unknown'}, ${getErrorMessage(error)}`);
}

function resolveAuthCode(apiName: string, result: AuthCodeResult, resolve: (code: string) => void, reject: (error: Error) => void) {
  if (result?.code) {
    resolve(result.code);
    return;
  }
  reject(new Error(`${apiName} 返回结果不含 code`));
}

function requestLegacyAuthCode(tt: FeishuJsapi, appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!tt.requestAuthCode) {
      reject(new Error('当前客户端不支持 requestAuthCode，无法完成旧客户端免登降级'));
      return;
    }

    tt.requestAuthCode({
      appId,
      success: (result) => resolveAuthCode('requestAuthCode', result, resolve, reject),
      fail: (error) => reject(formatError('requestAuthCode', error)),
    });
  });
}

function createLocalClip(tempFilePath: string): RecorderStopResult {
  const callbackAt = Date.now();
  const startedAt = recordingStartedAt ?? recordingRequestedAt ?? callbackAt;
  // 飞书在10分钟边界后的回调调度可能略有延迟；证据片段仍以官方单段上限封顶，
  // 并让 recordedTo 与 duration 保持严格一致，避免服务端把回调延迟误判成超长录音。
  const duration = Math.min(RECORDING_LIMIT_MS, Math.max(0, callbackAt - startedAt));
  const endedAt = startedAt + duration;
  localClipSequence += 1;
  return {
    localClipId: `local-${startedAt}-${localClipSequence}`,
    tempFilePath,
    duration,
    startedAt,
    endedAt,
  };
}

function settleRecorderStop(tempFilePath: string): void {
  const clip = createLocalClip(tempFilePath);
  isRecording = false;
  recordingRequestedAt = null;
  recordingStartedAt = null;

  if (pendingStop) {
    clearTimeout(pendingStop.timeoutId);
    pendingStop.resolve(clip);
    pendingStop = null;
    recordingObserver = null;
    return;
  }

  if (continuousRecordingRequested) {
    const observer = recordingObserver;
    try {
      startRecorderSegment(getConfiguredRecorderManager());
      observer?.onSegment(clip);
    } catch (error) {
      continuousRecordingRequested = false;
      recordingObserver = null;
      observer?.onSegment(clip);
      observer?.onError(error instanceof Error ? error : new Error('录音自动续段失败'));
    }
    return;
  }

  lastClip = clip;
}

function settleRecorderError(error: FeishuCallbackError): void {
  isRecording = false;
  recordingRequestedAt = null;
  recordingStartedAt = null;
  if (pendingStop) {
    clearTimeout(pendingStop.timeoutId);
    pendingStop.reject(formatError('RecorderManager', error));
    pendingStop = null;
  } else {
    continuousRecordingRequested = false;
    const observer = recordingObserver;
    recordingObserver = null;
    observer?.onError(formatError('RecorderManager', error));
  }
}

function startRecorderSegment(manager: RecorderManager): void {
  lastClip = null;
  recordingRequestedAt = Date.now();
  manager.start({
    duration: RECORDING_LIMIT_MS,
    format: 'aac',
    sampleRate: 44_100,
    numberOfChannels: 1,
    encodeBitRate: 192_000,
    frameSize: 50,
  });
}

function getConfiguredFileSystemManager(): FileSystemManager {
  const tt = getJsapi();
  if (!tt.getFileSystemManager) {
    throw new Error('当前客户端不支持 getFileSystemManager，无法读取录音临时文件');
  }
  return tt.getFileSystemManager();
}

function readTemporaryAudio(filePath: string): Promise<ArrayBuffer> {
  let manager: FileSystemManager;
  try {
    manager = getConfiguredFileSystemManager();
  } catch (error) {
    return Promise.reject(error);
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    manager.readFile({
      filePath,
      success: ({ data }) => {
        if (data instanceof ArrayBuffer) {
          resolve(data);
          return;
        }
        reject(new Error('录音临时文件返回了非二进制数据'));
      },
      fail: (error) => reject(formatError('FileSystemManager.readFile', error)),
    });
  });
}

function getConfiguredRecorderManager(): RecorderManager {
  if (recorderManager) return recorderManager;

  const tt = getJsapi();
  if (!tt.getRecorderManager) {
    throw new Error('当前客户端不支持 getRecorderManager；PC 端不支持现场录音');
  }

  recorderManager = tt.getRecorderManager();
  if (!recorderListenersRegistered) {
    const listenerGeneration = recorderGeneration;
    recorderManager.onStart(() => {
      if (recorderDestroyed || listenerGeneration !== recorderGeneration) return;
      recordingStartedAt = Date.now();
      isRecording = true;
    });
    recorderManager.onStop((result) => {
      if (recorderDestroyed || listenerGeneration !== recorderGeneration) return;
      settleRecorderStop(result.tempFilePath);
    });
    recorderManager.onError((error) => {
      if (recorderDestroyed || listenerGeneration !== recorderGeneration) return;
      settleRecorderError(error);
    });
    recorderListenersRegistered = true;
  }
  return recorderManager;
}

/**
 * 真实飞书 Adapter。客户端 API 只从 window.tt 顶层调用。
 * PC 不支持定位和录音；20 分钟采样是 H5 前台尽力执行，不提供后台持续定位保证。
 */
export const realAdapter: IFeishuAdapter = {
  detectContainer() {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('feishu')) return 'feishu';
    if (ua.includes('lark')) return 'lark';
    return 'unknown';
  },

  getClientVersion() {
    const match = navigator.userAgent.match(/(?:feishu|lark)\/([\d.]+)/i);
    return match ? match[1] : null;
  },

  isJsapiAvailable() {
    return typeof window !== 'undefined' && typeof window.tt !== 'undefined';
  },

  requestAuthCode() {
    const appId = import.meta.env.VITE_FEISHU_APP_ID || '';
    if (!appId) return Promise.reject(new Error('VITE_FEISHU_APP_ID 未配置'));

    let tt: FeishuJsapi;
    try {
      tt = getJsapi();
    } catch (error) {
      return Promise.reject(error);
    }

    if (!tt.requestAccess) return requestLegacyAuthCode(tt, appId);

    return new Promise((resolve, reject) => {
      tt.requestAccess!({
        appID: appId,
        scopeList: [],
        success: (result) => resolveAuthCode('requestAccess', result, resolve, reject),
        fail: (error) => {
          if (getErrorNumber(error) === ERRNO_REQUEST_ACCESS_UNSUPPORTED) {
            requestLegacyAuthCode(tt, appId).then(resolve, reject);
            return;
          }
          reject(formatError('requestAccess', error));
        },
      });
    });
  },

  getLocationStatus(): CapabilityStatus {
    if (!this.isJsapiAvailable() || !window.tt?.getLocation) return 'unsupported';
    return 'ready';
  },

  getCurrentLocation() {
    const tt = getJsapi();
    if (!tt.getLocation) {
      return Promise.reject(new Error('当前客户端不支持 getLocation；飞书 PC 端不支持 H5 定位'));
    }
    return new Promise((resolve, reject) => {
      tt.getLocation!({
        type: 'gcj02',
        timeout: 10,
        cacheTimeout: 30,
        accuracy: 'best',
        success: (result) => resolve({
          latitude: result.latitude,
          longitude: result.longitude,
          accuracy: result.accuracy,
          timestamp: result.timestamp ?? Date.now(),
        }),
        fail: (error) => reject(formatError('getLocation', error)),
      });
    });
  },

  async startLocation(onPoint, onInterrupted) {
    const tt = getJsapi();
    if (!tt.getLocation) {
      onInterrupted();
      throw new Error('当前客户端不支持 getLocation；飞书 PC 端不支持 H5 定位');
    }

    await this.stopLocation();

    const poll = () => {
      void this.getCurrentLocation().then(onPoint).catch((error: Error) => {
        console.warn('[FeishuReal] getLocation 失败:', error.message);
        onInterrupted();
      });
    };

    poll();
    locationTimer = setInterval(poll, LOCATION_INTERVAL_MS);
    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        onInterrupted();
      } else if (document.visibilityState === 'visible') {
        poll();
      }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  },

  async stopLocation() {
    if (locationTimer) {
      clearInterval(locationTimer);
      locationTimer = null;
    }
    if (visibilityHandler) {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
  },

  getAudioStatus(): CapabilityStatus {
    if (!this.isJsapiAvailable()
        || !window.tt?.getRecorderManager
        || !window.tt?.getFileSystemManager) return 'unsupported';
    return 'ready';
  },

  startRecording(observer) {
    if (isRecording || recordingRequestedAt !== null) {
      console.warn('[FeishuReal] 已在录音中，忽略重复 startRecording');
      return;
    }

    recorderDestroyed = false;
    const manager = getConfiguredRecorderManager();
    continuousRecordingRequested = true;
    recordingObserver = observer ?? null;
    try {
      startRecorderSegment(manager);
    } catch (error) {
      continuousRecordingRequested = false;
      recordingObserver = null;
      recordingRequestedAt = null;
      recordingStartedAt = null;
      throw error;
    }
  },

  async stopRecording() {
    if (lastClip && !isRecording && recordingRequestedAt === null) {
      const clip = lastClip;
      lastClip = null;
      return clip;
    }
    if (!recorderManager || (!isRecording && recordingRequestedAt === null)) return null;
    if (pendingStop) throw new Error('录音停止请求正在处理中');
    continuousRecordingRequested = false;

    return new Promise<RecorderStopResult>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingStop = null;
        reject(new Error('录音停止超时：30 秒内未收到 onStop 回调'));
      }, RECORDING_STOP_TIMEOUT_MS);
      pendingStop = { resolve, reject, timeoutId };
      recorderManager!.stop();
    });
  },

  async uploadRecording(clip, target) {
    const audioBytes = await readTemporaryAudio(clip.tempFilePath);
    const body = new FormData();
    body.append('file', new Blob([audioBytes], { type: 'audio/aac' }), target.fileName);
    for (const [key, value] of Object.entries(target.formData)) body.append(key, value);
    const response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`录音上传失败：HTTP ${response.status} ${detail.slice(0, 120)}`);
    }
  },

  discardRecording(clip) {
    let manager: FileSystemManager;
    try {
      manager = getConfiguredFileSystemManager();
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise<void>((resolve, reject) => {
      manager.unlink({
        filePath: clip.tempFilePath,
        success: resolve,
        fail: (error) => reject(formatError('FileSystemManager.unlink', error)),
      });
    });
  },

  destroy() {
    void this.stopLocation();
    const managerToStop = recorderManager;
    const shouldStop = isRecording || recordingRequestedAt !== null;
    recorderDestroyed = true;
    recorderGeneration += 1;
    if (pendingStop) {
      clearTimeout(pendingStop.timeoutId);
      pendingStop.reject(new Error('录音适配器已销毁'));
      pendingStop = null;
    }
    recorderManager = null;
    recorderListenersRegistered = false;
    recordingRequestedAt = null;
    recordingStartedAt = null;
    isRecording = false;
    continuousRecordingRequested = false;
    recordingObserver = null;
    lastClip = null;
    if (shouldStop && managerToStop) managerToStop.stop();
  },
};
