<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSalesStore } from '@/stores/sales';

const salesStore = useSalesStore();
const search = ref('');
const submittedQuery = ref('');
const targetPage = computed(() => salesStore.targets);

function loadTargets() {
  submittedQuery.value = search.value.trim();
  void salesStore.loadTargets(submittedQuery.value);
}

onMounted(loadTargets);
</script>

<template>
  <div class="workbench-page targets-page">
    <van-nav-bar title="客户与门店" left-arrow @click-left="$router.back()" />
    <div class="search-wrap">
      <van-search v-model="search" placeholder="搜索本人负责的客户或门店" shape="round" @search="loadTargets" />
    </div>

    <div class="targets-heading">
      <div><strong>负责门店</strong><span v-if="targetPage">{{ targetPage.total }} 家</span></div>
      <van-button size="small" plain type="primary" :loading="salesStore.targetsLoading" @click="loadTargets">刷新</van-button>
    </div>

    <van-cell-group v-if="targetPage?.items.length" inset>
      <van-cell v-for="target in targetPage.items" :key="target.projectionId" icon="shop-o">
        <template #title><strong>{{ target.storeName }}</strong></template>
        <template #label>
          <span>{{ target.customerName || '未关联客户' }}</span>
          <span v-if="target.storeAddress"> · {{ target.storeAddress }}</span>
        </template>
        <template #value>{{ target.storeStatus }}</template>
      </van-cell>
    </van-cell-group>

    <div v-else-if="salesStore.targetsLoading" class="target-empty">
      <van-loading type="spinner" /><p>正在读取 CRM 销售归属投影</p>
    </div>
    <div v-else class="target-empty">
      <van-icon class="target-empty__icon" name="shop-o" size="34" />
      <strong>{{ salesStore.errorMessage ? '门店读取失败' : '暂无本人负责门店' }}</strong>
      <p>{{ salesStore.errorMessage || '列表来自CRM门店和销售归属只读投影，不在Sales Work重复维护。' }}</p>
      <van-button v-if="salesStore.errorMessage" type="primary" plain @click="loadTargets">重试</van-button>
    </div>

    <p class="scope-note">当前查询：{{ submittedQuery || '全部' }}。客户、新线索和拜访写入能力按后续阶段开放。</p>
  </div>
</template>

<style scoped>
.search-wrap { padding: 8px 10px; background: #fff; border-bottom: 1px solid var(--workbench-line); }
.targets-heading { display: flex; align-items: center; justify-content: space-between; padding: 16px 14px 10px; }
.targets-heading div { display: flex; gap: 8px; align-items: baseline; }
.targets-heading strong { color: var(--workbench-ink); font-size: 16px; }
.targets-heading span { color: var(--workbench-muted); font-size: 12px; }
.target-empty { display: flex; flex-direction: column; align-items: center; margin: 18px 14px; padding: 48px 30px; color: var(--workbench-muted); text-align: center; background: #fff; border: 1px solid var(--workbench-line); border-radius: 16px; }
.target-empty__icon { color: #8ba9dd; }
.target-empty strong { margin-top: 14px; color: var(--workbench-ink); font-size: 15px; }
.target-empty p { margin: 8px 0 16px; font-size: 12px; line-height: 1.7; }
.scope-note { margin: 14px 18px; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; text-align: center; }
</style>
