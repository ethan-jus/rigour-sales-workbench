import { Capacitor } from '@capacitor/core';
import { mockAdapter } from '@/adapters/workbench/mock';
import { unsupportedAdapter } from '@/adapters/workbench/unsupported';
import { nativeWorkbenchCapabilities } from './native';
import type { WorkbenchCapabilities } from './types';

let overrideCapabilities: WorkbenchCapabilities | null = null;

export function getWorkbenchCapabilities(): WorkbenchCapabilities {
  if (overrideCapabilities) return overrideCapabilities;
  if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK === 'true') {
    return mockAdapter;
  }
  if (Capacitor.isNativePlatform()) return nativeWorkbenchCapabilities;
  return unsupportedAdapter;
}

export function setWorkbenchCapabilities(capabilities: WorkbenchCapabilities | null): void {
  overrideCapabilities = capabilities;
}
