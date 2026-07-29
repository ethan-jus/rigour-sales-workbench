<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { getFeishuAdapter } from '@/adapters';
import type { CapabilityStatus } from '@/types';

const locationStatus = ref<CapabilityStatus>('idle');
const points = ref<{ latitude: number; longitude: number; accuracy: number; timestamp: number }[]>([]);
const interruptionCount = ref(0);

let adapter = getFeishuAdapter();

onMounted(() => {
  adapter = getFeishuAdapter();
  locationStatus.value = adapter.getLocationStatus();

  adapter
    .startLocation(
      (point) => {
        points.value.push(point);
        locationStatus.value = 'active';
      },
      () => {
        interruptionCount.value++;
        locationStatus.value = 'interrupted';
      },
    )
    .catch(() => {
      locationStatus.value = 'failed';
    });
});

onUnmounted(() => {
  adapter.stopLocation();
});
</script>

<template>
  <div class="attendance-page">
    <van-nav-bar title="考勤" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <van-cell-group inset>
        <van-cell title="定位状态" :value="locationStatus" />
        <van-cell title="采样点数" :value="String(points.length)" />
        <van-cell title="中断次数" :value="String(interruptionCount)" />
      </van-cell-group>

      <div class="notice">
        <van-notice-bar
          left-icon="info-o"
          text="定位中断仅作为记录，不单独作为考勤异常判定依据。"
          wrapable
        />
      </div>

      <van-cell-group inset title="定位记录">
        <van-cell
          v-for="(pt, i) in points.slice(-10)"
          :key="i"
          :title="`${pt.latitude.toFixed(6)}, ${pt.longitude.toFixed(6)}`"
          :label="`精度 ${pt.accuracy}m · ${new Date(pt.timestamp).toLocaleTimeString()}`"
        />
        <van-cell v-if="points.length === 0" title="暂无定位记录" />
      </van-cell-group>
    </div>
  </div>
</template>

<style scoped>
.attendance-page {
  min-height: 100vh;
}

.page-body {
  padding: 12px 0;
}

.notice {
  margin: 12px 0;
}
</style>
