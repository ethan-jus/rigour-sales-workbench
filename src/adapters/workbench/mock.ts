import type { WorkbenchCapabilities } from './types';
import type { CapabilityStatus } from '@/types';
import { uploadRecordingMultipart } from './recording-upload';

let locationTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let isRecording = false;
let recordingStartedAt = 0;
let photoSequence = 0;

export const mockAdapter: WorkbenchCapabilities = {
  getRuntimeLabel() { return 'mock'; },

  getLocationStatus(): CapabilityStatus {
    return 'ready';
  },

  async getCurrentLocation() {
    return {
      latitude: 39.9042 + Math.random() * 0.01,
      longitude: 116.4074 + Math.random() * 0.01,
      accuracy: 15,
      timestamp: Date.now(),
    };
  },

  async startLocation(onPoint, onInterrupted) {
    // 模拟初次定位
    onPoint(await this.getCurrentLocation());

    // 测试期间每 30 秒模拟一次定位，便于开发观察
    // 生产定位使用原生设备能力
    locationTimer = setInterval(() => {
      void this.getCurrentLocation().then(onPoint);
    }, 30_000);

    visibilityHandler = () => {
      if (document.visibilityState === 'hidden') {
        onInterrupted();
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

  // =========================================================================
  // 录音：模拟 RecorderManager 生命周期
  // =========================================================================
  getAudioStatus(): CapabilityStatus {
    return 'ready';
  },

  startRecording() {
    // 重复调用：忽略
    if (isRecording) {
      console.warn('[Mock] 已在录音中，忽略重复 startRecording');
      return;
    }
    isRecording = true;
    recordingStartedAt = Date.now();
    console.log('[Mock] 录音已开始');
  },

  async stopRecording() {
    if (!isRecording) return null;
    isRecording = false;
    const now = Date.now();
    return {
      localClipId: `mock-local-${recordingStartedAt}`,
      tempFilePath: `mock://recordings/${recordingStartedAt}.aac`,
      /** 与真实 Adapter 一致：duration 单位为毫秒。 */
      duration: Math.max(0, now - recordingStartedAt),
      startedAt: recordingStartedAt,
      endedAt: now,
    };
  },

  async uploadRecording(clip, target) {
    // 浏览器没有真实音频字节：生成与真实链路一致的 multipart 请求，
    // 让 Mock 模式也能验证服务端上传、登记和会话聚合。
    const body = new FormData();
    const pseudoAudio = new Blob([`mock-audio-${clip.localClipId}-${clip.duration}`], {
      type: 'audio/m4a',
    });
    body.append('file', pseudoAudio, target.fileName);
    for (const [key, value] of Object.entries(target.formData)) {
      body.append(key, value);
    }
    await uploadRecordingMultipart(target.url, {
      method: 'POST',
      headers: target.headers,
      body,
    }, target.headers['X-Request-Id']);
    console.log('[Mock] 录音片段已上传', target.url);
  },

  async discardRecording() {
    // Mock 没有真实临时文件；短录音只由页面登记元数据。
  },

  getCameraStatus(): CapabilityStatus {
    return 'ready';
  },

  async captureStorefrontPhoto() {
    photoSequence += 1;
    const capturedAt = Date.now();
    return {
      localPhotoId: `mock-photo-${capturedAt}-${photoSequence}`,
      tempFilePath: `mock://photos/${capturedAt}-${photoSequence}.jpg`,
      capturedAt,
    };
  },

  async uploadPhoto(photo, target) {
    const body = new FormData();
    // JPEG SOI/EOI 包裹最小伪数据，保证本地链路可验证服务端文件签名。
    const pseudoPhoto = new Blob([
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      `mock-storefront-${photo.localPhotoId}`,
      new Uint8Array([0xff, 0xd9]),
    ], { type: 'image/jpeg' });
    body.append('file', pseudoPhoto, target.fileName);
    for (const [key, value] of Object.entries(target.formData)) body.append(key, value);
    const response = await fetch(target.url, {
      method: 'POST', headers: target.headers, body,
    });
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`门头照上传失败：HTTP ${response.status} ${detail.slice(0, 120)}`);
    }
  },

  async discardPhoto() {
    // Mock 没有真实临时文件。
  },

  destroy() {
    this.stopLocation();
    isRecording = false;
    recordingStartedAt = 0;
    photoSequence = 0;
  },
};
