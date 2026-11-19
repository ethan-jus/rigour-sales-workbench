/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** WebSocket 入口；未配置时跟随当前页面 origin 并自动切换 ws/wss。 */
  /** 录音 multipart 上传超时，默认120秒，允许15000至300000毫秒。 */
  readonly VITE_RECORDING_UPLOAD_TIMEOUT_MS: string;
  /** Vite开发代理访问的Gateway地址；仅由开发机服务端读取，手机不会直接访问该地址。 */
  readonly VITE_API_TARGET: string;
  readonly VITE_ENABLE_MOCK: string;
  readonly VITE_DEFAULT_TENANT_ID: string;
  readonly VITE_APP_ENV: string;
  /** 登录模式：平台登录使用 OIDC 与 PKCE，模拟模式仅用于开发和 CI。 */
  /** App启动后是否强制先拿到定位；未配置时原生App默认强制，浏览器按配置执行。 */
  readonly VITE_REQUIRE_LOCATION_ON_BOOT: string;
  readonly VITE_OIDC_ISSUER: string;
  readonly VITE_OIDC_CLIENT_ID: string;
  readonly VITE_OIDC_REDIRECT_URI: string;
  readonly VITE_OIDC_SCOPE: string;
  /** 高德 JS API Key 与安全密钥；未配置时轨迹页降级为时间线视图。 */
  readonly VITE_AMAP_JS_KEY: string;
  readonly VITE_AMAP_SECURITY_CODE: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
