/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_ENABLE_MOCK: string;
  readonly VITE_DEFAULT_TENANT_ID: string;
  readonly VITE_APP_ENV: string;
  /** 飞书自建应用 App ID；requestAccess 使用 appID，旧 requestAuthCode 使用 appId。 */
  readonly VITE_FEISHU_APP_ID: string;
  /**
   * 飞书 Mock 模式开关。
   * true: 使用 mockAdapter（开发/CI）
   * false: 生产模式，非飞书容器使用 unsupportedAdapter 阻断
   */
  readonly VITE_FEISHU_MOCK: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
