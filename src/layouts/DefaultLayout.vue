<script setup lang="ts">
import { computed } from 'vue';
import { useRouter, useRoute } from 'vue-router';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const tabs = computed(() => [
  ...(authStore.isSalesUser ? [{ to: '/home', icon: 'home-o', label: '工作台' }] : []),
  ...(authStore.hasFeature('sales.attendance') ? [{ to: '/attendance', icon: 'clock-o', label: '考勤' }] : []),
  ...(authStore.hasFeature('sales.visit') ? [{ to: '/visit', icon: 'friends-o', label: '拜访' }] : []),
  ...(authStore.hasFeature('sales.track') ? [{ to: '/track', icon: 'location-o', label: '轨迹' }] : []),
  ...(authStore.hasFeature('chat') ? [{ to: '/chat', icon: 'chat-o', label: '沟通' }] : []),
  { to: '/profile', icon: 'user-o', label: '个人' },
]);

function onTabChange(path: string) {
  router.push(path);
}
</script>

<template>
  <div class="app-layout">
    <main class="app-content">
      <router-view />
    </main>
    <van-tabbar
      :model-value="route.path"
      :fixed="true"
      :border="true"
      :safe-area-inset-bottom="true"
      @change="onTabChange"
    >
      <van-tabbar-item
        v-for="tab in tabs"
        :key="tab.to"
        :name="tab.to"
        :icon="tab.icon"
      >
        {{ tab.label }}
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 540px;
  min-height: 100vh;
  margin: 0 auto;
  background: var(--van-background-2);
  box-shadow: 0 0 40px rgba(18, 33, 61, 0.08);
}

.app-content {
  flex: 1;
  padding-bottom: 50px; /* tabbar height */
  overflow-y: auto;
}

.app-layout :deep(.van-tabbar) {
  right: auto;
  left: 50%;
  width: 100%;
  max-width: 540px;
  transform: translateX(-50%);
}
</style>
