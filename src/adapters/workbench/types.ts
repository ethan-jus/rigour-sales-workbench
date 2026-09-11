import type { CapabilityStatus } from '@/types';
import type {
  CapturedPhoto,
  PhotoUploadRequest,
  RecorderStopResult,
  RecordingObserver,
  RecordingUploadRequest,
} from '@/adapters/feishu/types';

export interface LocationTrackingOptions {
  intervalMs?: number;
}

export interface WorkbenchCapabilities {
  getRuntimeLabel(): 'native-app' | 'feishu' | 'mock' | 'unsupported';

  getLocationStatus(): CapabilityStatus;
  getCurrentLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy: number;
    timestamp: number;
  }>;
  startLocation(
    onPoint: (point: { latitude: number; longitude: number; accuracy: number; timestamp: number }) => void,
    onInterrupted: () => void,
    options?: LocationTrackingOptions,
  ): Promise<void>;
  stopLocation(): Promise<void>;

  getAudioStatus(): CapabilityStatus;
  startRecording(observer?: RecordingObserver): void | Promise<void>;
  stopRecording(): Promise<RecorderStopResult | null>;
  uploadRecording(clip: RecorderStopResult, target: RecordingUploadRequest): Promise<void>;
  discardRecording(clip: RecorderStopResult): Promise<void>;

  getCameraStatus(): CapabilityStatus;
  captureStorefrontPhoto(): Promise<CapturedPhoto>;
  uploadPhoto(photo: CapturedPhoto, target: PhotoUploadRequest): Promise<void>;
  discardPhoto(photo: CapturedPhoto): Promise<void>;

  destroy(): void;
}
