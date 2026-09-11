import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { buildWebSocketUrl, normalizeError } from '@/api/core';
import {
  collaborationApi,
  type ConversationMemberView,
  type ConversationSummaryView,
  type DirectoryUserView,
  type MeetingJoinTokenView,
  type MeetingView,
  type MessageView,
} from '@/api/core/collaboration';
import { mobileCapabilities } from '@/adapters/mobile';
import { createIdempotencyKey } from '@/utils/id';

interface CollaborationRealtimeEvent {
  eventId?: string;
  tenantId?: string;
  type: string;
  conversationId?: string;
  serverSeq?: number | null;
  occurredAt?: string;
  payload?: unknown;
}

function isMessageView(value: unknown): value is MessageView {
  return Boolean(
    value
      && typeof value === 'object'
      && 'id' in value
      && 'conversationId' in value
      && 'serverSeq' in value,
  );
}

function isMeetingView(value: unknown): value is MeetingView {
  return Boolean(
    value
      && typeof value === 'object'
      && 'id' in value
      && 'conversationId' in value
      && 'liveKitRoom' in value,
  );
}

function messageKind(file: File): 'IMAGE' | 'VOICE' | 'FILE' {
  if (file.type.startsWith('image/')) return 'IMAGE';
  if (file.type.startsWith('audio/')) return 'VOICE';
  return 'FILE';
}

function mergeMessages(existing: MessageView[], incoming: MessageView[]): MessageView[] {
  const byId = new Map<string, MessageView>();
  for (const message of existing) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  return Array.from(byId.values()).sort((a, b) => a.serverSeq - b.serverSeq);
}

