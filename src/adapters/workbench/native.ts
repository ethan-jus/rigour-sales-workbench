import { App } from '@capacitor/app';
import type { PluginListenerHandle } from '@capacitor/core';
import { Capacitor } from '@capacitor/core';
import { Camera, CameraDirection, EncodingType } from '@capacitor/camera';
import { Geolocation, type CallbackID, type Position } from '@capacitor/geolocation';
import { VoiceRecorder } from '@independo/capacitor-voice-recorder';
import { uploadRecordingMultipart } from '@/adapters/feishu/recording-upload';
import type { CapturedPhoto } from '@/adapters/feishu/types';
import type { CapabilityStatus } from '@/types';
import type { LocationTrackingOptions, WorkbenchCapabilities } from './types';

const DEFAULT_LOCATION_INTERVAL_MS = 20 * 60 * 1000;
const LOCATION_TIMEOUT_MS = 15_000;
const nativeRecordingBlobs = new Map<string, Blob>();
const nativePhotoBlobs = new Map<string, Blob>();

let locationWatchId: CallbackID | null = null;
let locationTimer: ReturnType<typeof setInterval> | null = null;
let appStateHandle: PluginListenerHandle | null = null;
let recordingStartedAt: number | null = null;
let recordingSequence = 0;
let photoSequence = 0;

function normalizePosition(position: Position) {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Math.max(0, position.coords.accuracy || 0),
    timestamp: position.timestamp || Date.now(),
  };
}

async function ensureLocationPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) throw new Error('当前环境不是 iOS/Android App，无法使用原生定位');
  try {
    const current = await Geolocation.checkPermissions();
    if (current.location === 'granted') return;
  } catch (error) {
    throw new Error(`系统定位服务不可用，请先在系统设置中开启定位：${error instanceof Error ? error.message : '未知错误'}`, {
      cause: error,
    });
  }
  const requested = await Geolocation.requestPermissions({ permissions: ['location'] });
  if (requested.location !== 'granted') {
    throw new Error('必须允许定位权限后才能使用门户工作台');
  }
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'audio/mp4' });
}

async function blobFromNativePath(path: string, fallbackMimeType: string): Promise<Blob> {
  const webPath = Capacitor.convertFileSrc(path);
  const response = await fetch(webPath);
  if (!response.ok) throw new Error(`读取原生临时文件失败：HTTP ${response.status}`);
  const blob = await response.blob();
  return blob.type ? blob : new Blob([blob], { type: fallbackMimeType });
}

function formDataWithFile(file: Blob, fileName: string, fields: Record<string, string>): FormData {
  const body = new FormData();
  body.append('file', file, fileName);
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  return body;
}

async function pollLocation(
  onPoint: (point: { latitude: number; longitude: number; accuracy: number; timestamp: number }) => void,
  onInterrupted: () => void,
): Promise<void> {
  try {
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: LOCATION_TIMEOUT_MS,
      maximumAge: 0,
    });
    onPoint(normalizePosition(position));
  } catch (error) {
    console.warn('[NativeCapabilities] 定位采样失败', error);
    onInterrupted();
  }
}

