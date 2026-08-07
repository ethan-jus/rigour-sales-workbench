<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSalesStore } from '@/stores/sales';

const authStore = useAuthStore();
const salesStore = useSalesStore();
const displayName = computed(() => authStore.userName || '销售同事');
const context = computed(() => salesStore.context);
const workDay = computed(() => salesStore.workDay);
const contextStatus = computed(() => {
  if (workDay.value?.status === 'ACTIVE') return '工作中 · 定位采集中';
  if (workDay.value?.status === 'FINISHED') return '今日已签退';
  if (workDay.value?.status === 'PENDING_REVIEW') return '今日待复核';
  if (salesStore.contextLoading) return '正在读取销售上下文';
  if (salesStore.errorMessage) return '销售上下文读取失败';
  if (context.value) return `已接入规则 v${context.value.fieldPolicy.versionNo}`;
  return '等待销售上下文';
});
const today = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long',
}).format(new Date());

const quickActions = [
  { to: '/attendance', icon: 'clock-o', title: '外勤考勤', subtitle: '签到与签退' },
  { to: '/targets', icon: 'shop-o', title: '客户门店', subtitle: 'CRM有效归属' },
  { to: '/visit', icon: 'friends-o', title: '发起拜访', subtitle: '到店与录音' },
  { to: '/track', icon: 'location-o', title: '我的记录', subtitle: '轨迹与拜访' },
] as const;

onMounted(() => {
  void salesStore.loadContext();
  void salesStore.loadWorkDay(localDate());
});

function localDate(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function time(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '--:--';
}
</script>

<template>
  <div class="workbench-page home-page">
    <section class="hero">
      <div class="hero__top">
        <div>
          <p>{{ today }}</p>
          <h1>{{ displayName }}，今天辛苦了</h1>
        </div>
        <router-link to="/profile" class="profile-link" aria-label="进入个人中心">
          <van-icon name="user-o" size="22" />
        </router-link>
      </div>

      <div class="workday-card">
        <div>
          <span class="workday-label">今日工作状态</span>
          <strong>{{ contextStatus }}</strong>
          <p v-if="context">{{ context.salesNo }} · {{ context.fieldPolicy.policyName }}</p>
          <p v-else>签到后开始前台定位，签退后停止采集</p>
        </div>
        <van-button round type="primary" size="small" to="/attendance">进入考勤</van-button>
      </div>
    </section>

    <div class="workbench-body home-body">
      <div class="summary-grid surface-card">
        <div><span>签到时间</span><strong>{{ time(workDay?.checkedInAt) }}</strong></div>
        <div><span>已核算时长</span><strong>{{ workDay ? `${workDay.verifiedWorkMinutes} 分钟` : '--' }}</strong></div>
        <div><span>定位采样</span><strong>{{ workDay ? `${workDay.locationPointCount} 点` : '--' }}</strong></div>
        <div><span>日结状态</span><strong>{{ workDay?.status || '--' }}</strong></div>
      </div>

      <div class="section-heading">
        <h2>常用工作</h2>
        <span>销售本人</span>
      </div>
      <div class="action-grid">
        <router-link v-for="item in quickActions" :key="item.to" :to="item.to" class="action-card">
          <span class="action-icon"><van-icon :name="item.icon" size="24" /></span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.subtitle }}</small>
        </router-link>
      </div>

      <div class="section-heading">
        <h2>当前拜访</h2>
        <router-link class="section-link" to="/track">查看记录</router-link>
      </div>
      <div class="empty-work surface-card">
        <span class="empty-work__icon"><van-icon name="shop-collect-o" size="28" /></span>
        <div>
          <strong>暂未加载进行中的拜访</strong>
          <p>接入拜访查询接口后，这里显示门店、阶段和持续时间。</p>
        </div>
        <van-button plain type="primary" size="small" to="/visit">发起拜访</van-button>
      </div>

      <div class="section-heading">
        <h2>今日提醒</h2>
        <router-link class="section-link" to="/policy">当前规则</router-link>
      </div>
      <div class="notice-card surface-card">
        <van-icon class="notice-icon" name="info-o" size="20" />
        <div>
          <strong>{{ context ? '当前规则已从 Sales Work 返回' : '当前规则尚未返回' }}</strong>
          <p v-if="context">规则采样间隔 {{ context.fieldPolicy.locationIntervalMinutes }} 分钟；{{ workDay ? `当前工作日已记录 ${workDay.locationPointCount} 个定位点。` : '今天尚未创建工作日。' }}</p>
          <p v-else>{{ salesStore.errorMessage || '待服务端返回真实销售身份、规则和可见范围。' }}</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  padding: 24px 18px 64px;
  color: #fff;
  background: linear-gradient(145deg, #1749b6 0%, #2468f2 62%, #4b8cff 100%);
}

.hero__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}

.hero__top p { margin: 0 0 5px; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
.hero__top h1 { margin: 0; font-size: 22px; line-height: 1.4; }

.profile-link {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 50%;
}

.workday-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 28px;
  padding: 18px;
  background: rgba(10, 35, 83, 0.34);
  border: 1px solid rgba(255, 255, 255, 0.16);
  border-radius: 16px;
  backdrop-filter: blur(12px);
}

.workday-card strong { display: block; margin-top: 4px; font-size: 16px; }
.workday-card p { margin: 5px 0 0; color: rgba(255, 255, 255, 0.7); font-size: 11px; }
.workday-label { color: rgba(255, 255, 255, 0.72); font-size: 12px; }

.home-body { margin-top: -42px; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 18px 8px;
}

.summary-grid div { text-align: center; border-right: 1px solid var(--workbench-line); }
.summary-grid div:last-child { border-right: 0; }
.summary-grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.summary-grid strong { display: block; margin-top: 7px; color: var(--workbench-ink); font-size: 14px; }

.action-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
.action-card {
  display: grid;
  grid-template-columns: 42px 1fr;
  grid-template-rows: auto auto;
  column-gap: 10px;
  padding: 16px;
  background: #fff;
  border: 1px solid var(--workbench-line);
  border-radius: 14px;
}
.action-icon { display: grid; grid-row: 1 / 3; width: 42px; height: 42px; color: var(--workbench-primary); background: #edf4ff; border-radius: 12px; place-items: center; }
.action-card strong { align-self: end; color: var(--workbench-ink); font-size: 14px; }
.action-card small { color: var(--workbench-muted); font-size: 11px; }

.section-link { color: var(--workbench-primary); font-size: 12px; }

.empty-work,
.notice-card { display: flex; gap: 12px; align-items: center; padding: 16px; }
.empty-work__icon { display: grid; flex: 0 0 48px; height: 48px; color: var(--workbench-primary); background: #edf4ff; border-radius: 14px; place-items: center; }
.empty-work > div,
.notice-card > div { min-width: 0; flex: 1; }
.empty-work strong,
.notice-card strong { color: var(--workbench-ink); font-size: 13px; }
.empty-work p,
.notice-card p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 11px; line-height: 1.55; }
.notice-icon { flex: 0 0 auto; color: #d28a14; }

@media (max-width: 360px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); row-gap: 16px; }
  .summary-grid div:nth-child(2) { border-right: 0; }
  .action-grid { grid-template-columns: 1fr; }
}
</style>
