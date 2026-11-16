<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import StoreContacts from '@/components/StoreContacts.vue';
import { crmCustomersApi, type CrmCustomer } from '@/api/core/crm-customers';
import { createIdempotencyKey } from '@/utils/id';
import { normalizeError } from '@/api/core/error';
import { useSalesStore } from '@/stores/sales';
import type { CrmCustomerQuery } from '@/api/core/crm-customers';

const store = useSalesStore();
const router = useRouter();
const keyword = ref('');
const view = ref<'MINE' | 'PUBLIC'>('MINE');
const contactStore = ref<CrmCustomer | null>(null);
const claimRequests = new Map<string, string>();
const phase = ref('');
const protection = ref('');
const submitted = ref<CrmCustomerQuery>({});
const pendingId = ref('');
const phaseNames: Record<string, string> = {
  FIRST_VISIT: '待首访', FOLLOW_UP: '持续跟进', COOPERATING: '合作维护',
};
const phaseOptions = [{ text: '全部阶段', value: '' },
  ...Object.entries(phaseNames).map(([value, text]) => ({ value, text }))];
const protectionOptions = [
  { text: '全部保护状态', value: '' }, { text: '24 小时内到期', value: 'DUE_SOON' },
  { text: '已到期待回收', value: 'OVERDUE' }, { text: '暂缓回收', value: 'HELD' },
];
const canClaim = computed(() => store.crmCustomerContext?.permissions.includes('crm:pool:claim') ?? false);
const canVisit = computed(() => store.crmCustomerContext?.permissions.includes('crm:store:visit-write') ?? false);
function date(value: string | null) {
  return value ? new Date(value).toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '暂无';
}
function search() {
  contactStore.value = null;
  submitted.value = { view: view.value, keyword: keyword.value.trim(), ...(view.value === 'MINE' ? { phase: phase.value, protection: protection.value } : {}) };
  void store.loadCrmCustomers(submitted.value);
}
function more() {
  if (!store.crmCustomerCursor || store.crmCustomersLoading) return;
  void store.loadCrmCustomers({ ...submitted.value, cursor: store.crmCustomerCursor }, true);
}
async function visit(id: string) {
  if (pendingId.value) return;
  pendingId.value = id;
  try {
    const result = await store.startCrmVisit(id);
    if (result && 'captureId' in result) {
      await router.push({ path: '/visit', query: { visitId: result.captureId, ...(result.storeId ? { storeId: result.storeId, crmVisitId: result.crmVisitId } : {}) } });
    } else if (result && 'attendanceRequired' in result) {
      showToast('请先完成上班签到');
      await router.push('/attendance');
    } else {
      showToast(store.visitError || '拜访未能开始，请稍后重试');
      await store.loadCrmCustomers(submitted.value);
    }
  } finally {
    pendingId.value = '';
  }
}
async function claim(customer: CrmCustomer) {
  if (pendingId.value) return;
  pendingId.value = customer.id;
  const key = `${customer.id}:${customer.revision}`;
  const requestId = claimRequests.get(key) ?? createIdempotencyKey('claim');
  claimRequests.set(key, requestId);
  try {
    await crmCustomersApi.claim(customer.id, { requestId, revision: customer.revision });
    claimRequests.delete(key); view.value = 'MINE'; phase.value = ''; protection.value = '';
    showToast('认领成功，请在 24 小时内完成首次拜访'); search();
  } catch (e) { showToast(normalizeError(e).message); await store.loadCrmCustomers(submitted.value); }
  finally { pendingId.value = ''; }
}
onMounted(search);
</script>

