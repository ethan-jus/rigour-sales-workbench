<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import type { NearbyStoreView, PoiTargetCommand, VisitPlanView, VisitTargetView } from '@/api/core/sales';
import { useSalesStore } from '@/stores/sales';
import { createIdempotencyKey } from '@/utils/id';
import { localDate } from '@/utils/datetime';

const salesStore = useSalesStore();
const router = useRouter();
const route = useRoute();

const activeTab = ref(Number(route.query.tab ?? 0));
const search = ref('');
const submittedQuery = ref('');
const nearbyQuery = ref('');
const radiusMeters = ref(3000);
const location = ref<{
  longitude: number;
  latitude: number;
  accuracy: number;
  timestamp: number;
} | null>(null);
const locating = ref(false);
const targetPage = computed(() => salesStore.targets);
const nearbyPage = computed(() => salesStore.nearbyStores);
const planPage = computed(() => salesStore.visitPlans);
const creatingTarget = ref<string | null>(null);
const visitStartStage = ref<'WORK_DAY' | 'LOCATION' | 'CREATE' | null>(null);
let radiusReloadTimer: number | null = null;

const visitStartHint = computed(() => {
  switch (visitStartStage.value) {
    case 'WORK_DAY': return '正在确认今日工作状态';
    case 'LOCATION': return '正在获取到店位置';
    case 'CREATE': return '正在创建拜访';
    default: return '';
  }
});

function loadTargets() {
  submittedQuery.value = search.value.trim();
  void salesStore.loadTargets(submittedQuery.value);
}

async function loadNearby(force = false) {
  if (!location.value || force) {
    locating.value = true;
    try {
      const current = await salesStore.getCurrentLocation(force ? 0 : 30_000);
      location.value = {
        longitude: current.longitude,
        latitude: current.latitude,
        accuracy: current.accuracy,
        timestamp: current.timestamp,
      };
    } catch (error) {
      showToast(error instanceof Error ? error.message : '定位失败，请检查定位权限');
      return;
    } finally {
      locating.value = false;
    }
  }
  await salesStore.loadNearbyStores(
    location.value.longitude,
    location.value.latitude,
    radiusMeters.value,
    nearbyQuery.value.trim(),
    1,
    force,
  );
}

function reloadNearbyAfterRadiusChange() {
  if (radiusReloadTimer !== null) window.clearTimeout(radiusReloadTimer);
  radiusReloadTimer = window.setTimeout(() => {
    radiusReloadTimer = null;
    void loadNearby();
  }, 250);
}

function onTabChange(tab: number | string) {
  activeTab.value = Number(tab);
  if (activeTab.value === 2 && !nearbyPage.value) {
    void loadNearby();
  }
}

async function startPlannedVisit(plan: VisitPlanView) {
  if (plan.status === 'IN_PROGRESS' && plan.visitId) {
    await router.push({ path: '/visit', query: { visitId: plan.visitId } });
    return;
  }
  if (plan.status !== 'PLANNED') return;
  await startVisit('MY_STORE', { visitPlanId: plan.planId, storeId: plan.storeId });
}

async function startMyStoreVisit(target: VisitTargetView) {
  await startVisit('MY_STORE', { storeId: target.storeId });
}

async function startPoiVisit(target: NearbyStoreView) {
  if (target.longitude == null || target.latitude == null) {
    showToast('该门店缺少坐标，无法拜访');
    return;
  }
  await startVisit('POI', {
    poi: {
      poiId: target.poiId,
      name: target.name,
      address: target.address,
      longitude: target.longitude,
      latitude: target.latitude,
      distanceMeters: target.distanceMeters,
    },
  });
}

