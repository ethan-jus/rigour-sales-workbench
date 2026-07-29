<script setup lang="ts">
import { useAppStore } from '@/stores/app';
import DefaultLayout from '@/layouts/DefaultLayout.vue';

const appStore = useAppStore();

function handleRetry() {
  window.location.reload();
}
</script>

<template>
  <div v-if="appStore.bootstrapError && !appStore.bootstrapReady" class="bootstrap-error">
    <van-empty image="error" :description="appStore.bootstrapError">
      <template #bottom>
        <van-button type="primary" @click="handleRetry">重试</van-button>
      </template>
    </van-empty>
  </div>

  <DefaultLayout v-else-if="appStore.bootstrapReady" />

  <div v-else class="bootstrap-loading">
    <van-loading type="spinner" size="32" />
    <p>正在初始化…</p>
  </div>
</template>

<style scoped>
.bootstrap-error,
.bootstrap-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  flex-direction: column;
  gap: 12px;
}
</style>
