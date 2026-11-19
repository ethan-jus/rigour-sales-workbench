import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { detectRuntimeContainer } from '@/adapters';
import type { RuntimeEnv } from '@/types';

export const useAppStore = defineStore('app', () => {
  /** 工作台运行环境 */
  const env = ref<RuntimeEnv>(detectRuntimeContainer());
  /** 启动流程是否已完成 */
  const bootstrapReady = ref(false);
  /** 启动失败时的错误信息 */
  const bootstrapError = ref<string | null>(null);

  /** 是否运行在 Mock 模式（浏览器/CI 环境） */
  const isMockMode = computed(() => env.value.mockMode);
  const containerLabel = computed(() => env.value.mockMode ? 'Mock (浏览器)' :
    env.value.container === 'native-app' ? '销售作业 App' : '浏览器');

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
    containerLabel,
    setBootstrapReady,
    setBootstrapError,
  };
});
