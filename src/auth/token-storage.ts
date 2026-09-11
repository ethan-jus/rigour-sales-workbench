import { Capacitor } from '@capacitor/core';
import { KeychainAccess, SecureStorage } from '@aparajita/capacitor-secure-storage';

const TOKEN_KEY = 'auth_token';
const KEY_PREFIX = 'rigour_workbench_';

let cachedToken: string | null = null;
let initialized = false;

function isNativeSecureStorage(): boolean {
  return Capacitor.isNativePlatform();
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  initialized = true;
  await SecureStorage.setKeyPrefix(KEY_PREFIX);
  await SecureStorage.setDefaultKeychainAccess(KeychainAccess.whenUnlockedThisDeviceOnly);
}

export function getCachedAuthToken(): string | null {
  return cachedToken || localStorage.getItem(TOKEN_KEY);
}

export async function getAuthToken(): Promise<string | null> {
  if (cachedToken) return cachedToken;
  if (!isNativeSecureStorage()) {
    cachedToken = localStorage.getItem(TOKEN_KEY);
    return cachedToken;
  }
  await ensureInitialized();
  const token = await SecureStorage.getItem(TOKEN_KEY);
  cachedToken = token;
  return token;
}

export async function setAuthToken(token: string): Promise<void> {
  cachedToken = token;
  if (isNativeSecureStorage()) {
    await ensureInitialized();
    await SecureStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(TOKEN_KEY);
    return;
  }
  localStorage.setItem(TOKEN_KEY, token);
}

export function setLegacyAuthToken(token: string): void {
  cachedToken = token;
  localStorage.setItem(TOKEN_KEY, token);
  if (isNativeSecureStorage()) void setAuthToken(token);
}

export async function clearAuthToken(): Promise<void> {
  cachedToken = null;
  localStorage.removeItem(TOKEN_KEY);
  if (!isNativeSecureStorage()) return;
  await ensureInitialized();
  await SecureStorage.removeItem(TOKEN_KEY);
}

export function clearLegacyAuthToken(): void {
  cachedToken = null;
  localStorage.removeItem(TOKEN_KEY);
  if (isNativeSecureStorage()) void clearAuthToken();
}