async function startVisit(
  targetType: 'MY_STORE' | 'POI',
  extra: { visitPlanId?: string; storeId?: string; poi?: PoiTargetCommand },
) {
  if (creatingTarget.value) return;
  creatingTarget.value = extra.visitPlanId ?? extra.storeId ?? extra.poi?.poiId ?? 'poi';
  try {
    visitStartStage.value = 'WORK_DAY';
    const businessDate = localDate();
    const workDay = salesStore.workDay?.businessDate === businessDate
      ? salesStore.workDay
      : await salesStore.loadWorkDay(businessDate);
    // 只有进行中的工作日才能发起拜访；未签到或已签退先引导到考勤页。
    if (!workDay || workDay.status !== 'ACTIVE') {
      showToast(
        workDay?.status === 'FINISHED'
          ? '今日已签退，请重新签到后再拜访'
          : salesStore.attendanceError || '请先完成上班签到后再发起拜访',
      );
      await router.push('/attendance');
      return;
    }
    visitStartStage.value = 'LOCATION';
    const current = await salesStore.getCurrentLocation(30_000);
    visitStartStage.value = 'CREATE';
    const visit = await salesStore.createVisit({
      idempotencyKey: createIdempotencyKey('visit'),
      workDayId: workDay.id,
      visitPlanId: extra.visitPlanId,
      targetType,
      ...extra,
      location: {
        longitude: current.longitude,
        latitude: current.latitude,
        accuracyMeters: current.accuracy,
        source: 'FEISHU',
      },
      clientOccurredAt: new Date().toISOString(),
      deviceEventId: `visit-check-in-${createIdempotencyKey('device')}`,
    });
    if (visit) {
      await router.push({ path: '/visit', query: { visitId: visit.id } });
    } else {
      showToast(salesStore.visitError || '拜访创建失败');
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : '拜访创建失败');
  } finally {
    creatingTarget.value = null;
    visitStartStage.value = null;
  }
}

onMounted(() => {
  void salesStore.loadVisitPlans(localDate());
  loadTargets();
  if (activeTab.value === 2) void loadNearby();
});

onBeforeUnmount(() => {
  if (radiusReloadTimer !== null) window.clearTimeout(radiusReloadTimer);
});
</script>

