<script setup lang="ts">
// 轨迹页面结构；地图与轨迹数据由后续领域接口提供。
</script>

<template>
  <div class="track-page">
    <van-nav-bar title="轨迹" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <van-empty image="search" description="轨迹数据需要定位采样积累">
        <template #bottom>
          <p class="empty-hint">前台定位采样每 20 分钟一次，请保持页面活跃以积累轨迹数据。</p>
        </template>
      </van-empty>
    </div>
  </div>
</template>

<style scoped>
.track-page {
  min-height: 100vh;
}

.page-body {
  padding: 40px 0;
}

.empty-hint {
  font-size: 13px;
  color: var(--van-text-color-2);
  text-align: center;
  padding: 0 32px;
}
</style>
