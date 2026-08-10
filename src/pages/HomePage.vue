<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSalesStore } from '@/stores/sales';
import { formatDurationMinutes, formatTime, localDate } from '@/utils/datetime';

const authStore = useAuthStore();
const salesStore = useSalesStore();
const displayName = computed(() => authStore.userName || '销售同事');
const context = computed(() => salesStore.context);
const workDay = computed(() => salesStore.workDay);
const todaySummary = computed(() => salesStore.todaySummary);
const monthSummary = computed(() => salesStore.monthSummary);
const activeVisit = computed(() => salesStore.visits?.items.find((visit) => visit.status === 'CHECKED_IN') ?? null);
const contextStatus = computed(() => {
  if (workDay.value?.status === 'ACTIVE') return '工作中 · 定位采集中';
  if (workDay.value?.status === 'FINISHED') return '今日已签退';
  if (workDay.value?.status === 'PENDING_REVIEW') return '今日待复核';
  if (salesStore.contextLoading) return '正在读取销售上下文';
  if (salesStore.errorMessage) return '销售上下文读取失败';
  if (context.value) return '今日待签到';
  return '等待销售上下文';
});
const today = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long',
}).format(new Date());
const todayDate = localDate();
const policyEffectiveDate = computed(() => context.value?.fieldPolicy.effectiveFrom?.slice(0, 10) ?? '--');
const todayProgressHint = computed(() => {
  const summary = todaySummary.value;
  if (!summary) return salesStore.summaryError || '正在读取今日拜访进度';
  if (summary.inProgressVisitCount > 0) return `还有 ${summary.inProgressVisitCount} 家拜访正在进行`;
  if (summary.pendingReviewVisitCount > 0) return `${summary.pendingReviewVisitCount} 家已离店，等待有效性核验`;
  if (summary.totalVisitCount === 0) return '今天还没有发起门店拜访';
  return '今日已没有进行中的拜访';
});

const quickActions = [
  { to: '/attendance', icon: 'clock-o', title: '外勤考勤', subtitle: '签到与签退' },
  { to: '/targets', icon: 'shop-o', title: '客户门店', subtitle: 'CRM有效归属' },
  { to: '/visit', icon: 'friends-o', title: '发起拜访', subtitle: '到店与录音' },
  { to: '/track', icon: 'location-o', title: '我的记录', subtitle: '轨迹与拜访' },
] as const;