<template>
  <div class="workbench-page targets-page">
    <van-nav-bar title="客户与门店" left-arrow @click-left="$router.back()" />
    <van-tabs v-model:active="activeTab" sticky offset-top="46" @change="onTabChange">
      <van-tab title="今日计划">
        <div class="targets-heading plan-heading">
          <div><strong>主管安排</strong><span v-if="planPage">{{ planPage.items.length }} 项</span></div>
          <van-button
            size="small"
            plain
            type="primary"
            :loading="salesStore.visitPlansLoading"
            @click="salesStore.loadVisitPlans(localDate())"
          >刷新</van-button>
        </div>
        <div v-if="creatingTarget" class="inline-loading inline-loading--visit">
          <van-loading size="16" />{{ visitStartHint }}，请勿重复点击
        </div>
        <div v-if="planPage?.items.length" class="plan-list">
          <section v-for="plan in planPage.items" :key="plan.planId" class="plan-card surface-card">
            <div class="plan-card__head">
              <span class="plan-status" :class="`plan-status--${plan.status.toLowerCase()}`">
                {{ plan.status === 'PLANNED' ? '待执行' : plan.status === 'IN_PROGRESS' ? '进行中' : '已完成' }}
              </span>
              <small>主管计划</small>
            </div>
            <strong>{{ plan.storeName }}</strong>
            <p class="plan-address">{{ plan.storeAddress || '暂无门店地址' }}</p>
            <div class="plan-objective">
              <van-icon class="plan-objective__icon" name="todo-list-o" />
              <span>{{ plan.objective }}</span>
            </div>
            <van-button
              v-if="plan.status !== 'COMPLETED'"
              block
              round
              type="primary"
              :plain="plan.status === 'IN_PROGRESS'"
              :loading="creatingTarget === plan.planId"
              loading-text="处理中"
              :disabled="Boolean(creatingTarget) && creatingTarget !== plan.planId"
              @click="startPlannedVisit(plan)"
            >{{ plan.status === 'IN_PROGRESS' ? '继续本次拜访' : '开始计划拜访' }}</van-button>
            <van-button v-else block round disabled>计划已完成</van-button>
          </section>
        </div>
        <div v-else-if="salesStore.visitPlansLoading" class="target-empty">
          <van-loading type="spinner" /><p>正在读取今日拜访计划</p>
        </div>
        <div v-else class="target-empty">
          <van-icon class="target-empty__icon" name="todo-list-o" size="34" />
          <strong>{{ salesStore.visitPlansError ? '计划读取失败' : '今天没有主管计划' }}</strong>
          <p>{{ salesStore.visitPlansError || '仍可从“我的门店”或“附近门店”发起临时拜访。' }}</p>
        </div>
      </van-tab>

      <van-tab title="我的门店">
        <div class="search-wrap">
          <van-search v-model="search" placeholder="搜索本人负责的客户或门店" shape="round" @search="loadTargets" />
        </div>
        <div class="targets-heading">
          <div><strong>负责门店</strong><span v-if="targetPage">{{ targetPage.total }} 家</span></div>
          <van-button size="small" plain type="primary" :loading="salesStore.targetsLoading" @click="loadTargets">刷新</van-button>
        </div>
        <div v-if="creatingTarget" class="inline-loading inline-loading--visit">
          <van-loading size="16" />{{ visitStartHint }}，请勿重复点击
        </div>
        <van-cell-group v-if="targetPage?.items.length" inset>
          <van-cell
            v-for="target in targetPage.items"
            :key="target.projectionId"
            icon="shop-o"
          >
            <template #title><strong>{{ target.storeName }}</strong></template>
            <template #label>
              <span>{{ target.customerName || '未关联客户' }}</span>
              <span v-if="target.storeAddress"> · {{ target.storeAddress }}</span>
            </template>
            <template #value>
              <van-button
                size="mini"
                type="primary"
                plain
                :loading="creatingTarget === target.storeId"
                loading-text="处理中"
                :disabled="Boolean(creatingTarget) && creatingTarget !== target.storeId"
                @click.stop="startMyStoreVisit(target)"
              >发起拜访</van-button>
            </template>
          </van-cell>
        </van-cell-group>
        <div v-else-if="salesStore.targetsLoading" class="target-empty">
          <van-loading type="spinner" /><p>正在读取 CRM 销售归属投影</p>
        </div>
        <div v-else class="target-empty">
          <van-icon class="target-empty__icon" name="shop-o" size="34" />
          <strong>{{ salesStore.errorMessage ? '门店读取失败' : '暂无本人负责门店' }}</strong>
          <p>{{ salesStore.errorMessage || '历史拜访沉淀的门店会出现在这里。' }}</p>
          <van-button v-if="salesStore.errorMessage" type="primary" plain @click="loadTargets">重试</van-button>
        </div>
      </van-tab>

      <van-tab title="附近门店">
        <div class="search-wrap nearby-search">
          <van-search
            v-model="nearbyQuery"
            placeholder="搜索附近门店（可留空）"
            shape="round"
            @search="() => loadNearby()"
          />
          <div class="radius-row">
            <span>范围</span>
            <van-radio-group
              v-model="radiusMeters"
              direction="horizontal"
              :disabled="salesStore.nearbyLoading"
              @change="reloadNearbyAfterRadiusChange"
            >
              <van-radio :name="1000">1km</van-radio>
              <van-radio :name="3000">3km</van-radio>
              <van-radio :name="5000">5km</van-radio>
            </van-radio-group>
            <van-button
              size="mini"
              plain
              type="primary"
              :loading="locating || salesStore.nearbyLoading"
              loading-text="查询中"
              @click="loadNearby(true)"
            >
              {{ location ? '刷新' : '定位' }}
            </van-button>
          </div>
        </div>
        <div v-if="salesStore.nearbyLoading && nearbyPage?.items.length" class="inline-loading">
          <van-loading size="16" />正在更新附近门店
        </div>
        <div v-if="creatingTarget" class="inline-loading inline-loading--visit">
          <van-loading size="16" />{{ visitStartHint }}，请勿重复点击
        </div>
        <div class="targets-heading">
          <div><strong>附近门店</strong><span v-if="nearbyPage">{{ nearbyPage.total }} 家</span></div>
        </div>
        <van-cell-group v-if="nearbyPage?.items.length" inset>
          <van-cell
            v-for="store in nearbyPage.items"
            :key="store.poiId"
            icon="shop-o"
          >
            <template #title>
              <strong>{{ store.name }}</strong>
              <van-tag v-if="store.alreadyInMyStores" plain type="primary" class="store-tag">已入我店</van-tag>
            </template>
            <template #label>
              <span>{{ store.address || '暂无地址' }}</span>
              <span v-if="store.distanceMeters != null"> · {{ Math.round(store.distanceMeters) }}m</span>
            </template>
            <template #value>
              <van-button
                size="mini"
                type="primary"
                plain
                :loading="creatingTarget === store.poiId"
                loading-text="处理中"
                :disabled="Boolean(creatingTarget) && creatingTarget !== store.poiId"
                @click.stop="startPoiVisit(store)"
              >发起拜访</van-button>
            </template>
          </van-cell>
        </van-cell-group>
        <div v-else-if="locating" class="target-empty"><van-loading type="spinner" /><p>正在获取当前位置</p></div>
        <div v-else-if="salesStore.nearbyLoading" class="target-empty"><van-loading type="spinner" /><p>正在查询高德附近门店</p></div>
        <div v-else class="target-empty">
          <van-icon class="target-empty__icon" name="location-o" size="34" />
          <strong>{{ salesStore.nearbyError ? '附近门店查询失败' : '附近暂无门店' }}</strong>
          <p>{{ salesStore.nearbyError || '扩大范围或输入门店名称后重试。' }}</p>
        </div>
      </van-tab>
    </van-tabs>
    <p class="scope-note">今日计划由主管下发；临时拜访可从 CRM 负责门店或高德附近门店发起，附近门店拜访后会沉淀到我的门店。</p>
  </div>
