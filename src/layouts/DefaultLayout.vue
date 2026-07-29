<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const tabs = [
  { to: '/home', icon: 'home-o', label: '工作台' },
  { to: '/attendance', icon: 'clock-o', label: '考勤' },
  { to: '/visit', icon: 'friends-o', label: '拜访' },
  { to: '/track', icon: 'location-o', label: '轨迹' },
  { to: '/delivery', icon: 'logistics', label: '配送' },
  { to: '/profile', icon: 'user-o', label: '个人' },
] as const;

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
  min-height: 100vh;
  background: var(--van-background-2);
}

.app-content {
  flex: 1;
  padding-bottom: 50px; /* tabbar height */
  overflow-y: auto;
}
</style>
