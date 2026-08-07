<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { showConfirmDialog } from 'vant';

const authStore = useAuthStore();

function handleLogout() {
  showConfirmDialog({
    title: '退出登录',
    message: '确定要退出当前账号吗？',
  })
    .then(() => {
      authStore.logout();
      window.location.reload();
    })
    .catch(() => {});
}
</script>

<template>
  <div class="profile-page">
    <van-nav-bar title="个人" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <div class="user-card">
        <van-image round width="64" height="64" :src="authStore.avatar || undefined">
          <template #error>
            <van-icon name="user-o" size="32" />
          </template>
        </van-image>
        <h3 class="user-name">{{ authStore.userName || '未登录' }}</h3>
        <p class="user-id">User ID: {{ authStore.userId || '--' }}</p>
      </div>

      <van-cell-group inset>
        <van-cell title="租户" :value="authStore.tenantId || '--'" />
        <van-cell title="当前生效规则" value="查看" is-link to="/policy" />
        <van-cell title="补卡与申诉" value="查看" is-link to="/appeals" />
        <van-cell title="隐私与授权" value="查看" is-link to="/privacy" />
      </van-cell-group>

      <div class="logout-btn">
        <van-button type="default" size="large" @click="handleLogout">退出登录</van-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-page {
  min-height: 100vh;
}

.page-body {
  padding: 12px 0;
}

.user-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  background: var(--van-background);
}

.user-name {
  margin: 12px 0 4px;
  font-size: 18px;
}

.user-id {
  margin: 0;
  font-size: 12px;
  color: var(--van-text-color-2);
}

.logout-btn {
  padding: 24px 16px;
}
</style>
