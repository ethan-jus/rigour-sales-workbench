<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import { useAuthStore } from '@/stores/auth';
import { useCollaborationStore } from '@/stores/collaboration';
import type { ConversationMemberView, MessageView } from '@/api/core/collaboration';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();
const collaborationStore = useCollaborationStore();
const draft = ref('');
const fileInput = ref<HTMLInputElement | null>(null);
const mentionedUserIds = ref<string[]>([]);
const messageList = ref<HTMLElement | null>(null);

const conversationId = computed(() => String(route.params.conversationId || ''));
const currentUserId = computed(() => authStore.userId || localStorage.getItem('auth_user_id') || '');
const conversation = computed(() => collaborationStore.currentConversation);
const messages = computed(() => collaborationStore.currentMessages);
const members = computed(() => collaborationStore.currentMembers);
const activeMeeting = computed(() => (
  collaborationStore.activeMeeting?.conversationId === conversationId.value
    && collaborationStore.activeMeeting.status === 'STARTED'
    ? collaborationStore.activeMeeting
    : null
));

function memberName(userId: string): string {
  return members.value.find((member) => member.userId === userId)?.displayName || `用户-${userId.slice(0, 8)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function messageBody(message: MessageView): string {
  if (message.status === 'RECALLED') return '该消息已撤回';
  if (message.messageType === 'TEXT') return message.text || '';
  if (!message.attachment) return `[${message.messageType}]`;
  if (message.messageType === 'IMAGE') return `图片：${message.attachment.fileName}`;
  if (message.messageType === 'VOICE') return `语音：${message.attachment.fileName}`;
  return `文件：${message.attachment.fileName}`;
}

function toggleMention(member: ConversationMemberView) {
  if (member.userId === currentUserId.value) return;
  mentionedUserIds.value = mentionedUserIds.value.includes(member.userId)
    ? mentionedUserIds.value.filter((id) => id !== member.userId)
    : [...mentionedUserIds.value, member.userId];
}

async function scrollToBottom() {
  await nextTick();
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight;
}

async function loadConversation(forceMessages = true) {
  if (!conversationId.value) return;
  collaborationStore.activeConversationId = conversationId.value;
  await Promise.all([
    collaborationStore.loadConversations(),
    collaborationStore.loadMembers(conversationId.value),
    collaborationStore.loadMessages(conversationId.value, forceMessages),
  ]);
  await collaborationStore.markRead(conversationId.value);
  collaborationStore.connectRealtime(conversationId.value);
  await scrollToBottom();
}

async function sendText() {
  const sent = await collaborationStore.sendText(conversationId.value, draft.value, mentionedUserIds.value);
  if (!sent) {
    showToast(collaborationStore.errorMessage || '消息发送失败');
    return;
  }
  draft.value = '';
  mentionedUserIds.value = [];
  await scrollToBottom();
}

async function recall(message: MessageView) {
  const recalled = await collaborationStore.recallMessage(message);
  showToast(recalled ? '已撤回' : (collaborationStore.errorMessage || '撤回失败'));
}

function chooseFile() {
  fileInput.value?.click();
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const sent = await collaborationStore.sendAttachment(conversationId.value, file, mentionedUserIds.value);
  if (!sent) {
    showToast(collaborationStore.errorMessage || '附件消息发送失败');
    return;
  }
  mentionedUserIds.value = [];
  await scrollToBottom();
}

async function startMeeting() {
  const meeting = await collaborationStore.startMeeting(
    conversationId.value,
    `${conversation.value?.title || '内部群聊'}语音会议`,
  );
  if (!meeting) {
    showToast(collaborationStore.errorMessage || '会议创建失败');
    return;
  }
  await router.push(`/meetings/${meeting.id}`);
}

async function joinMeeting(meetingId: string) {
  await router.push(`/meetings/${meetingId}`);
}

onMounted(() => {
  void loadConversation(true);
});

watch(conversationId, () => {
  void loadConversation(true);
});

watch(messages, () => {
  void scrollToBottom();
});

onUnmounted(() => {
  collaborationStore.disconnectRealtime();
});
</script>

<template>
  <div class="workbench-page conversation-page">
    <van-nav-bar
      :title="conversation?.title || '会话'"
      left-text="返回"
      left-arrow
      fixed
      placeholder
      @click-left="router.push('/chat')"
    />

    <div class="conversation-shell">
      <section v-if="activeMeeting" class="surface-card meeting-banner">
        <div>
          <strong>会议进行中</strong>
          <p>{{ activeMeeting.title }} · 最多 {{ activeMeeting.maxParticipants }} 人</p>
        </div>
        <van-button size="small" type="primary" @click="joinMeeting(activeMeeting.id)">加入</van-button>
      </section>

      <section class="surface-card member-strip">
        <button
          v-for="member in members"
          :key="member.userId"
          type="button"
          :class="['member-chip', { 'member-chip--active': mentionedUserIds.includes(member.userId) }]"
          @click="toggleMention(member)"
        >
          @{{ member.displayName }}
        </button>
      </section>

      <section ref="messageList" class="message-list">
        <van-empty
          v-if="!collaborationStore.messagesLoading && messages.length === 0"
          image="search"
          description="暂无消息"
        />
        <van-skeleton v-else-if="collaborationStore.messagesLoading" title :row="5" />
        <div
          v-for="message in messages"
          :key="message.id"
          :class="['message-row', { 'message-row--mine': message.senderUserId === currentUserId }]"
        >
          <div class="message-card">
            <div class="message-meta">
              <span>{{ memberName(message.senderUserId) }}</span>
              <span>{{ formatTime(message.createdAt) }}</span>
            </div>
            <p :class="{ 'message-card__recalled': message.status === 'RECALLED' }">
              {{ messageBody(message) }}
            </p>
            <div v-if="message.mentionedUserIds.length" class="message-mentions">
              <van-tag
                v-for="userId in message.mentionedUserIds"
                :key="userId"
                plain
                type="primary"
              >
                @{{ memberName(userId) }}
              </van-tag>
            </div>
            <button
              v-if="message.status !== 'RECALLED'"
              type="button"
              class="message-recall"
              @click="recall(message)"
            >
              撤回
            </button>
          </div>
        </div>
      </section>

      <footer class="message-composer">
        <input
          ref="fileInput"
          class="hidden-file"
          type="file"
          accept="image/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
          @change="handleFileChange"
        >
        <van-button size="small" plain type="primary" @click="chooseFile">附件</van-button>
        <van-field
          v-model="draft"
          class="message-input"
          type="textarea"
          rows="1"
          autosize
          placeholder="输入消息"
          @keyup.enter.exact.prevent="sendText"
        />
        <van-button
          size="small"
          type="primary"
          :loading="collaborationStore.sending"
          @click="sendText"
        >
          发送
        </van-button>
      </footer>

      <van-button
        class="meeting-button"
        block
        round
        type="primary"
        :loading="collaborationStore.meetingLoading"
        @click="startMeeting"
      >
        发起 100 人语音会议
      </van-button>
    </div>
  </div>
</template>

<style scoped>
.conversation-shell {
  display: flex;
  flex-direction: column;
  min-height: calc(100vh - 96px);
  padding: 10px 12px 68px;
}

.meeting-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  margin-bottom: 10px;
}

.meeting-banner p {
  color: var(--workbench-muted);
  font-size: 12px;
}

.member-strip {
  display: flex;
  gap: 8px;
  padding: 10px;
  margin-bottom: 10px;
  overflow-x: auto;
}

.member-chip {
  flex: 0 0 auto;
  padding: 5px 10px;
  border: 1px solid var(--workbench-line);
  border-radius: 999px;
  color: var(--workbench-muted);
  background: #fff;
}

.member-chip--active {
  color: var(--workbench-primary);
  border-color: var(--workbench-primary);
  background: #edf4ff;
}

.message-list {
  display: grid;
  align-content: start;
  flex: 1;
  gap: 10px;
  max-height: calc(100vh - 260px);
  overflow-y: auto;
}

.message-row {
  display: flex;
  justify-content: flex-start;
}

.message-row--mine {
  justify-content: flex-end;
}

.message-card {
  max-width: 78%;
  padding: 10px 12px;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 6px 16px rgba(28, 45, 80, 0.06);
}

.message-row--mine .message-card {
  color: #fff;
  background: var(--workbench-primary);
}

.message-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 4px;
  color: var(--workbench-muted);
  font-size: 11px;
}

.message-row--mine .message-meta {
  color: rgba(255, 255, 255, 0.76);
}

.message-card p {
  white-space: pre-wrap;
  word-break: break-word;
}

.message-card__recalled {
  color: var(--workbench-muted);
  font-style: italic;
}

.message-mentions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.message-recall {
  margin-top: 6px;
  border: 0;
  color: inherit;
  opacity: 0.7;
  background: transparent;
  font-size: 12px;
}

.message-composer {
  position: fixed;
  right: 0;
  bottom: 50px;
  left: 0;
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
  max-width: 540px;
  padding: 8px 12px;
  margin: 0 auto;
  background: #fff;
  border-top: 1px solid var(--workbench-line);
}

.message-input {
  flex: 1;
  padding: 0;
  border: 1px solid var(--workbench-line);
  border-radius: 12px;
  overflow: hidden;
}

.hidden-file {
  display: none;
}

.meeting-button {
  margin-top: 14px;
}

@media (min-width: 541px) {
  .message-composer {
    left: 50%;
    transform: translateX(-50%);
  }
}
</style>
