<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { showToast } from 'vant';
import { crmContactsApi, type StoreContact, type ContactMethod } from '@/api/core/crm-contacts';
import { crmCustomersApi, type CrmCustomer } from '@/api/core/crm-customers';
import { createIdempotencyKey } from '@/utils/id';
import { normalizeError } from '@/api/core/error';

const props = withDefaults(
  defineProps<{ storeId: string; visitId?: string; submitted?: boolean; editable?: boolean }>(),
  { visitId: '', editable: true },
);
const contacts = ref<StoreContact[]>([]);
const selected = ref<string[]>([]);
const savedSelection = ref<string[]>([]);
const snapshots = ref<StoreContact[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const dialog = ref('');
const dialogTitles: Record<string, string> = {
  create: '新增联系人',
  edit: '编辑联系人与门店关系',
  method: '补充联系方式',
  verify: '核验电话',
  link: '关联已有联系人',
  history: '变更记录',
};
const current = ref<StoreContact | null>(null);
const method = ref<ContactMethod | null>(null);
const name = ref('');
const role = ref('');
const phone = ref('');
const wechat = ref('');
const primary = ref(false);
const status = ref('ACTIVE');
const reason = ref('');
const methodType = ref('PHONE');
const methodValue = ref('');
const verification = ref('PHONE_CALL');
const methodStatus = ref('VERIFIED');
const sourceKeyword = ref('');
const sourceStores = ref<CrmCustomer[]>([]);
const sourceId = ref('');
const sourceContacts = ref<StoreContact[]>([]);
const sourceContact = ref('');
const history = ref<{ id: string; reason: string; occurredAt: string }[]>([]);
const requests = new Map<string, string>();
let generation = 0;
const active = computed(() => contacts.value.filter((c) => c.status === 'ACTIVE'));
const changed = computed(
  () => [...selected.value].sort().join(',') !== [...savedSelection.value].sort().join(','),
);
function key(body: unknown) {
  const value = JSON.stringify(body);
  if (!requests.has(value)) requests.set(value, createIdempotencyKey('contact'));
  return requests.get(value)!;
}
async function load() {
  const version = ++generation;
  loading.value = true;
  error.value = '';
  contacts.value = [];
  try {
    const [list, reception] = await Promise.all([
      crmContactsApi.list(props.storeId),
      props.visitId ? crmContactsApi.reception(props.storeId, props.visitId) : null,
    ]);
    if (version !== generation) return;
    contacts.value = list.data;
    snapshots.value = reception?.data ?? [];
    selected.value = snapshots.value.map((c) => c.id);
    savedSelection.value = [...selected.value];
  } catch (e) {
    if (version === generation) error.value = normalizeError(e).message;
  } finally {
    if (version === generation) loading.value = false;
  }
}
function open(
  mode: string,
  person: StoreContact | null = null,
  channel: ContactMethod | null = null,
) {
  current.value = person;
  method.value = channel;
  name.value = person?.name ?? '';
  role.value = person?.role ?? '';
  primary.value = person?.primary ?? false;
  status.value = person?.status ?? 'ACTIVE';
  phone.value = '';
  wechat.value = '';
  reason.value = '';
  methodValue.value = '';
  methodType.value = 'PHONE';
  methodStatus.value = 'VERIFIED';
  verification.value = 'PHONE_CALL';
  sourceId.value = '';
  sourceContact.value = '';
  sourceContacts.value = [];
  sourceStores.value = [];
  history.value = [];
  dialog.value = mode;
}
async function save() {
  if (busy.value) return;
  if (
    ['create', 'edit', 'link'].includes(dialog.value) &&
    (!role.value.trim() || (dialog.value !== 'link' && !name.value.trim()))
  ) {
    showToast('请填写姓名或称呼与门店角色');
    return;
  }
  if (dialog.value === 'create' && !phone.value.trim()) {
    showToast('正式联系人需提供电话；未留资可直接记录拜访');
    return;
  }
  if (dialog.value !== 'create' && !reason.value.trim()) {
    showToast('请填写变更或核验依据');
    return;
  }
  busy.value = true;
  const selection = [...selected.value];
  try {
    const person = current.value;
    if (dialog.value === 'create') {
      const body = {
        name: name.value.trim(),
        role: role.value.trim(),
        primary: primary.value,
        phone: phone.value.trim(),
        wechatHint: wechat.value.trim(),
      };
      await crmContactsApi.create(props.storeId, {
        ...body,
        requestId: key(['create', props.storeId, body]),
      });
    } else if (dialog.value === 'edit' && person) {
      const body = {
        name: name.value.trim(),
        role: role.value.trim(),
        primary: status.value === 'ACTIVE' && primary.value,
        status: status.value,
        reason: reason.value.trim(),
        revision: person.revision,
        personRevision: person.personRevision,
      };
      await crmContactsApi.update(props.storeId, person.id, {
        ...body,
        requestId: key(['edit', person.id, body]),
      });
    } else if (dialog.value === 'method' && person) {
      const body = {
        type: methodType.value,
        value: methodValue.value.trim(),
        reason: reason.value.trim(),
      };
      await crmContactsApi.addMethod(props.storeId, person.id, {
        ...body,
        requestId: key(['method', person.id, body]),
      });
    } else if (dialog.value === 'verify' && person && method.value) {
      const body = {
        revision: method.value.revision,
        status: methodStatus.value,
        verificationMethod: verification.value,
        reason: reason.value.trim(),
      };
      await crmContactsApi.verify(props.storeId, person.id, method.value.id, {
        ...body,
        requestId: key(['verify', method.value.id, body]),
      });
    } else if (dialog.value === 'link') {
      if (!sourceId.value || !sourceContact.value)
        throw new Error('请选择已确认的来源门店及联系人');
      const body = {
        sourceStoreId: sourceId.value,
        contactId: sourceContact.value,
        role: role.value.trim(),
        primary: primary.value,
        reason: reason.value.trim(),
      };
      await crmContactsApi.link(props.storeId, {
        ...body,
        requestId: key(['link', props.storeId, body]),
      });
    }
    dialog.value = '';
    requests.clear();
    await load();
    if (!props.submitted)
      selected.value = selection.filter((id) => active.value.some((c) => c.id === id));
    showToast('联系人已保存');
  } catch (e) {
    showToast(normalizeError(e).message);
  } finally {
    busy.value = false;
  }
}
async function saveReception() {
  if (!props.visitId || props.submitted) return;
  if (loading.value || error.value) throw new Error(error.value || '联系人仍在加载，请稍后重试');
  const body = { contactIds: [...selected.value].sort() };
  const result = await crmContactsApi.saveReception(props.storeId, props.visitId, {
    ...body,
    requestId: key(['reception', props.visitId, body]),
  });
  snapshots.value = result.data;
  savedSelection.value = [...selected.value];
}
async function searchSource() {
  try {
    sourceStores.value = (
      await crmCustomersApi.list({ keyword: sourceKeyword.value.trim() })
    ).data.items.filter((s) => s.id !== props.storeId);
  } catch (e) {
    showToast(normalizeError(e).message);
  }
}
async function selectSource(id: string) {
  sourceId.value = id;
  sourceContact.value = '';
  sourceContacts.value = [];
  try {
    const result = await crmContactsApi.list(id);
    if (sourceId.value === id)
      sourceContacts.value = result.data.filter((c) => c.status === 'ACTIVE');
  } catch (e) {
    showToast(normalizeError(e).message);
  }
}
async function showHistory(person: StoreContact) {
  open('history', person);
  try {
    history.value = (await crmContactsApi.changes(props.storeId, person.id)).data;
  } catch (e) {
    showToast(normalizeError(e).message);
  }
}
watch(() => [props.storeId, props.visitId], load, { immediate: true });
defineExpose({ saveReception, changed });
</script>

<template>
  <section class="contacts">
    <div class="contacts-heading">
      <h3>{{ visitId ? '本次接待联系人' : '门店联系人' }}</h3>
      <van-button v-if="editable" size="small" @click="open('create')">新增联系人</van-button>
    </div>
    <p v-if="visitId" class="contacts-help">可多选；未取得联系方式时，在拜访纪要记录即可。</p>
    <van-loading v-if="loading">正在加载联系人</van-loading>
    <div v-else-if="error" role="alert">
      <p>{{ error }}</p>
      <van-button size="small" @click="load">重新加载</van-button>
    </div>
    <template v-else>
      <p v-if="!contacts.length" class="contacts-help">暂无联系人</p>
      <p v-if="submitted && visitId" class="contacts-help">
        本次接待：{{ snapshots.map((c) => `${c.name}（${c.role}）`).join('、') || '未关联联系人' }}
      </p>
      <van-checkbox-group v-if="visitId && !submitted" v-model="selected">
        <van-checkbox
          v-for="person in active"
          :key="person.id"
          :name="person.id"
          class="contact-select"
          >{{ person.name }} · {{ person.role }}</van-checkbox
        >
      </van-checkbox-group>
      <article v-for="person in contacts" :key="person.id" class="contact-row">
        <strong>{{ person.name }}</strong
        ><span> · {{ person.role }}</span>
        <van-tag v-if="person.primary" plain type="primary">主要联系人</van-tag
        ><van-tag v-if="person.status === 'LEFT'" plain>已离职 / 关系失效</van-tag>
        <div v-for="channel in person.methods" :key="channel.id" class="contact-method">
          <span
            >{{ channel.type === 'PHONE' ? '电话' : '微信线索' }} {{ channel.value
            }}<small>{{
              channel.status === 'VERIFIED'
                ? '已核验'
                : channel.status === 'INVALID'
                  ? '已失效'
                  : channel.type === 'PHONE'
                    ? '待核实'
                    : '未确认建联'
            }}</small></span
          >
          <van-button
            v-if="editable && person.status === 'ACTIVE' && channel.type === 'PHONE'"
            size="small"
            @click="open('verify', person, channel)"
            >核验</van-button
          >
        </div>
        <p v-if="person.wecomRelations.length" class="contacts-help">
          企微有效联系关系
          {{ person.wecomRelations.filter((r) => r.status === 'ACTIVE').length }} 条
        </p>
        <div class="contact-actions">
          <van-button v-if="editable" size="small" @click="open('edit', person)"
            >编辑关系</van-button
          ><van-button
            v-if="editable && person.status === 'ACTIVE'"
            size="small"
            @click="open('method', person)"
            >补联系方式</van-button
          ><van-button size="small" @click="showHistory(person)">变更记录</van-button>
        </div>
      </article>
      <van-button v-if="editable" block plain @click="open('link')"
        >关联其他本人门店的联系人</van-button
      >
    </template>
    <van-popup
      :show="!!dialog"
      position="bottom"
      round
      :close-on-click-overlay="!busy"
      @update:show="
        (v) => {
          if (!v) dialog = '';
        }
      "
    >
      <div class="contact-editor">
        <h3>{{ dialogTitles[dialog] }}</h3>
        <template v-if="dialog === 'link'">
          <van-search
            v-model="sourceKeyword"
            show-action
            placeholder="搜索本人其他门店"
            @search="searchSource"
            ><template #action><button @click="searchSource">查询</button></template></van-search
          >
          <van-radio-group :model-value="sourceId" @update:model-value="selectSource"
            ><van-radio
              v-for="item in sourceStores"
              :key="item.id"
              :name="item.id"
              class="contact-select"
              >{{ item.name }}</van-radio
            ></van-radio-group
          >
          <van-radio-group v-model="sourceContact"
            ><van-radio
              v-for="item in sourceContacts"
              :key="item.id"
              :name="item.id"
              class="contact-select"
              >{{ item.name }} · {{ item.role }}</van-radio
            ></van-radio-group
          >
        </template>
        <van-field
          v-if="['create', 'edit'].includes(dialog)"
          v-model="name"
          label="姓名 / 称呼"
          required
          maxlength="100"
        />
        <van-field
          v-if="['create', 'edit', 'link'].includes(dialog)"
          v-model="role"
          label="本店角色"
          required
          maxlength="50"
          placeholder="例如：老板、店长、前台"
        />
        <van-field
          v-if="dialog === 'create'"
          v-model="phone"
          label="电话"
          required
          type="tel"
          placeholder="手机或含区号的座机"
        />
        <van-field
          v-if="dialog === 'create'"
          v-model="wechat"
          label="微信线索"
          maxlength="200"
          placeholder="选填，不算已建联"
        />
        <div v-if="['create', 'edit', 'link'].includes(dialog)" class="editor-options">
          <van-checkbox v-model="primary">设为本店主要联系人</van-checkbox>
        </div>
        <div v-if="dialog === 'edit'" class="editor-options">
          <van-radio-group v-model="status" direction="horizontal"
            ><van-radio name="ACTIVE">在职 / 有效</van-radio
            ><van-radio name="LEFT">离职 / 关系失效</van-radio></van-radio-group
          >
          <p class="contacts-help">
            姓名及联系方式属于同一个人，关联门店共用；角色与离职状态仅影响本店。
          </p>
        </div>
        <template v-if="dialog === 'method'"
          ><div class="editor-options">
            <van-radio-group v-model="methodType" direction="horizontal"
              ><van-radio name="PHONE">电话</van-radio
              ><van-radio name="WECHAT_HINT">微信线索</van-radio></van-radio-group
            >
          </div>
          <van-field v-model="methodValue" label="联系方式" required
        /></template>
        <template v-if="dialog === 'verify'"
          ><p>{{ method?.value }}</p>
          <div class="editor-options">
            <van-radio-group v-model="methodStatus" direction="horizontal"
              ><van-radio name="VERIFIED">已确认可用</van-radio
              ><van-radio name="INVALID">已失效</van-radio
              ><van-radio name="PENDING">待核实</van-radio></van-radio-group
            >
          </div>
          <div v-if="methodStatus === 'VERIFIED'" class="editor-options">
            <van-radio-group v-model="verification" direction="horizontal"
              ><van-radio name="PHONE_CALL">已拨通</van-radio
              ><van-radio name="ON_SITE">现场确认</van-radio></van-radio-group
            >
          </div></template
        >
        <van-field
          v-if="!['create', 'history'].includes(dialog)"
          v-model="reason"
          label="依据 / 原因"
          required
          type="textarea"
          maxlength="500"
        />
        <p v-if="dialog === 'create'" class="contacts-help">
          电话保存后为待核实。手填微信昵称不能代替企微同步建联。
        </p>
        <template v-if="dialog === 'history'"
          ><p v-for="entry in history" :key="entry.id">
            {{ new Date(entry.occurredAt).toLocaleString('zh-CN') }} · {{ entry.reason }}
          </p>
          <p v-if="!history.length">暂无变更记录</p></template
        >
        <van-button v-else block type="primary" :loading="busy" @click="save">保存</van-button
        ><van-button block plain :disabled="busy" @click="dialog = ''">{{
          dialog === 'history' ? '关闭' : '取消'
        }}</van-button>
      </div>
    </van-popup>
  </section>
</template>

<style scoped>
.contacts {
  padding: 16px;
  background: var(--van-background-2);
}
.contacts-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.contacts h3 {
  margin: 0;
  font-size: 16px;
}
.contacts-help {
  color: var(--van-text-color-2);
  font-size: 13px;
  line-height: 1.6;
}
.contact-row {
  padding: 16px 0;
  border-top: 1px solid var(--van-border-color);
  font-size: 14px;
}
.contact-row :deep(.van-tag) {
  margin-left: 8px;
}
.contact-method {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 12px 0;
  overflow-wrap: anywhere;
}
.contact-method small {
  display: block;
  margin-top: 4px;
  color: var(--van-text-color-2);
}
.contact-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.contacts :deep(.van-button--small),
.contact-select {
  min-height: 44px;
}
.contact-select {
  display: flex;
  align-items: center;
}
.contact-editor {
  padding: 24px 16px calc(24px + env(safe-area-inset-bottom));
  max-height: 82vh;
  overflow-y: auto;
}
.contact-editor > :deep(.van-button) {
  margin-top: 12px;
}
.editor-options {
  margin: 16px 0;
}
.editor-options :deep(.van-radio) {
  min-height: 44px;
}
</style>
