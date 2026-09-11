import { apiClient } from './client';

export interface DirectoryUserView {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
  status: string;
}

export interface DirectoryView {
  users: DirectoryUserView[];
}

export interface MessagePreviewView {
  messageId: string;
  senderUserId: string;
  messageType: string;
  previewText: string;
  serverSeq: number;
  status: string;
  createdAt: string;
}

export interface ConversationSummaryView {
  id: string;
  type: 'DIRECT' | 'GROUP';
  title: string;
  ownerUserId: string;
  memberCount: number;
  unreadCount: number;
  lastMessage: MessagePreviewView | null;
  updatedAt: string;
}

export interface ConversationListView {
  items: ConversationSummaryView[];
}

export interface ConversationMemberView {
  conversationId: string;
  userId: string;
  displayName: string;
  role: string;
  status: string;
  lastReadSeq: number;
  joinedAt: string;
}

export interface ConversationMembersView {
  items: ConversationMemberView[];
}

export interface AttachmentView {
  id: string;
  objectKey: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AttachmentInitView {
  attachmentId: string;
  objectKey: string;
  uploadUrl: string | null;
}

export interface MessageView {
  id: string;
  conversationId: string;
  senderUserId: string;
  clientMessageId: string;
  messageType: 'TEXT' | 'IMAGE' | 'FILE' | 'VOICE';
  text: string | null;
  attachment: AttachmentView | null;
  mentionedUserIds: string[];
  serverSeq: number;
  status: string;
  recalledAt: string | null;
  createdAt: string;
}

export interface MessagePageView {
  items: MessageView[];
  hasMore: boolean;
}

export interface MeetingView {
  id: string;
  conversationId: string;
  liveKitRoom: string;
  title: string;
  status: string;
  startedBy: string;
  startedAt: string;
  endedAt: string | null;
  maxParticipants: number;
  screenShareLimit: number;
}

export interface MeetingJoinTokenView {
  meetingId: string;
  liveKitUrl: string;
  roomName: string;
  participantIdentity: string;
  token: string;
  expiresAt: string;
}

export const collaborationApi = {
  directory(query = '', limit = 50) {
    return apiClient.get<DirectoryView>('/collaboration/directory', {
      q: query,
      limit: String(limit),
    });
  },

  createConversation(type: 'DIRECT' | 'GROUP', title: string | null, memberIds: string[]) {
    return apiClient.post<ConversationSummaryView>('/conversations', { type, title, memberIds });
  },

  conversations() {
    return apiClient.get<ConversationListView>('/conversations');
  },

  members(conversationId: string) {
    return apiClient.get<ConversationMembersView>(`/conversations/${conversationId}/members`);
  },

  addMembers(conversationId: string, userIds: string[], role = 'MEMBER') {
    return apiClient.post<ConversationMembersView>(`/conversations/${conversationId}/members`, {
      userIds,
      role,
    });
  },

  messages(conversationId: string, afterSeq = 0, limit = 30) {
    return apiClient.get<MessagePageView>(`/conversations/${conversationId}/messages`, {
      afterSeq: String(afterSeq),
      limit: String(limit),
    });
  },

  sendText(conversationId: string, clientMessageId: string, text: string, mentionedUserIds: string[]) {
    return apiClient.post<MessageView>(`/conversations/${conversationId}/messages`, {
      clientMessageId,
      messageType: 'TEXT',
      text,
      mentionedUserIds,
    });
  },

  sendAttachment(
    conversationId: string,
    clientMessageId: string,
    messageType: 'IMAGE' | 'FILE' | 'VOICE',
    attachmentId: string,
    mentionedUserIds: string[] = [],
  ) {
    return apiClient.post<MessageView>(`/conversations/${conversationId}/messages`, {
      clientMessageId,
      messageType,
      attachmentId,
      mentionedUserIds,
    });
  },

  recallMessage(messageId: string) {
    return apiClient.post<MessageView>(`/messages/${messageId}/recall`, {});
  },

  updateReadCursor(conversationId: string, serverSeq: number) {
    return apiClient.post<void>(`/conversations/${conversationId}/read-cursor`, { serverSeq });
  },

  initAttachment(fileName: string, contentType: string, sizeBytes: number) {
    return apiClient.post<AttachmentInitView>('/attachments/init', { fileName, contentType, sizeBytes });
  },

  async uploadAttachmentBinary(uploadUrl: string, file: File) {
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: file.type ? { 'Content-Type': file.type } : undefined,
      body: file,
    });
    if (!response.ok) {
      throw new Error(`附件上传失败: HTTP ${response.status}`);
    }
  },

  completeAttachment(
    attachmentId: string,
    objectKey: string,
    fileName: string,
    contentType: string,
    sizeBytes: number,
  ) {
    return apiClient.post<AttachmentView>('/attachments/complete', {
      attachmentId,
      objectKey,
      fileName,
      contentType,
      sizeBytes,
    });
  },

  createMeeting(conversationId: string, title: string) {
    return apiClient.post<MeetingView>('/meetings', { conversationId, title });
  },

  joinMeeting(meetingId: string, deviceId?: string) {
    return apiClient.post<MeetingJoinTokenView>(`/meetings/${meetingId}/join-token`, { deviceId });
  },

  registerDevice(deviceId: string, platform: string, pushProvider: string, pushToken: string) {
    return apiClient.post('/devices', { deviceId, platform, pushProvider, pushToken });
  },
};
