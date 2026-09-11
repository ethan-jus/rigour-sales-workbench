import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';

const OIDC_PENDING_KEY = 'rigour_oidc_pkce_pending';

interface OidcDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
}

interface OidcPending {
  state: string;
  nonce: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
}

interface OidcTokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

interface OidcUserInfo {
  sub?: string;
  name?: string;
  preferred_username?: string;
  picture?: string;
  tenant_id?: string;
  tenantId?: string;
}

export interface MobileOidcSession {
  token: string;
  user: {
    userId: string;
    name: string;
    avatar?: string;
    tenantId?: string;
  };
}

function requiredEnv(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} 未配置，无法执行移动端 OIDC 登录`);
  return value.replace(/\/$/, '');
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return base64Url(values);
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(token: string | undefined): Record<string, unknown> {
  if (!token) return {};
  const [, payload] = token.split('.');
  if (!payload) return {};
  try {
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='));
    return JSON.parse(decodeURIComponent(Array.from(decoded)
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
      .join(''))) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function discovery(): Promise<OidcDiscovery> {
  const issuer = requiredEnv(import.meta.env.VITE_OIDC_ISSUER, 'VITE_OIDC_ISSUER');
  const response = await fetch(`${issuer}/.well-known/openid-configuration`);
  if (!response.ok) throw new Error(`OIDC discovery 失败: HTTP ${response.status}`);
  const body = await response.json() as Partial<OidcDiscovery>;
  if (!body.authorization_endpoint || !body.token_endpoint) {
    throw new Error('OIDC discovery 响应缺少 authorization_endpoint/token_endpoint');
  }
  return {
    authorization_endpoint: body.authorization_endpoint,
    token_endpoint: body.token_endpoint,
    userinfo_endpoint: body.userinfo_endpoint,
  };
}

function callbackParams(url: URL): URLSearchParams {
  if (url.searchParams.size > 0) return url.searchParams;
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  const queryStart = hash.indexOf('?');
  return new URLSearchParams(queryStart >= 0 ? hash.slice(queryStart + 1) : hash);
}

function storedPending(): OidcPending | null {
  const raw = sessionStorage.getItem(OIDC_PENDING_KEY) || localStorage.getItem(OIDC_PENDING_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OidcPending;
  } catch {
    return null;
  }
}

function persistPending(pending: OidcPending) {
  const value = JSON.stringify(pending);
  sessionStorage.setItem(OIDC_PENDING_KEY, value);
  localStorage.setItem(OIDC_PENDING_KEY, value);
}

function clearPending() {
  sessionStorage.removeItem(OIDC_PENDING_KEY);
  localStorage.removeItem(OIDC_PENDING_KEY);
}

async function exchangeCode(
  oidc: OidcDiscovery,
  code: string,
  pending: OidcPending,
): Promise<MobileOidcSession> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: requiredEnv(import.meta.env.VITE_OIDC_CLIENT_ID, 'VITE_OIDC_CLIENT_ID'),
    redirect_uri: pending.redirectUri,
    code,
    code_verifier: pending.codeVerifier,
  });
  const tokenResponse = await fetch(oidc.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!tokenResponse.ok) throw new Error(`OIDC token 交换失败: HTTP ${tokenResponse.status}`);
  const tokenBody = await tokenResponse.json() as OidcTokenResponse;
  if (!tokenBody.access_token) throw new Error('OIDC token 响应缺少 access_token');

  let userInfo: OidcUserInfo = {};
  if (oidc.userinfo_endpoint) {
    const userResponse = await fetch(oidc.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokenBody.access_token}` },
    });
    if (userResponse.ok) userInfo = await userResponse.json() as OidcUserInfo;
  }
  const claims = decodeJwtPayload(tokenBody.id_token || tokenBody.access_token);
  const userId = userInfo.sub || (typeof claims.sub === 'string' ? claims.sub : '');
  if (!userId) throw new Error('OIDC 用户信息缺少 sub');
  return {
    token: tokenBody.access_token,
    user: {
      userId,
      name: userInfo.name
        || userInfo.preferred_username
        || (typeof claims.name === 'string' ? claims.name : '')
        || `用户-${userId.slice(0, 8)}`,
      avatar: userInfo.picture || (typeof claims.picture === 'string' ? claims.picture : undefined),
      tenantId: userInfo.tenant_id
        || userInfo.tenantId
        || (typeof claims.tenant_id === 'string' ? claims.tenant_id : undefined)
        || (typeof claims.tenantId === 'string' ? claims.tenantId : undefined),
    },
  };
}

