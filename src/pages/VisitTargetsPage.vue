<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import type { NearbyStoreView, PoiTargetCommand, VisitTargetView } from '@/api/core/sales';
import { useSalesStore } from '@/stores/sales';
import { createIdempotencyKey } from '@/utils/id';
import { localDate } from '@/utils/datetime';

const salesStore = useSalesStore();
const router = useRouter();
const route = useRoute();
const adapter = getFeishuAdapter();

const activeTab = ref(Number(route.query.tab ?? 0));
const search = ref('');
const submittedQuery = ref('');
const nearbyQuery = ref('');
const radiusMeters = ref(3000);
const location = ref<{ longitude: number; latitude: number; accuracy: number } | null>(null);
const locating = ref(false);
const targetPage = computed(() => salesStore.targets);
const nearbyPage = computed(() => salesStore.nearbyStores);
const creatingTarget = ref<string | null>(null);

function loadTargets() {
  submittedQuery.value = search.value.trim();
  void salesStore.loadTargets(submittedQuery.value);
}

async function loadNearby() {
  if (!location.value) {
    locating.value = true;
    try {
      const current = await adapter.getCurrentLocation();
      location.value = { longitude: current.longitude, latitude: current.latitude, accuracy: current.accuracy };
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
  );
}

function onTabChange(tab: number | string) {
  activeTab.value = Number(tab);
  if (activeTab.value === 1 && !nearbyPage.value) {
    void loadNearby();
  }
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
  extra: { storeId?: string; poi?: PoiTargetCommand },
) {
  creatingTarget.value = extra.storeId ?? extra.poi?.poiId ?? 'poi';
  try {
    const workDay = await salesStore.loadWorkDay(localDate());
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
    const current = await adapter.getCurrentLocation();
    const visit = await salesStore.createVisit({
      idempotencyKey: createIdempotencyKey('visit'),
      workDayId: workDay.id,
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
  }
}

onMounted(() => {
  loadTargets();
  if (activeTab.value === 1) void loadNearby();
});
</script>

<template>
  <div class="workbench-page targets-page">
    <van-nav-bar title="客户与门店" left-arrow @click-left="$router.back()" />
    <van-tabs v-model:active="activeTab" sticky offset-top="46" @change="onTabChange">
      <van-tab title="我的门店">
        <div class="search-wrap">
          <van-search v-model="search" placeholder="搜索本人负责的客户或门店" shape="round" @search="loadTargets" />
        </div>
        <div class="targets-heading">
          <div><strong>负责门店</strong><span v-if="targetPage">{{ targetPage.total }} 家</span></div>
          <van-button size="small" plain type="primary" :loading="salesStore.targetsLoading" @click="loadTargets">刷新</van-button>
        </div>
        <van-cell-group v-if="targetPage?.items.length" inset>
          <van-cell
            v-for="target in targetPage.items"
            :key="target.projectionId"
            icon="shop-o"
            is-link
            :loading="creatingTarget === target.storeId"
            @click="startMyStoreVisit(target)"
          >
            <template #title><strong>{{ target.storeName }}</strong></template>
            <template #label>
              <span>{{ target.customerName || '未关联客户' }}</span>
              <span v-if="target.storeAddress"> · {{ target.storeAddress }}</span>
            </template>
            <template #value>拜访</template>
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
          <van-search v-model="nearbyQuery" placeholder="搜索附近门店（可留空）" shape="round" @search="loadNearby" />
          <div class="radius-row">
            <span>范围</span>
            <van-radio-group v-model="radiusMeters" direction="horizontal" @change="loadNearby">
              <van-radio :name="1000">1km</van-radio>
              <van-radio :name="3000">3km</van-radio>
              <van-radio :name="5000">5km</van-radio>
            </van-radio-group>
            <van-button size="mini" plain type="primary" :loading="locating || salesStore.nearbyLoading" @click="loadNearby">
              {{ location ? '刷新' : '定位' }}
            </van-button>
          </div>
        </div>
        <div class="targets-heading">
          <div><strong>附近门店</strong><span v-if="nearbyPage">{{ nearbyPage.total }} 家</span></div>
        </div>
        <van-cell-group v-if="nearbyPage?.items.length" inset>
          <van-cell
            v-for="store in nearbyPage.items"
            :key="store.poiId"
            icon="shop-o"
            is-link
            :loading="creatingTarget === store.poiId"
            @click="startPoiVisit(store)"
          >
            <template #title>
              <strong>{{ store.name }}</strong>
              <van-tag v-if="store.alreadyInMyStores" plain type="primary" class="store-tag">已入我店</van-tag>
            </template>
            <template #label>
              <span>{{ store.address || '暂无地址' }}</span>
              <span v-if="store.distanceMeters != null"> · {{ Math.round(store.distanceMeters) }}m</span>
            </template>
            <template #value>拜访</template>
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
    <p class="scope-note">我的门店来自 CRM 归属和历史拜访沉淀；附近门店来自高德 POI，拜访后自动沉淀到我的门店。</p>
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
</style>
