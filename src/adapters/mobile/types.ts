export interface PushTokenResult {
  provider: 'APNS' | 'FCM' | 'WEB' | 'UNSUPPORTED';
  token: string | null;
}

export interface NotificationOpenEvent {
  conversationId?: string;
  meetingId?: string;
}

export interface MobileCapabilities {
  getPlatform(): 'ios' | 'android' | 'web';
  getDeviceId(): Promise<string>;
  requestPushToken(): Promise<PushTokenResult>;
  onNotificationOpen(listener: (event: NotificationOpenEvent) => void): Promise<() => void>;
}