<template>
  <div class="workbench-page crm-customers-page">
    <van-nav-bar title="CRM 客户" left-arrow @click-left="router.back()" />
    <van-tabs v-model:active="view" @change="search"><van-tab title="我的客户" name="MINE" /><van-tab title="公海认领" name="PUBLIC" /></van-tabs>
    <div class="customer-search">
      <van-search v-model="keyword" placeholder="搜索门店名称或地址" show-action @search="search">
        <template #action><button type="button" class="search-action" @click="search">查询</button></template>
      </van-search>
      <van-dropdown-menu v-if="view === 'MINE'">
        <van-dropdown-item v-model="phase" :options="phaseOptions" @change="search" />
        <van-dropdown-item v-model="protection" :options="protectionOptions" @change="search" />
      </van-dropdown-menu>
    </div>
    <div class="customer-caption">
      <span>{{ view === 'MINE' ? '我的客户' : '可认领公海' }} <strong>{{ store.crmCustomerTotal }}</strong></span>
      <van-button size="small" plain :loading="store.crmCustomersLoading" @click="search">刷新</van-button>
    </div>
    <p class="customer-rule">24 小时首访 · 7 天跟进 · 本轮成交后 60 天维护</p>
    <van-notice-bar v-if="pendingId" :text="store.crmVisitStage || '正在打开拜访工作区'" />
    <van-notice-bar v-if="store.crmCustomersError" wrapable :text="store.crmCustomersError" color="var(--van-danger-color)" />
    <div v-if="store.crmCustomersLoading && !store.crmCustomers.length" class="customer-empty">
      <van-loading>正在读取我的客户</van-loading>
    </div>
    <van-empty v-else-if="!store.crmCustomers.length" :description="store.crmCustomersError ? '读取失败，请重试' : view === 'MINE' ? '暂无符合条件的私海客户，可先从公海认领' : '暂无符合授权范围的公海门店'" />
    <section v-for="customer in store.crmCustomers" :key="customer.id" class="customer-card surface-card">
      <div class="customer-card-heading">
        <h2>{{ customer.name }}</h2>
        <van-tag v-if="view === 'MINE'" class="customer-phase" plain type="primary">{{ phaseNames[customer.phase ?? ''] || '跟进中' }}</van-tag>
      </div>
      <p class="customer-address">{{ customer.address }}</p>
      <div class="customer-tags">
        <van-tag plain :type="customer.cooperationStatus === 'COOPERATED' ? 'success' : 'default'">
          {{ customer.cooperationStatus === 'COOPERATED' ? '历史合作' : '未合作' }}
        </van-tag>
        <van-tag v-if="customer.customerTier !== 'UNRATED'" plain>价值 {{ customer.customerTier }}</van-tag>
      </div>
      <dl>
        <div v-if="view === 'MINE'"><dt>保护截止</dt><dd>{{ date(customer.deadlineAt) }}<span v-if="customer.holdReason"> · 暂缓回收</span></dd></div>
        <div><dt>最近有效拜访</dt><dd>{{ date(customer.lastVisitAt) }}</dd></div>
        <div v-if="customer.publicPhone"><dt>公开电话</dt><dd>{{ customer.publicPhone }}</dd></div>
      </dl>
      <van-button
        v-if="view === 'MINE' && canVisit" block type="primary" :plain="customer.phase !== 'FIRST_VISIT'"
        :loading="pendingId === customer.id" :loading-text="store.crmVisitStage || '处理中'"
        :disabled="!!pendingId && pendingId !== customer.id" @click="visit(customer.id)">
        开始 / 继续拜访
      </van-button>
      <van-button v-if="view === 'MINE'" block plain class="contacts-button" @click="contactStore = customer">联系人与联系方式</van-button>
      <template v-else><p v-if="customer.claimBlockedReason" class="customer-rule">{{ customer.claimBlockedReason }}</p><van-button v-if="canClaim" block type="primary" :loading="pendingId === customer.id" :disabled="!!customer.claimBlockedReason || (!!pendingId && pendingId !== customer.id)" @click="claim(customer)">认领到我的客户</van-button></template>
    </section>
    <van-popup :show="!!contactStore" position="bottom" round @update:show="v => { if (!v) contactStore = null; }"><div class="contacts-sheet"><van-nav-bar :title="contactStore?.name" left-text="关闭" @click-left="contactStore = null" /><StoreContacts v-if="contactStore" :key="contactStore.id" :store-id="contactStore.id" :editable="canVisit" /></div></van-popup>
    <div v-if="store.crmCustomerCursor" class="customer-more">
      <van-button block plain :loading="store.crmCustomersLoading" @click="more">加载更多</van-button>
    </div>
  </div>
</template>

<style scoped>
.contacts-button { margin-top: 12px; }
.contacts-sheet { max-height: 88vh; overflow-y: auto; padding-bottom: env(safe-area-inset-bottom); }
.customer-search { background: var(--van-background-2); }
.search-action { background: none; border: 0; padding: 0 8px; color: var(--van-primary-color); }
.customer-caption { display: flex; justify-content: space-between; align-items: center; padding: 16px 16px 0; }
.customer-caption strong { margin-left: 6px; font-variant-numeric: tabular-nums; }
.customer-rule { margin: 8px 16px 16px; font-size: 12px; color: var(--van-text-color-2); }
.customer-card { margin: 12px 16px; padding: 16px; }
.customer-card-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.customer-card-heading h2 { font-size: 16px; line-height: 1.5; margin: 0; }
.customer-phase { flex-shrink: 0; margin-top: 4px; }
.customer-address { font-size: 13px; line-height: 1.5; color: var(--van-text-color-2); margin: 8px 0; }
.customer-tags { display: flex; gap: 6px; }
.customer-card dl { margin: 16px 0; font-size: 13px; line-height: 1.6; }
.customer-card dl > div { display: flex; justify-content: space-between; gap: 12px; margin-top: 6px; }
.customer-card dt { color: var(--van-text-color-2); flex-shrink: 0; }
.customer-card dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.customer-empty, .customer-more { padding: 24px 16px; text-align: center; }
</style>
