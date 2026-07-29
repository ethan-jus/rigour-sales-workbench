import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { detectRuntimeContainer } from '@/adapters';
import type { RuntimeEnv } from '@/types';

/**
 * 应用全局状态。
 *
 * 职责：
 * - 存储飞书运行环境检测结果（容器类型、JSAPI 可用性、Mock 模式）
 * - 跟踪 bootstrap 启动流程状态（就绪/错误）
 * - 提供派生标签供页面层展示
 *
 * 风险：env 在 store 创建时同步调用 detectRuntimeContainer()，
 * 因此必须在 Pinia 安装后、bootstrap 执行前创建此 store。
 */
export const useAppStore = defineStore('app', () => {
  /** 飞书运行环境检测结果（容器、版本、JSAPI、Mock 模式） */
  const env = ref<RuntimeEnv>(detectRuntimeContainer());
  /** 启动流程是否已完成 */
  const bootstrapReady = ref(false);
  /** 启动失败时的错误信息 */
  const bootstrapError = ref<string | null>(null);

  /** 是否运行在 Mock 模式（浏览器/CI 环境） */
  const isMockMode = computed(() => env.value.mockMode);
  /** 是否在真实飞书环境中（非 Mock） */
  const isFeishuEnv = computed(() => env.value.container !== 'unknown' && !env.value.mockMode);
  /** 用户可读的容器标签 */
  const containerLabel = computed(() => {
    if (env.value.mockMode) return 'Mock (浏览器)';
    if (env.value.container === 'feishu') return '飞书';
    if (env.value.container === 'lark') return 'Lark';
    return '未知环境';
  });

  function setBootstrapReady() {
    bootstrapReady.value = true;
  }

  function setBootstrapError(msg: string) {
    bootstrapError.value = msg;
  }

  return {
    env,
    bootstrapReady,
    bootstrapError,
    isMockMode,
    isFeishuEnv,
    containerLabel,
    setBootstrapReady,
    setBootstrapError,
  };
});
