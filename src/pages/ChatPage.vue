<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useCollaborationStore } from '@/stores/collaboration';
import type { ConversationSummaryView, DirectoryUserView } from '@/api/core/collaboration';

const router = useRouter();
const collaborationStore = useCollaborationStore();
const searchKeyword = ref('');
const groupTitle = ref('');
const selectedUserIds = ref<string[]>([]);

const conversations = computed(() => collaborationStore.conversations);
const directoryUsers = computed(() => collaborationStore.directoryUsers);
const selectedUsers = computed(() => directoryUsers.value
  .filter((user) => selectedUserIds.value.includes(user.userId)));

function previewText(conversation: ConversationSummaryView): string {
  if (!conversation.lastMessage) return '暂无消息';
  if (conversation.lastMessage.status === 'RECALLED') return '一条消息已撤回';
  if (conversation.lastMessage.messageType === 'TEXT') return conversation.lastMessage.previewText || '文本消息';
  if (conversation.lastMessage.messageType === 'IMAGE') return '[图片]';
  if (conversation.lastMessage.messageType === 'VOICE') return '[语音]';
  return '[文件]';
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toggleUser(user: DirectoryUserView) {
  selectedUserIds.value = selectedUserIds.value.includes(user.userId)
    ? selectedUserIds.value.filter((id) => id !== user.userId)
    : [...selectedUserIds.value, user.userId];
}

async function searchDirectory() {
  await collaborationStore.loadDirectory(searchKeyword.value);
  if (collaborationStore.errorMessage) showToast(collaborationStore.errorMessage);
}

async function openConversation(conversation: ConversationSummaryView) {
  await router.push(`/chat/${conversation.id}`);
}

async function startDirect(user: DirectoryUserView) {
  const conversation = await collaborationStore.createDirect(user.userId);
  if (!conversation) {
    showToast(collaborationStore.errorMessage || '单聊创建失败');
    return;
  }
  await router.push(`/chat/${conversation.id}`);
}

async function createGroup() {
  if (!selectedUserIds.value.length) {
    showToast('请选择至少一名成员');
    return;
  }
  const title = groupTitle.value.trim() || selectedUsers.value.map((user) => user.displayName).join('、');
  const conversation = await collaborationStore.createGroup(title, selectedUserIds.value);
  if (!conversation) {
    showToast(collaborationStore.errorMessage || '群聊创建失败');
    return;
  }
  selectedUserIds.value = [];
  groupTitle.value = '';
  await router.push(`/chat/${conversation.id}`);
}

async function registerPush() {
  const result = await collaborationStore.registerPushDevice();
  showToast(result ? '当前设备已登记推送' : (collaborationStore.errorMessage || '当前环境暂不支持推送登记'));
}

onMounted(() => {
  void collaborationStore.loadConversations();
  void collaborationStore.loadDirectory();
});
</script>

<template>
  <div class="workbench-page chat-page">
    <van-nav-bar title="内部沟通" fixed placeholder />

    <div class="workbench-body chat-body">
      <section class="surface-card chat-hero">
        <div>
          <p>销售工作台内置 IM</p>
          <h1>单聊、群聊、未读和会议入口</h1>
        </div>
        <van-button
          size="small"
          plain
          type="primary"
          :loading="collaborationStore.pushRegistering"
          @click="registerPush"
        >
          登记推送
        </van-button>
      </section>

      <section class="section-heading">
        <h2>会话</h2>
        <span>{{ conversations.length }} 个</span>
      </section>

      <van-empty
        v-if="!collaborationStore.conversationsLoading && conversations.length === 0"
        image="search"
        description="暂无会话，可从通讯录发起单聊或建群"
      />
      <van-skeleton v-else-if="collaborationStore.conversationsLoading" title :row="4" />
      <div v-else class="conversation-list">
        <button
          v-for="conversation in conversations"
          :key="conversation.id"
          type="button"
          class="conversation-item surface-card"
          @click="openConversation(conversation)"
        >
          <span class="conversation-avatar">
            <van-icon :name="conversation.type === 'GROUP' ? 'friends-o' : 'user-o'" />
          </span>
          <span class="conversation-main">
            <span class="conversation-title">
              {{ conversation.title || (conversation.type === 'GROUP' ? '群聊' : '单聊') }}
            </span>
            <span class="conversation-preview">{{ previewText(conversation) }}</span>
          </span>
          <span class="conversation-meta">
            <small>{{ formatUpdatedAt(conversation.updatedAt) }}</small>
            <van-badge v-if="conversation.unreadCount > 0" :content="conversation.unreadCount" />
          </span>
        </button>
      </div>

      <section class="section-heading">
        <h2>通讯录</h2>
        <span>内部员工</span>
      </section>

      <div class="surface-card directory-panel">
        <van-search
          v-model="searchKeyword"
          placeholder="搜索姓名"
          shape="round"
          @search="searchDirectory"
          @clear="searchDirectory"
        />
        <div class="directory-users">
          <div
            v-for="user in directoryUsers"
            :key="user.userId"
            class="directory-user"
          >
            <button type="button" class="directory-user__main" @click="toggleUser(user)">
              <span class="directory-avatar">{{ user.displayName.slice(0, 1) }}</span>
              <span>
                <strong>{{ user.displayName }}</strong>
                <small>{{ user.status === 'ACTIVE' ? '在职' : user.status }}</small>
              </span>
            </button>
            <van-button size="small" plain type="primary" @click="startDirect(user)">单聊</van-button>
            <van-tag
              :type="selectedUserIds.includes(user.userId) ? 'primary' : 'default'"
              plain
              @click="toggleUser(user)"
            >
              {{ selectedUserIds.includes(user.userId) ? '已选' : '入群' }}
            </van-tag>
          </div>
        </div>

        <div v-if="selectedUserIds.length > 0" class="group-creator">
          <van-field
            v-model="groupTitle"
            label="群名"
            placeholder="不填则按成员姓名生成"
            clearable
          />
          <van-button block round type="primary" @click="createGroup">
            创建群聊（{{ selectedUserIds.length }}人）
          </van-button>
        </div>
      </div>

      <p v-if="collaborationStore.errorMessage" class="chat-error">
        {{ collaborationStore.errorMessage }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.chat-body {
  padding-top: 14px;
}

.chat-hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
}

.chat-hero p {
  color: var(--workbench-muted);
  font-size: 12px;
}

.chat-hero h1 {
  margin-top: 4px;
  color: var(--workbench-ink);
  font-size: 18px;
}

.conversation-list {
  display: grid;
  gap: 10px;
}

.conversation-item {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px;
  border: 0;
  text-align: left;
}

.conversation-avatar,
.directory-avatar {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  color: #fff;
  background: linear-gradient(135deg, #2468f2, #55a4ff);
}

.conversation-main {
  display: grid;
  flex: 1;
  min-width: 0;
  margin-left: 10px;
}

.conversation-title {
  color: var(--workbench-ink);
  font-weight: 700;
}

.conversation-preview {
  overflow: hidden;
  color: var(--workbench-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-meta {
  display: grid;
  justify-items: end;
  gap: 6px;
  color: var(--workbench-muted);
  font-size: 11px;
}

.directory-panel {
  padding-bottom: 10px;
}

.directory-users {
  display: grid;
  gap: 2px;
  padding: 0 10px 10px;
}

.directory-user {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 52px;
  border-bottom: 1px solid var(--workbench-line);
}

.directory-user:last-child {
  border-bottom: 0;
}

.directory-user__main {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 10px;
  min-width: 0;
  border: 0;
  background: transparent;
  text-align: left;
}

.directory-user__main strong,
.directory-user__main small {
  display: block;
}

.directory-user__main small {
  color: var(--workbench-muted);
  font-size: 12px;
}

.group-creator {
  display: grid;
  gap: 10px;
  padding: 10px 12px 2px;
  border-top: 1px solid var(--workbench-line);
}

.chat-error {
  margin: 12px 2px 0;
  color: var(--van-danger-color);
  font-size: 12px;
}
</style>
