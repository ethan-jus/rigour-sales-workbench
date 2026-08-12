<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useAuthStore } from '@/stores/auth';
import { useSalesStore } from '@/stores/sales';
import { formatTime, localDate } from '@/utils/datetime';

interface NextAction {
  eyebrow: string;
  title: string;
  description: string;
  label: string;
  icon: string;
  to?: string | { path: string; query: { visitId: string } };
  retry?: boolean;
}

const authStore = useAuthStore();
const salesStore = useSalesStore();
const refreshing = ref(false);
const displayName = computed(() => authStore.userName || '销售同事');
const context = computed(() => salesStore.context);
const workDay = computed(() => salesStore.workDay);
const todaySummary = computed(() => salesStore.todaySummary);
const monthSummary = computed(() => salesStore.monthSummary);
const pendingPlanCount = computed(() => salesStore.visitPlans?.items
  .filter((plan) => plan.status === 'PLANNED').length ?? 0);
const activeVisit = computed(() => salesStore.visits?.items.find((visit) => visit.status === 'CHECKED_IN') ?? null);
const today = new Intl.DateTimeFormat('zh-CN', {
  month: 'long', day: 'numeric', weekday: 'long',
}).format(new Date());
const todayDate = localDate();

const workStatus = computed(() => {
  if (workDay.value?.status === 'ACTIVE') return { label: '工作中', tone: 'active' };
  if (workDay.value?.status === 'FINISHED') return { label: '已签退', tone: 'finished' };
  if (workDay.value?.status === 'PENDING_REVIEW') return { label: '考勤待复核', tone: 'warning' };
  if (salesStore.contextLoading || salesStore.attendanceLoading) return { label: '读取中', tone: 'loading' };
  return { label: '未签到', tone: 'idle' };
});

const homeErrorMessage = computed(() => [
  salesStore.errorMessage,
  salesStore.attendanceError,
  salesStore.visitsError,
  salesStore.visitPlansError,
  salesStore.summaryError,
].find((message): message is string => Boolean(message)) ?? null);

const nextAction = computed<NextAction>(() => {
  if (activeVisit.value) {
    const storeName = activeVisit.value.targetSnapshot?.storeName || '进行中的门店拜访';
    return {
      eyebrow: '正在执行',
      title: storeName,
      description: `已于 ${formatTime(activeVisit.value.checkedInAt)} 到店，${activeVisit.value.resultSubmittedAt ? '结果已保存，可继续补充证据或完成离店' : '请继续录音、拍摄门头并填写拜访结果'}`,
      label: '继续本次拜访',
      icon: 'shop-collect-o',
      to: { path: '/visit', query: { visitId: activeVisit.value.id } },
    };
  }
  if (workDay.value?.status === 'ACTIVE') {
    if (pendingPlanCount.value > 0) {
      return {
        eyebrow: '下一步',
        title: `执行今日计划（${pendingPlanCount.value}项待完成）`,
        description: '主管已安排今天的拜访目标；也可从负责门店或附近门店发起临时拜访。',
        label: '查看今日计划',
        icon: 'todo-list-o',
        to: '/targets',
      };
    }
    return {
      eyebrow: '下一步',
      title: '选择今天要拜访的门店',
      description: '可从本人负责门店或高德附近门店发起，到店位置由服务端校验。',
      label: '选择拜访对象',
      icon: 'location-o',
      to: '/targets',
    };
  }
  if (workDay.value?.status === 'FINISHED') {
    return {
      eyebrow: '今日已收工',
      title: '查看今天的外勤记录',
      description: '签到、轨迹、拜访结果和待复核事项均以服务端记录为准。',
      label: '查看今日记录',
      icon: 'records-o',
      to: '/track',
    };
  }
  if (workDay.value?.status === 'PENDING_REVIEW') {
    return {
      eyebrow: '需要关注',
      title: '今日考勤正在等待复核',
      description: '可查看工作时长与定位证据；最终考勤结果由主管或人事确认。',
      label: '查看考勤详情',
      icon: 'warning-o',
      to: '/attendance',
    };
  }
  if (salesStore.contextLoading || salesStore.attendanceLoading || salesStore.visitsLoading) {
    return {
      eyebrow: '正在准备',
      title: '正在读取今天的工作状态',
      description: '完成后会直接告诉你当前最需要处理的事项。',
      label: '读取中',
      icon: 'replay',
    };
  }
  if (!context.value && homeErrorMessage.value) {
    return {
      eyebrow: '暂未就绪',
      title: '工作台数据未能完整读取',
      description: '请检查网络后重新读取；若登录已过期，请从飞书重新进入应用。',
      label: '重新读取',
      icon: 'warning-o',
      retry: true,
    };
  }
  return {
    eyebrow: '开始今天',
    title: '先完成上班签到',
    description: '签到成功后开始前台定位，再从客户门店发起今天的第一场拜访。',
    label: '去上班签到',
    icon: 'clock-o',
    to: '/attendance',
  };
});

