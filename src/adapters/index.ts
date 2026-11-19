import { Capacitor } from '@capacitor/core';
import type { RuntimeEnv } from '@/types';

export function detectRuntimeContainer(): RuntimeEnv {
  return {
    container: Capacitor.isNativePlatform() ? 'native-app' : 'browser',
    mockMode: import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true',
  };
}
export type { RecorderStopResult } from './workbench/media';
export { mockAdapter } from './workbench/mock';
export { unsupportedAdapter } from './workbench/unsupported';