onMounted(() => {
  void salesStore.loadContext();
  void salesStore.loadWorkDay(todayDate);
  void salesStore.loadVisits(1, todayDate);
  void salesStore.loadActivitySummaries(todayDate);
});

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
          <p v-if="context">{{ context.salesNo }} · 当前规则自 {{ policyEffectiveDate }} 生效</p>
          <p v-else>签到后开始前台定位，签退后停止采集</p>
        </div>
        <van-button round type="primary" size="small" to="/attendance">进入考勤</van-button>
      </div>
    </section>

    <div class="workbench-body home-body">
      <div class="section-heading section-heading--first">
        <h2>今日拜访</h2>
        <router-link class="section-link" to="/track">查看明细</router-link>
      </div>
      <div class="summary-grid surface-card">
        <div><span>已拜访</span><strong>{{ todaySummary?.totalVisitCount ?? '--' }}</strong></div>
        <div><span>完成离店</span><strong>{{ todaySummary?.completedVisitCount ?? '--' }}</strong></div>
        <div><span>确认有效</span><strong>{{ todaySummary?.effectiveVisitCount ?? '--' }}</strong></div>
        <div><span>首访 / 复访</span><strong>{{ todaySummary ? `${todaySummary.firstVisitCount} / ${todaySummary.revisitCount}` : '--' }}</strong></div>
      </div>
      <p class="summary-hint"><van-icon name="info-o" /> {{ todayProgressHint }}</p>

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
      <router-link
        v-if="activeVisit"
        class="empty-work surface-card"
        :to="{ path: '/visit', query: { visitId: activeVisit.id } }"
      >
        <span class="empty-work__icon"><van-icon name="shop-collect-o" size="28" /></span>
        <div>
          <strong>{{ activeVisit.targetSnapshot?.storeName || '进行中的门店拜访' }}</strong>
          <p>到店 {{ formatTime(activeVisit.checkedInAt) }} · {{ activeVisit.resultSubmittedAt ? '结果已保存' : '待填写结果' }}</p>
        </div>
        <van-icon name="arrow" color="#94a0b4" />
      </router-link>
      <div v-else class="empty-work surface-card">
        <span class="empty-work__icon"><van-icon name="shop-collect-o" size="28" /></span>
        <div>
          <strong>{{ salesStore.visitsError || '当前没有进行中的拜访' }}</strong>
          <p>{{ salesStore.visitsError || '从客户门店选择拜访对象并完成到店签到。' }}</p>
        </div>
        <van-button plain type="primary" size="small" to="/targets">发起拜访</van-button>
      </div>

      <div class="section-heading">
        <h2>本月个人进展</h2>
        <span>截至今天</span>
      </div>
      <div class="month-card surface-card">
        <div class="month-card__primary">
          <span>累计完成拜访</span>
          <strong>{{ monthSummary?.completedVisitCount ?? '--' }}<small> 次</small></strong>
          <p>确认有效 {{ monthSummary?.effectiveVisitCount ?? '--' }} · 待核验 {{ monthSummary?.pendingReviewVisitCount ?? '--' }}</p>
        </div>
        <div class="month-card__facts">
          <div><span>覆盖 / 负责</span><strong>{{ monthSummary ? `${monthSummary.uniqueStoreCount} / ${monthSummary.assignedStoreCount}` : '--' }}</strong></div>
          <div><span>首访</span><strong>{{ monthSummary?.firstVisitCount ?? '--' }}</strong></div>
          <div><span>复访</span><strong>{{ monthSummary?.revisitCount ?? '--' }}</strong></div>
        </div>
      </div>

      <div class="section-heading">
        <h2>今日工作概况</h2>
        <router-link class="section-link" to="/attendance">考勤详情</router-link>
      </div>
      <div class="notice-card surface-card">
        <van-icon class="notice-icon" name="clock-o" size="20" />
        <div>
          <strong>{{ workDay ? `${formatTime(workDay.checkedInAt)} 签到` : '今天尚未签到' }}</strong>
          <p v-if="workDay">已核算 {{ formatDurationMinutes(workDay.verifiedWorkMinutes) }}；定位采集只作为工作证据，不作为首页主指标。</p>
          <p v-else>签到后开始记录外勤工作事实，再从客户门店发起拜访。</p>
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
.section-heading--first { margin-top: 0; }

.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  padding: 18px 8px;
}

.summary-grid div { text-align: center; border-right: 1px solid var(--workbench-line); }
.summary-grid div:last-child { border-right: 0; }
.summary-grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.summary-grid strong { display: block; margin-top: 7px; color: var(--workbench-ink); font-size: 14px; }
.summary-hint { display: flex; gap: 5px; align-items: center; margin: 8px 4px 0; color: var(--workbench-muted); font-size: 11px; }

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
.month-card { display: grid; grid-template-columns: 1.1fr 1fr; gap: 16px; padding: 18px; }
.month-card__primary { padding-right: 16px; border-right: 1px solid var(--workbench-line); }
.month-card__primary > span,
.month-card__facts span { color: var(--workbench-muted); font-size: 11px; }
.month-card__primary > strong { display: block; margin-top: 8px; color: var(--workbench-primary); font-size: 28px; }
.month-card__primary > strong small { font-size: 12px; font-weight: 500; }
.month-card__primary p { margin: 5px 0 0; color: var(--workbench-muted); font-size: 10px; line-height: 1.5; }
.month-card__facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; text-align: center; }
.month-card__facts div { display: flex; flex-direction: column; justify-content: center; }
.month-card__facts strong { margin-top: 6px; color: var(--workbench-ink); font-size: 17px; }

@media (max-width: 360px) {
  .summary-grid { grid-template-columns: repeat(2, 1fr); row-gap: 16px; }
  .summary-grid div:nth-child(2) { border-right: 0; }
  .action-grid { grid-template-columns: 1fr; }
  .month-card { grid-template-columns: 1fr; }
  .month-card__primary { padding: 0 0 14px; border-right: 0; border-bottom: 1px solid var(--workbench-line); }
}
</style>