const todayProgressHint = computed(() => {
  const summary = todaySummary.value;
  if (!summary) return salesStore.summaryLoading ? '正在读取今日拜访进度' : '今日进度暂未更新';
  if (summary.inProgressVisitCount > 0) return `还有 ${summary.inProgressVisitCount} 家拜访正在进行`;
  if (summary.pendingReviewVisitCount > 0) return `${summary.pendingReviewVisitCount} 家存在异常，等待主管复核`;
  if (summary.totalVisitCount === 0) return '今天还没有发起门店拜访';
  return '已完成的拜访均已自动判定或复核';
});

const quickActions = [
  { to: '/targets', icon: 'shop-o', title: '客户门店', subtitle: '计划与临时拜访' },
  { to: '/attendance', icon: 'clock-o', title: '外勤考勤', subtitle: '签到与签退' },
  { to: '/track', icon: 'location-o', title: '工作记录', subtitle: '轨迹与拜访' },
] as const;

async function loadHome(forceContext = false) {
  await Promise.all([
    salesStore.loadContext(forceContext),
    salesStore.loadWorkDay(todayDate),
    salesStore.loadVisits(1, todayDate),
    salesStore.loadVisitPlans(todayDate),
    salesStore.loadActivitySummaries(todayDate),
  ]);
}

async function retryHome() {
  if (refreshing.value) return;
  refreshing.value = true;
  try {
    await loadHome(true);
  } finally {
    refreshing.value = false;
  }
}

onMounted(() => {
  void loadHome();
});
</script>

<template>
  <div class="workbench-page home-page">
    <header class="home-header">
      <div>
        <p>{{ today }}</p>
        <h1>{{ displayName }}，今天辛苦了</h1>
      </div>
      <router-link to="/profile" class="profile-link" aria-label="进入个人中心">
        <van-icon name="user-o" size="22" />
      </router-link>
    </header>

    <div class="workbench-body home-body">
      <section class="next-action surface-card" :class="`next-action--${workStatus.tone}`">
        <div class="next-action__head">
          <span class="next-action__eyebrow">{{ nextAction.eyebrow }}</span>
          <span class="status-chip">{{ workStatus.label }}</span>
        </div>
        <div class="next-action__content">
          <span class="next-action__icon"><van-icon :name="nextAction.icon" size="28" /></span>
          <div>
            <h2>{{ nextAction.title }}</h2>
            <p>{{ nextAction.description }}</p>
          </div>
        </div>
        <van-button
          v-if="nextAction.retry"
          block
          round
          type="primary"
          :loading="refreshing"
          loading-text="正在读取"
          @click="retryHome"
        >
          {{ nextAction.label }}
        </van-button>
        <van-button
          v-else
          block
          round
          type="primary"
          :to="nextAction.to"
          :loading="!nextAction.to"
          loading-text="读取中"
        >
          {{ nextAction.label }}
        </van-button>
      </section>

      <div v-if="homeErrorMessage" class="home-alert" role="alert">
        <van-icon class="home-alert__icon" name="warning-o" size="17" />
        <div>
          <strong>部分数据暂未更新</strong>
          <p>{{ homeErrorMessage }}</p>
        </div>
      </div>

      <div class="section-heading">
        <h2>今日拜访</h2>
        <router-link class="section-link" to="/track">查看明细</router-link>
      </div>
      <section class="today-card surface-card">
        <div class="summary-grid">
          <div><span>已拜访</span><strong>{{ todaySummary?.totalVisitCount ?? '--' }}</strong></div>
          <div><span>完成离店</span><strong>{{ todaySummary?.completedVisitCount ?? '--' }}</strong></div>
          <div><span>确认有效</span><strong>{{ todaySummary?.effectiveVisitCount ?? '--' }}</strong></div>
          <div><span>待复核</span><strong>{{ todaySummary?.pendingReviewVisitCount ?? '--' }}</strong></div>
        </div>
        <p class="summary-hint"><van-icon name="info-o" /> {{ todayProgressHint }}</p>
      </section>

      <div class="section-heading">
        <h2>快捷入口</h2>
        <span>销售本人</span>
      </div>
      <nav class="action-grid" aria-label="快捷入口">
        <router-link v-for="item in quickActions" :key="item.to" :to="item.to" class="action-card">
          <span class="action-icon"><van-icon :name="item.icon" size="23" /></span>
          <strong>{{ item.title }}</strong>
          <small>{{ item.subtitle }}</small>
          <van-icon class="action-arrow" name="arrow" size="14" />
        </router-link>
      </nav>

      <div class="section-heading">
        <h2>本月个人进展</h2>
        <span>截至今天</span>
      </div>
      <section class="month-card surface-card">
        <div class="month-card__primary">
          <span>累计完成拜访</span>
          <strong>{{ monthSummary?.completedVisitCount ?? '--' }}<small> 次</small></strong>
          <p>确认有效 {{ monthSummary?.effectiveVisitCount ?? '--' }} · 待复核 {{ monthSummary?.pendingReviewVisitCount ?? '--' }}</p>
        </div>
        <div class="month-card__facts">
          <div><span>覆盖门店</span><strong>{{ monthSummary?.uniqueStoreCount ?? '--' }}</strong></div>
          <div><span>首访</span><strong>{{ monthSummary?.firstVisitCount ?? '--' }}</strong></div>
          <div><span>复访</span><strong>{{ monthSummary?.revisitCount ?? '--' }}</strong></div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.home-page { min-height: 100vh; }