async function completeCallbackUrl(callbackUrl: URL): Promise<MobileOidcSession> {
  const params = callbackParams(callbackUrl);
  const pending = storedPending();
  if (!pending) throw new Error('OIDC 登录状态已丢失，请重新登录');
  if (Date.now() - pending.createdAt > 10 * 60_000) {
    clearPending();
    throw new Error('OIDC 登录状态已过期，请重新登录');
  }
  if (params.get('state') !== pending.state) throw new Error('OIDC state 校验失败');
  const error = params.get('error');
  if (error) throw new Error(`OIDC 授权失败: ${error}`);
  const code = params.get('code');
  if (!code) throw new Error('OIDC 回调缺少 code');
  const oidc = await discovery();
  const session = await exchangeCode(oidc, code, pending);
  clearPending();
  return session;
}

async function waitNativeCallback(expectedState: string): Promise<URL> {
  let timeoutId = 0;
  const handle = await App.addListener('appUrlOpen', (event) => {
    const url = new URL(event.url);
    const params = callbackParams(url);
    if (params.get('state') === expectedState) {
      window.dispatchEvent(new CustomEvent('rigour-oidc-callback', { detail: event.url }));
    }
  });

  return new Promise<URL>((resolve, reject) => {
    const listener = (event: Event) => {
      const callbackUrl = new URL((event as CustomEvent<string>).detail);
      cleanup();
      resolve(callbackUrl);
    };
    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('rigour-oidc-callback', listener);
      void handle.remove();
      void Browser.close();
    };
    window.addEventListener('rigour-oidc-callback', listener);
    timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('OIDC 登录超时，请重试'));
    }, 120_000);
  });
}

export async function loginWithMobileOidc(): Promise<MobileOidcSession> {
  const currentUrl = new URL(window.location.href);
  if (currentUrl.searchParams.has('code') || currentUrl.hash.includes('code=')) {
    const session = await completeCallbackUrl(currentUrl);
    const cleanHash = currentUrl.hash.startsWith('#/')
      ? currentUrl.hash.split('?')[0]
      : '#/home';
    window.history.replaceState({}, document.title, `${currentUrl.origin}${currentUrl.pathname}${cleanHash}`);
    return session;
  }

  const oidc = await discovery();
  const redirectUri = import.meta.env.VITE_OIDC_REDIRECT_URI || `${window.location.origin}${window.location.pathname}`;
  const codeVerifier = randomToken(48);
  const state = randomToken(24);
  const nonce = randomToken(24);
  const pending: OidcPending = { state, nonce, codeVerifier, redirectUri, createdAt: Date.now() };
  persistPending(pending);

  const authorizeUrl = new URL(oidc.authorization_endpoint);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', requiredEnv(import.meta.env.VITE_OIDC_CLIENT_ID, 'VITE_OIDC_CLIENT_ID'));
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('scope', import.meta.env.VITE_OIDC_SCOPE || 'openid profile');
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('nonce', nonce);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('code_challenge', await sha256Base64Url(codeVerifier));

  if (Capacitor.isNativePlatform()) {
    const callbackPromise = waitNativeCallback(state);
    await Browser.open({ url: authorizeUrl.toString(), presentationStyle: 'fullscreen' });
    return completeCallbackUrl(await callbackPromise);
  }

  window.location.assign(authorizeUrl.toString());
  return new Promise<MobileOidcSession>(() => {
    // 当前页面即将跳转；Promise 在回调页重新加载后由上面的 completeCallbackUrl 完成。
  });
}
