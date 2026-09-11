import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { Preferences } from '@capacitor/preferences';
import { createIdempotencyKey } from '@/utils/id';
import type { MobileCapabilities, NotificationOpenEvent, PushTokenResult } from './types';

const DEVICE_ID_KEY = 'rigour_mobile_device_id';

function notificationDataToEvent(data: unknown): NotificationOpenEvent {
  if (!data || typeof data !== 'object') return {};
  const value = data as Record<string, unknown>;
  return {
    conversationId: typeof value.conversationId === 'string' ? value.conversationId : undefined,
    meetingId: typeof value.meetingId === 'string' ? value.meetingId : undefined,
  };
}

export const mobileCapabilities: MobileCapabilities = {
  getPlatform() {
    const platform = Capacitor.getPlatform();
    if (platform === 'ios' || platform === 'android') return platform;
    return 'web';
  },

  async getDeviceId() {
    const stored = await Preferences.get({ key: DEVICE_ID_KEY });
    if (stored.value) return stored.value;
    const next = createIdempotencyKey('device');
    await Preferences.set({ key: DEVICE_ID_KEY, value: next });
    return next;
  },

  async requestPushToken(): Promise<PushTokenResult> {
    const platform = Capacitor.getPlatform();
    if (platform !== 'ios' && platform !== 'android') {
      return { provider: 'UNSUPPORTED', token: null };
    }

    const permission = await PushNotifications.requestPermissions();
    if (permission.receive !== 'granted') {
      return { provider: 'UNSUPPORTED', token: null };
    }

    return new Promise<PushTokenResult>((resolve, reject) => {
      let settled = false;
      const finish = (result: PushTokenResult) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      void PushNotifications.addListener('registration', (token) => {
        finish({ provider: platform === 'ios' ? 'APNS' : 'FCM', token: token.value });
      });
      void PushNotifications.addListener('registrationError', (error) => {
        if (settled) return;
        settled = true;
        reject(new Error(typeof error.error === 'string' ? error.error : '推送注册失败'));
      });

      void PushNotifications.register();
      window.setTimeout(() => finish({ provider: 'UNSUPPORTED', token: null }), 15_000);
    });
  },

  async onNotificationOpen(listener) {
    const handle = await PushNotifications.addListener('pushNotificationActionPerformed', (event) => {
      listener(notificationDataToEvent(event.notification.data));
    });
    return () => {
      void handle.remove();
    };
  },
};