</template>

<style scoped>
.search-wrap { padding: 8px 10px 4px; background: #fff; border-bottom: 1px solid var(--workbench-line); }
.nearby-search { padding-bottom: 6px; }
.radius-row { display: flex; align-items: center; justify-content: space-between; padding: 2px 12px 8px; }
.radius-row > span { color: var(--workbench-muted); font-size: 12px; }
.targets-heading { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 10px; }
.targets-heading div { display: flex; gap: 8px; align-items: baseline; }
.targets-heading strong { color: var(--workbench-ink); font-size: 16px; }
.targets-heading span { color: var(--workbench-muted); font-size: 12px; }
.target-empty { display: flex; flex-direction: column; align-items: center; margin: 18px 14px; padding: 48px 30px; color: var(--workbench-muted); text-align: center; background: #fff; border: 1px solid var(--workbench-line); border-radius: 16px; }
.target-empty__icon { color: #8ba9dd; }
.target-empty strong { margin-top: 14px; color: var(--workbench-ink); font-size: 15px; }
.target-empty p { margin: 8px 0 16px; font-size: 12px; line-height: 1.7; }
.store-tag { margin-left: 6px; }
.scope-note { margin: 14px 18px; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; text-align: center; }
.inline-loading { display: flex; gap: 7px; align-items: center; justify-content: center; padding: 9px 14px; color: var(--workbench-muted); font-size: 12px; background: #eef4ff; }
.inline-loading--visit { color: #1749b6; background: #e6efff; }
.plan-heading { padding-top: 18px; }
.plan-list { display: grid; gap: 12px; padding: 4px 14px 16px; }
.plan-card { padding: 16px; }
.plan-card__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 11px; }
.plan-card__head small { color: var(--workbench-muted); font-size: 11px; }
.plan-card > strong { color: var(--workbench-ink); font-size: 16px; }
.plan-address { margin: 4px 0 11px; color: var(--workbench-muted); font-size: 11px; }
.plan-objective { display: flex; gap: 7px; align-items: flex-start; margin-bottom: 14px; padding: 10px 12px; color: #44536a; font-size: 12px; line-height: 1.55; background: #f5f8fd; border-radius: 10px; }
.plan-objective__icon { margin-top: 2px; color: var(--workbench-primary); }
.plan-status { padding: 4px 9px; color: #315a9b; font-size: 11px; background: #eaf1fd; border-radius: 999px; }
.plan-status--in_progress { color: #08794c; background: #e8f8f0; }
.plan-status--completed { color: #68758a; background: #eef1f5; }
.targets-page :deep(.van-cell__value) { flex: 0 0 auto; }
.targets-page :deep(.van-cell__value .van-button) { min-width: 82px; }
</style>
