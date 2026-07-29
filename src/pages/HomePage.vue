<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';

const authStore = useAuthStore();
</script>

<template>
  <div class="home-page">
    <van-nav-bar title="工作台" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <van-cell-group inset>
        <van-cell title="当前用户" :value="authStore.userName || '未登录'" />
      </van-cell-group>

      <van-grid :column-num="3" :gutter="8" class="quick-grid">
        <van-grid-item icon="clock-o" text="今日考勤" to="/attendance" />
        <van-grid-item icon="friends-o" text="拜访记录" to="/visit" />
        <van-grid-item icon="location-o" text="轨迹查看" to="/track" />
        <van-grid-item icon="logistics" text="配送跟进" to="/delivery" />
        <van-grid-item icon="chart-trending-o" text="销售战报" />
        <van-grid-item icon="user-o" text="个人中心" to="/profile" />
      </van-grid>

      <div class="footer-hint">
        <van-divider />
        <p class="hint-text">瑞盖优选供应链 · 销售工作台</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-page {
  min-height: 100vh;
}

.page-body {
  padding: 12px 0;
}

.quick-grid {
  margin-top: 16px;
}

.footer-hint {
  margin-top: 24px;
}

.hint-text {
  text-align: center;
  font-size: 12px;
  color: var(--van-text-color-2);
}
</style>