export const nativeWorkbenchCapabilities: WorkbenchCapabilities = {
  getRuntimeLabel() {
    return 'native-app';
  },

  getLocationStatus(): CapabilityStatus {
    return Capacitor.isNativePlatform() ? 'ready' : 'unsupported';
  },

  async getCurrentLocation() {
    await ensureLocationPermission();
    const position = await Geolocation.getCurrentPosition({
      enableHighAccuracy: true,
      timeout: LOCATION_TIMEOUT_MS,
      maximumAge: 0,
    });
    return normalizePosition(position);
  },

  async startLocation(onPoint, onInterrupted, options?: LocationTrackingOptions) {
    await ensureLocationPermission();
    await this.stopLocation();
    const intervalMs = Math.max(30_000, options?.intervalMs || DEFAULT_LOCATION_INTERVAL_MS);

    await pollLocation(onPoint, onInterrupted);

    locationWatchId = await Geolocation.watchPosition({
      enableHighAccuracy: true,
      timeout: LOCATION_TIMEOUT_MS,
      maximumAge: 0,
      minimumUpdateInterval: intervalMs,
      interval: intervalMs,
    }, (position, error) => {
      if (error || !position) {
        console.warn('[NativeCapabilities] watchPosition 中断', error);
        onInterrupted();
        return;
      }
      onPoint(normalizePosition(position));
    });

    locationTimer = setInterval(() => {
      void pollLocation(onPoint, onInterrupted);
    }, intervalMs);

    appStateHandle = await App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) void pollLocation(onPoint, onInterrupted);
      else onInterrupted();
    });
  },

  async stopLocation() {
    if (locationTimer) {
      clearInterval(locationTimer);
      locationTimer = null;
    }
    if (locationWatchId) {
      await Geolocation.clearWatch({ id: locationWatchId }).catch(() => undefined);
      locationWatchId = null;
    }
    if (appStateHandle) {
      await appStateHandle.remove();
      appStateHandle = null;
    }
  },

  getAudioStatus(): CapabilityStatus {
    return Capacitor.isNativePlatform() ? 'ready' : 'unsupported';
  },

  async startRecording() {
    if (!Capacitor.isNativePlatform()) throw new Error('当前环境不是 iOS/Android App，无法使用原生录音');
    const supported = await VoiceRecorder.canDeviceVoiceRecord();
    if (!supported.value) throw new Error('当前设备不支持录音');
    const permission = await VoiceRecorder.hasAudioRecordingPermission();
    if (!permission.value) {
      const requested = await VoiceRecorder.requestAudioRecordingPermission();
      if (!requested.value) throw new Error('必须允许麦克风权限后才能录制拜访录音');
    }
    const status = await VoiceRecorder.getCurrentStatus();
    if (status.status === 'RECORDING') return;
    recordingStartedAt = Date.now();
    await VoiceRecorder.startRecording();
  },

  async stopRecording() {
    const status = await VoiceRecorder.getCurrentStatus();
    if (status.status !== 'RECORDING' && status.status !== 'PAUSED') return null;
    const stopped = await VoiceRecorder.stopRecording();
    const endedAt = Date.now();
    const mimeType = stopped.value.mimeType || 'audio/mp4';
    const recordedValue = stopped.value as typeof stopped.value & { path?: string };
    let blob: Blob;
    if (recordedValue.recordDataBase64) {
      blob = base64ToBlob(recordedValue.recordDataBase64, mimeType);
    } else if (recordedValue.uri || recordedValue.path) {
      blob = await blobFromNativePath(recordedValue.uri || recordedValue.path!, mimeType);
    } else {
      throw new Error('原生录音未返回可上传的音频数据');
    }
    recordingSequence += 1;
    const startedAt = recordingStartedAt ?? endedAt - Math.max(0, stopped.value.msDuration || 0);
    const localClipId = `native-clip-${startedAt}-${recordingSequence}`;
    nativeRecordingBlobs.set(localClipId, blob);
    recordingStartedAt = null;
    return {
      localClipId,
      tempFilePath: `native://recordings/${localClipId}`,
      duration: Math.max(0, stopped.value.msDuration || endedAt - startedAt),
      startedAt,
      endedAt,
    };
  },

  async uploadRecording(clip, target) {
    const blob = nativeRecordingBlobs.get(clip.localClipId);
    if (!blob) throw new Error('本地录音片段已丢失，请重新录制');
    await uploadRecordingMultipart(target.url, {
      method: 'POST',
      headers: target.headers,
      body: formDataWithFile(blob, target.fileName, target.formData),
    }, target.headers['X-Request-Id']);
  },

  async discardRecording(clip) {
    nativeRecordingBlobs.delete(clip.localClipId);
  },

  getCameraStatus(): CapabilityStatus {
    return Capacitor.isNativePlatform() ? 'ready' : 'unsupported';
  },

  async captureStorefrontPhoto(): Promise<CapturedPhoto> {
    if (!Capacitor.isNativePlatform()) throw new Error('当前环境不是 iOS/Android App，无法使用原生相机');
    const permission = await Camera.requestPermissions({ permissions: ['camera'] });
    if (permission.camera !== 'granted') throw new Error('必须允许相机权限后才能拍摄门头照');
    const captured = await Camera.takePhoto({
      quality: 82,
      encodingType: EncodingType.JPEG,
      saveToGallery: false,
      cameraDirection: CameraDirection.Rear,
      correctOrientation: true,
    });
    const path = captured.webPath || (captured.uri ? Capacitor.convertFileSrc(captured.uri) : null);
    if (!path) throw new Error('原生相机未返回照片路径');
    const response = await fetch(path);
    if (!response.ok) throw new Error(`读取原生照片失败：HTTP ${response.status}`);
    const blob = await response.blob();
    photoSequence += 1;
    const capturedAt = Date.now();
    const localPhotoId = `native-photo-${capturedAt}-${photoSequence}`;
    nativePhotoBlobs.set(localPhotoId, blob.type ? blob : new Blob([blob], { type: 'image/jpeg' }));
    return {
      localPhotoId,
      tempFilePath: `native://photos/${localPhotoId}.jpg`,
      capturedAt,
    };
  },

  async uploadPhoto(photo, target) {
    const blob = nativePhotoBlobs.get(photo.localPhotoId);
    if (!blob) throw new Error('本地门头照片已丢失，请重新拍摄');
    const response = await fetch(target.url, {
      method: 'POST',
      headers: target.headers,
      body: formDataWithFile(blob, target.fileName, target.formData),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`门头照上传失败：HTTP ${response.status} ${detail.slice(0, 120)}`);
    }
  },

  async discardPhoto(photo) {
    nativePhotoBlobs.delete(photo.localPhotoId);
  },

  destroy() {
    void this.stopLocation();
    nativeRecordingBlobs.clear();
    nativePhotoBlobs.clear();
    recordingStartedAt = null;
  },
};
