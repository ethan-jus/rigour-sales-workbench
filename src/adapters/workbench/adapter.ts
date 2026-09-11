import { Capacitor } from '@capacitor/core';
import { getFeishuAdapter } from '@/adapters/feishu/adapter';
import { mockAdapter } from '@/adapters/feishu/mock';
import { unsupportedAdapter } from '@/adapters/feishu/unsupported';
import { nativeWorkbenchCapabilities } from './native';
import type { WorkbenchCapabilities } from './types';

let overrideCapabilities: WorkbenchCapabilities | null = null;

function withRuntimeLabel(
  capabilities: WorkbenchCapabilities,
  runtimeLabel: WorkbenchCapabilities['getRuntimeLabel'] extends () => infer R ? R : never,
): WorkbenchCapabilities {
  return {
    ...capabilities,
    getRuntimeLabel: () => runtimeLabel,
  };
}

export function getWorkbenchCapabilities(): WorkbenchCapabilities {
  if (overrideCapabilities) return overrideCapabilities;
  if (import.meta.env.VITE_FEISHU_MOCK === 'true') {
    return withRuntimeLabel(mockAdapter as unknown as WorkbenchCapabilities, 'mock');
  }
  if (Capacitor.isNativePlatform()) return nativeWorkbenchCapabilities;
  const authMode = import.meta.env.VITE_AUTH_MODE || 'feishu';
  if (authMode !== 'oidc') {
    return withRuntimeLabel(getFeishuAdapter() as unknown as WorkbenchCapabilities, 'feishu');
  }
  return withRuntimeLabel(unsupportedAdapter as unknown as WorkbenchCapabilities, 'unsupported');
}

export function setWorkbenchCapabilities(capabilities: WorkbenchCapabilities | null): void {
  overrideCapabilities = capabilities;
}