.home-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  min-height: 174px;
  padding: 24px 18px 58px;
  color: #fff;
  background: linear-gradient(145deg, #1749b6 0%, #2468f2 62%, #4b8cff 100%);
}

.home-header p { margin: 0 0 5px; color: rgba(255, 255, 255, 0.72); font-size: 12px; }
.home-header h1 { margin: 0; font-size: 22px; line-height: 1.4; }

.profile-link {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 50%;
}

.home-body { margin-top: -42px; }

.next-action { padding: 17px; }
.next-action__head { display: flex; align-items: center; justify-content: space-between; }
.next-action__eyebrow { color: var(--workbench-primary); font-size: 12px; font-weight: 700; letter-spacing: 0.04em; }
.status-chip { padding: 4px 9px; color: #56637a; font-size: 11px; background: #f1f4f9; border-radius: 999px; }
.next-action--active .status-chip { color: #08794c; background: #e8f8f0; }
.next-action--finished .status-chip { color: #315a9b; background: #eaf1fd; }
.next-action--warning .status-chip { color: #a36200; background: #fff4dc; }
.next-action--loading .status-chip { color: #315a9b; background: #edf3ff; }

.next-action__content { display: flex; gap: 13px; align-items: center; margin: 15px 0 17px; }
.next-action__icon { display: grid; flex: 0 0 52px; height: 52px; color: var(--workbench-primary); background: #edf4ff; border-radius: 15px; place-items: center; }
.next-action__content > div { min-width: 0; }
.next-action h2 { color: var(--workbench-ink); font-size: 17px; line-height: 1.4; }
.next-action p { margin: 5px 0 0; color: var(--workbench-muted); font-size: 12px; line-height: 1.55; }

.home-alert {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-top: 12px;
  padding: 12px 14px;
  color: #8b5c08;
  background: #fff8e9;
  border: 1px solid #f5e4ba;
  border-radius: 12px;
}
.home-alert__icon { margin-top: 1px; flex: 0 0 auto; }
.home-alert strong { display: block; font-size: 12px; }
.home-alert p { margin: 2px 0 0; color: #9a6b17; font-size: 11px; line-height: 1.5; }

.section-link { color: var(--workbench-primary); font-size: 12px; }

.today-card { padding: 3px 0 0; }
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); padding: 15px 8px 13px; }
.summary-grid div { text-align: center; border-right: 1px solid var(--workbench-line); }
.summary-grid div:last-child { border-right: 0; }
.summary-grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.summary-grid strong { display: block; margin-top: 6px; color: var(--workbench-ink); font-size: 17px; }
.summary-hint { display: flex; gap: 6px; align-items: center; padding: 10px 14px; color: var(--workbench-muted); font-size: 11px; background: #f8faff; border-top: 1px solid var(--workbench-line); }

.action-grid { display: grid; gap: 9px; }
.action-card {
  position: relative;
  display: grid;
  grid-template-columns: 43px 1fr 18px;
  grid-template-rows: auto auto;
  column-gap: 11px;
  align-items: center;
  padding: 13px 15px;
  background: #fff;
  border: 1px solid var(--workbench-line);
  border-radius: 14px;
}
.action-icon { display: grid; grid-row: 1 / 3; width: 43px; height: 43px; color: var(--workbench-primary); background: #edf4ff; border-radius: 12px; place-items: center; }
.action-card strong { align-self: end; color: var(--workbench-ink); font-size: 14px; }
.action-card small { align-self: start; color: var(--workbench-muted); font-size: 11px; }
.action-arrow { grid-column: 3; grid-row: 1 / 3; color: #a4aec0; }

.month-card { display: grid; grid-template-columns: 1.05fr 1fr; gap: 15px; padding: 17px; }
.month-card__primary { padding-right: 15px; border-right: 1px solid var(--workbench-line); }
.month-card__primary > span,
.month-card__facts span { color: var(--workbench-muted); font-size: 11px; }
.month-card__primary > strong { display: block; margin-top: 7px; color: var(--workbench-primary); font-size: 27px; }
.month-card__primary > strong small { font-size: 12px; font-weight: 500; }
.month-card__primary p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 10px; line-height: 1.5; }
.month-card__facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 7px; text-align: center; }
.month-card__facts div { display: flex; flex-direction: column; justify-content: center; }
.month-card__facts strong { margin-top: 6px; color: var(--workbench-ink); font-size: 17px; }

@media (max-width: 360px) {
  .home-header h1 { font-size: 20px; }
  .summary-grid { grid-template-columns: repeat(2, 1fr); row-gap: 14px; }
  .summary-grid div:nth-child(2) { border-right: 0; }
  .month-card { grid-template-columns: 1fr; }
  .month-card__primary { padding: 0 0 13px; border-right: 0; border-bottom: 1px solid var(--workbench-line); }
}
</style>