export const useCollaborationStore = defineStore('collaboration', () => {
  const directoryUsers = ref<DirectoryUserView[]>([]);
  const conversations = ref<ConversationSummaryView[]>([]);
  const messagesByConversation = ref<Record<string, MessageView[]>>({});
  const membersByConversation = ref<Record<string, ConversationMemberView[]>>({});
  const activeConversationId = ref<string | null>(null);
  const activeMeeting = ref<MeetingView | null>(null);
  const lastJoinToken = ref<MeetingJoinTokenView | null>(null);
  const directoryLoading = ref(false);
  const conversationsLoading = ref(false);
  const messagesLoading = ref(false);
  const membersLoading = ref(false);
  const sending = ref(false);
  const meetingLoading = ref(false);
  const pushRegistering = ref(false);
  const realtimeStatus = ref<'idle' | 'connecting' | 'connected' | 'closed' | 'failed'>('idle');
  const errorMessage = ref<string | null>(null);

  let socket: WebSocket | null = null;
  let socketConversationId: string | null = null;
  let reconnectTimer: number | null = null;
  let manualSocketClose = false;

  const currentConversation = computed(() => {
    if (!activeConversationId.value) return null;
    return conversations.value.find((item) => item.id === activeConversationId.value) ?? null;
  });

  const currentMessages = computed(() => {
    if (!activeConversationId.value) return [];
    return messagesByConversation.value[activeConversationId.value] ?? [];
  });

  const currentMembers = computed(() => {
    if (!activeConversationId.value) return [];
    return membersByConversation.value[activeConversationId.value] ?? [];
  });

  async function loadDirectory(query = '') {
    directoryLoading.value = true;
    errorMessage.value = null;
    try {
      directoryUsers.value = (await collaborationApi.directory(query, 50)).data.users;
      return directoryUsers.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return [];
    } finally {
      directoryLoading.value = false;
    }
  }

  async function loadConversations() {
    conversationsLoading.value = true;
    errorMessage.value = null;
    try {
      conversations.value = (await collaborationApi.conversations()).data.items;
      return conversations.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return [];
    } finally {
      conversationsLoading.value = false;
    }
  }

  async function createDirect(userId: string) {
    errorMessage.value = null;
    try {
      const conversation = (await collaborationApi.createConversation('DIRECT', null, [userId])).data;
      conversations.value = [
        conversation,
        ...conversations.value.filter((item) => item.id !== conversation.id),
      ];
      return conversation;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    }
  }

  async function createGroup(title: string, memberIds: string[]) {
    errorMessage.value = null;
    try {
      const conversation = (await collaborationApi.createConversation('GROUP', title, memberIds)).data;
      conversations.value = [
        conversation,
        ...conversations.value.filter((item) => item.id !== conversation.id),
      ];
      return conversation;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    }
  }

  async function loadMembers(conversationId: string) {
    membersLoading.value = true;
    errorMessage.value = null;
    try {
      const members = (await collaborationApi.members(conversationId)).data.items;
      membersByConversation.value = { ...membersByConversation.value, [conversationId]: members };
      return members;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return [];
    } finally {
      membersLoading.value = false;
    }
  }

  async function addMembers(conversationId: string, userIds: string[]) {
    errorMessage.value = null;
    try {
      const members = (await collaborationApi.addMembers(conversationId, userIds)).data.items;
      membersByConversation.value = { ...membersByConversation.value, [conversationId]: members };
      await loadConversations();
      return members;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return [];
    }
  }

  async function loadMessages(conversationId: string, force = false) {
    messagesLoading.value = true;
    errorMessage.value = null;
    try {
      const existing = force ? [] : messagesByConversation.value[conversationId] ?? [];
      const afterSeq = existing.length ? Math.max(...existing.map((message) => message.serverSeq)) : 0;
      const loaded = (await collaborationApi.messages(conversationId, afterSeq, 100)).data.items;
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [conversationId]: mergeMessages(existing, loaded),
      };
      return messagesByConversation.value[conversationId] ?? [];
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return messagesByConversation.value[conversationId] ?? [];
    } finally {
      messagesLoading.value = false;
    }
  }

  async function sendText(conversationId: string, text: string, mentionedUserIds: string[] = []) {
    const trimmed = text.trim();
    if (!trimmed) return null;
    sending.value = true;
    errorMessage.value = null;
    try {
      const message = (await collaborationApi.sendText(
        conversationId,
        createIdempotencyKey('msg'),
        trimmed,
        mentionedUserIds,
      )).data;
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [conversationId]: mergeMessages(messagesByConversation.value[conversationId] ?? [], [message]),
      };
      await markRead(conversationId);
      await loadConversations();
      return message;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      sending.value = false;
    }
  }

  async function sendAttachment(conversationId: string, file: File, mentionedUserIds: string[] = []) {
    sending.value = true;
    errorMessage.value = null;
    try {
      const init = (await collaborationApi.initAttachment(
        file.name || 'attachment',
        file.type || 'application/octet-stream',
        file.size,
      )).data;
      if (init.uploadUrl) await collaborationApi.uploadAttachmentBinary(init.uploadUrl, file);
      const attachment = (await collaborationApi.completeAttachment(
        init.attachmentId,
        init.objectKey,
        file.name || 'attachment',
        file.type || 'application/octet-stream',
        file.size,
      )).data;
      const message = (await collaborationApi.sendAttachment(
        conversationId,
        createIdempotencyKey('msg'),
        messageKind(file),
        attachment.id,
        mentionedUserIds,
      )).data;
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [conversationId]: mergeMessages(messagesByConversation.value[conversationId] ?? [], [message]),
      };
      await markRead(conversationId);
      await loadConversations();
      return message;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      sending.value = false;
    }
  }

  async function recallMessage(message: MessageView) {
    errorMessage.value = null;
    try {
      const recalled = (await collaborationApi.recallMessage(message.id)).data;
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [message.conversationId]: mergeMessages(
          messagesByConversation.value[message.conversationId] ?? [],
          [recalled],
        ),
      };
      await loadConversations();
      return recalled;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    }
  }

  async function markRead(conversationId: string) {
    const messages = messagesByConversation.value[conversationId] ?? [];
    if (!messages.length) return;
    const maxSeq = Math.max(...messages.map((message) => message.serverSeq));
    try {
      await collaborationApi.updateReadCursor(conversationId, maxSeq);
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
    }
  }

  async function startMeeting(conversationId: string, title = '语音会议') {
    meetingLoading.value = true;
    errorMessage.value = null;
    try {
      activeMeeting.value = (await collaborationApi.createMeeting(conversationId, title)).data;
      await loadConversations();
      return activeMeeting.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      meetingLoading.value = false;
    }
  }

  async function joinMeeting(meetingId: string) {
    meetingLoading.value = true;
    errorMessage.value = null;
    try {
      const deviceId = await mobileCapabilities.getDeviceId();
      lastJoinToken.value = (await collaborationApi.joinMeeting(meetingId, deviceId)).data;
      return lastJoinToken.value;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      meetingLoading.value = false;
    }
  }

  async function registerPushDevice() {
    pushRegistering.value = true;
    errorMessage.value = null;
    try {
      const deviceId = await mobileCapabilities.getDeviceId();
      const token = await mobileCapabilities.requestPushToken();
      if (!token.token) return null;
      return (await collaborationApi.registerDevice(
        deviceId,
        mobileCapabilities.getPlatform().toUpperCase(),
        token.provider,
        token.token,
      )).data;
    } catch (error) {
      errorMessage.value = normalizeError(error).message;
      return null;
    } finally {
      pushRegistering.value = false;
    }
  }

  function handleRealtimeEvent(raw: MessageEvent<string>) {
    let event: CollaborationRealtimeEvent;
    try {
      event = JSON.parse(raw.data) as CollaborationRealtimeEvent;
    } catch {
      return;
    }
    if (!event.conversationId) return;
    if (event.type === 'message.created' && isMessageView(event.payload)) {
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [event.conversationId]: mergeMessages(
          messagesByConversation.value[event.conversationId] ?? [],
          [event.payload],
        ),
      };
      if (activeConversationId.value === event.conversationId) void markRead(event.conversationId);
      void loadConversations();
      return;
    }
    if (event.type === 'message.recalled' && isMessageView(event.payload)) {
      messagesByConversation.value = {
        ...messagesByConversation.value,
        [event.conversationId]: mergeMessages(
          messagesByConversation.value[event.conversationId] ?? [],
          [event.payload],
        ),
      };
      void loadConversations();
      return;
    }
    if (event.type === 'meeting.started' && isMeetingView(event.payload)) {
      activeMeeting.value = event.payload;
      void loadConversations();
      return;
    }
    if (event.type === 'member.changed' || event.type === 'read.updated' || event.type === 'conversation.updated') {
      void loadConversations();
      if (activeConversationId.value === event.conversationId) void loadMembers(event.conversationId);
    }
  }

  function scheduleReconnect() {
    if (manualSocketClose || !socketConversationId || reconnectTimer !== null) return;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      if (socketConversationId) connectRealtime(socketConversationId, true);
    }, 2_000);
  }

  function connectRealtime(conversationId: string, force = false) {
    activeConversationId.value = conversationId;
    if (!force && socket && socket.readyState === WebSocket.OPEN && socketConversationId === conversationId) return;
    disconnectRealtime();
    manualSocketClose = false;
    socketConversationId = conversationId;
    realtimeStatus.value = 'connecting';
    const url = new URL(buildWebSocketUrl('/ws/v1/collaboration'));
    const tenantId = localStorage.getItem('auth_tenant_id');
    if (tenantId) url.searchParams.set('tenantId', tenantId);
    socket = new WebSocket(url.toString());
    socket.addEventListener('open', () => {
      realtimeStatus.value = 'connected';
      socket?.send(JSON.stringify({ type: 'subscribe', conversationId }));
    });
    socket.addEventListener('message', handleRealtimeEvent);
    socket.addEventListener('close', () => {
      realtimeStatus.value = 'closed';
      scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      realtimeStatus.value = 'failed';
      scheduleReconnect();
    });
  }

  function disconnectRealtime() {
    manualSocketClose = true;
    if (reconnectTimer !== null) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    if (socket) {
      socket.close();
      socket = null;
    }
    socketConversationId = null;
    realtimeStatus.value = 'idle';
  }

  return {
    directoryUsers,
    conversations,
    messagesByConversation,
    membersByConversation,
    activeConversationId,
    activeMeeting,
    lastJoinToken,
    directoryLoading,
    conversationsLoading,
    messagesLoading,
    membersLoading,
    sending,
    meetingLoading,
    pushRegistering,
    realtimeStatus,
    errorMessage,
    currentConversation,
    currentMessages,
    currentMembers,
    loadDirectory,
    loadConversations,
    createDirect,
    createGroup,
    loadMembers,
    addMembers,
    loadMessages,
    sendText,
    sendAttachment,
    recallMessage,
    markRead,
    startMeeting,
    joinMeeting,
    registerPushDevice,
    connectRealtime,
    disconnectRealtime,
  };
});
