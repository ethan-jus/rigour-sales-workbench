/**
 * 高德 JS API 动态加载器。
 * Key 与安全密钥通过 VITE_AMAP_JS_KEY / VITE_AMAP_SECURITY_CODE 注入；
 * 未配置时页面降级为时间序列表，不阻塞轨迹事实展示。
 */

declare global {
  interface Window {
    _AMapSecurityConfig?: { securityJsCode: string };
    AMap?: AmapNamespace;
  }
}

export interface AmapMapInstance {
  add(overlay: unknown): void;
  setFitView(overlays?: unknown[]): void;
  resize(): void;
  destroy(): void;
}

export interface AmapOverlayInstance {
  on?(event: string, handler: () => void): void;
}

export interface AmapNamespace {
  Map: new (
    container: HTMLElement,
    options: { zoom?: number; center?: [number, number]; viewMode?: string; mapStyle?: string },
  ) => AmapMapInstance;
  Polyline: new (options: {
    path: [number, number][];
    strokeColor?: string;
    strokeWeight?: number;
    strokeOpacity?: number;
    lineJoin?: string;
    showDir?: boolean;
  }) => AmapOverlayInstance;
  Marker: new (options: {
    position: [number, number];
    title?: string;
    content?: string | HTMLElement;
    anchor?: string;
    zIndex?: number;
    label?: { content: string | HTMLElement; direction: string };
  }) => AmapOverlayInstance;
}

const AMAP_SCRIPT_ID = 'rigour-amap-jsapi';
const AMAP_SCRIPT_URL = 'https://webapi.amap.com/maps?v=2.0&plugin=AMap.MoveAnimation&key=';

let loadPromise: Promise<AmapNamespace> | null = null;

export function isAmapConfigured(): boolean {
  return Boolean(import.meta.env.VITE_AMAP_JS_KEY && import.meta.env.VITE_AMAP_SECURITY_CODE);
}

export function loadAmap(): Promise<AmapNamespace> {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (loadPromise) return loadPromise;
  loadPromise = new Promise<AmapNamespace>((resolve, reject) => {
    const key = import.meta.env.VITE_AMAP_JS_KEY;
    const securityCode = import.meta.env.VITE_AMAP_SECURITY_CODE;
    if (!key || !securityCode) {
      reject(new Error('未配置高德地图 Key'));
      return;
    }
    window._AMapSecurityConfig = { securityJsCode: securityCode };
    const existing = document.getElementById(AMAP_SCRIPT_ID);
    if (existing) {
      existing.addEventListener('load', () => resolveOnce(resolve, reject), { once: true });
      existing.addEventListener('error', () => rejectOnce(reject), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.id = AMAP_SCRIPT_ID;
    script.src = `${AMAP_SCRIPT_URL}${encodeURIComponent(key)}`;
    script.async = true;
    script.onload = () => resolveOnce(resolve, reject);
    script.onerror = () => rejectOnce(reject);
    document.head.appendChild(script);
  });
  return loadPromise;
}

function resolveOnce(
  resolve: (value: AmapNamespace) => void,
  reject: (reason: Error) => void,
): void {
  if (window.AMap) {
    resolve(window.AMap);
  } else {
    reject(new Error('高德地图脚本加载后 window.AMap 不可用'));
  }
}

function rejectOnce(reject: (reason: Error) => void): void {
  loadPromise = null;
  reject(new Error('高德地图脚本加载失败'));
}
