<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { showToast } from 'vant';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteTrack,
} from 'livekit-client';
import { useCollaborationStore } from '@/stores/collaboration';

const route = useRoute();
const router = useRouter();
const collaborationStore = useCollaborationStore();
const room = ref<Room | null>(null);
const connectionState = ref<ConnectionState | 'idle' | 'connecting' | 'failed'>('idle');
const participantCount = ref(0);
const muted = ref(false);
const screenSharing = ref(false);
const audioContainer = ref<HTMLElement | null>(null);
const screenContainer = ref<HTMLElement | null>(null);
const mediaElements: HTMLMediaElement[] = [];

const meetingId = computed(() => String(route.params.meetingId || ''));
const joinToken = computed(() => collaborationStore.lastJoinToken);
const canOperate = computed(() => room.value && connectionState.value === ConnectionState.Connected);

function updateParticipantCount() {
  participantCount.value = room.value ? room.value.remoteParticipants.size + 1 : 0;
}

function clearMediaElements() {
  while (mediaElements.length) {
    const element = mediaElements.pop();
    element?.remove();
  }
}

function attachTrack(track: RemoteTrack) {
  const element = track.attach();
  element.autoplay = true;
  if (element instanceof HTMLVideoElement) element.playsInline = true;
  if (track.kind === Track.Kind.Audio) {
    audioContainer.value?.appendChild(element);
  } else {
    screenContainer.value?.appendChild(element);
  }
  mediaElements.push(element);
}

function setupRoomEvents(nextRoom: Room) {
  nextRoom.on(RoomEvent.Connected, () => {
    connectionState.value = ConnectionState.Connected;
    updateParticipantCount();
  });
  nextRoom.on(RoomEvent.Reconnecting, () => {
    connectionState.value = ConnectionState.Reconnecting;
  });
  nextRoom.on(RoomEvent.Reconnected, () => {
    connectionState.value = ConnectionState.Connected;
    updateParticipantCount();
  });
  nextRoom.on(RoomEvent.Disconnected, () => {
    connectionState.value = ConnectionState.Disconnected;
    participantCount.value = 0;
    clearMediaElements();
  });
  nextRoom.on(RoomEvent.ParticipantConnected, updateParticipantCount);
  nextRoom.on(RoomEvent.ParticipantDisconnected, updateParticipantCount);
  nextRoom.on(RoomEvent.TrackSubscribed, (track) => attachTrack(track));
}

async function connectMeeting() {
  if (!meetingId.value || connectionState.value === 'connecting') return;
  connectionState.value = 'connecting';
  const token = await collaborationStore.joinMeeting(meetingId.value);
  if (!token) {
    connectionState.value = 'failed';
    showToast(collaborationStore.errorMessage || '会议入会失败');
    return;
  }

  const nextRoom = new Room({
    adaptiveStream: true,
    dynacast: true,
  });
  setupRoomEvents(nextRoom);
  room.value = nextRoom;
  try {
    await nextRoom.connect(token.liveKitUrl, token.token, { autoSubscribe: true });
    await nextRoom.localParticipant.setMicrophoneEnabled(true);
    muted.value = false;
    updateParticipantCount();
  } catch (error) {
    connectionState.value = 'failed';
    nextRoom.disconnect();
    room.value = null;
    showToast(error instanceof Error ? error.message : '会议连接失败');
  }
}

async function toggleMicrophone() {
  if (!room.value) return;
  const enable = muted.value;
  try {
    await room.value.localParticipant.setMicrophoneEnabled(enable);
    muted.value = !enable;
  } catch (error) {
    showToast(error instanceof Error ? error.message : '麦克风操作失败');
  }
}

async function toggleScreenShare() {
  if (!room.value) return;
  const enable = !screenSharing.value;
  try {
    await room.value.localParticipant.setScreenShareEnabled(enable);
    screenSharing.value = enable;
  } catch (error) {
    showToast(error instanceof Error ? error.message : '屏幕共享失败');
  }
}

function disconnectMeeting() {
  if (room.value) {
    room.value.disconnect();
    room.value = null;
  }
  connectionState.value = 'idle';
  participantCount.value = 0;
  screenSharing.value = false;
  clearMediaElements();
}

onMounted(() => {
  void connectMeeting();
});

onUnmounted(() => {
  disconnectMeeting();
});
</script>

<template>
  <div class="workbench-page meeting-page">
    <van-nav-bar
      title="语音会议"
      left-text="返回"
      left-arrow
      fixed
      placeholder
      @click-left="router.back()"
    />

    <div class="workbench-body meeting-body">
      <section class="surface-card meeting-card">
        <p class="meeting-eyebrow">LiveKit 自托管会议</p>
        <h1>{{ joinToken?.roomName || '正在准备会议' }}</h1>
        <div class="meeting-stats">
          <span>状态：{{ connectionState }}</span>
          <span>参会：{{ participantCount }} 人</span>
          <span>麦克风：{{ muted ? '已静音' : '开启' }}</span>
        </div>
      </section>

      <section class="surface-card screen-stage">
        <div ref="screenContainer" class="screen-media" />
        <van-empty
          v-if="!screenSharing"
          image="network"
          description="暂无屏幕共享；第一版限制同时 1 路共享"
        />
      </section>

      <div ref="audioContainer" class="audio-container" />

      <section class="meeting-actions">
        <van-button
          round
          type="primary"
          :disabled="!canOperate"
          @click="toggleMicrophone"
        >
          {{ muted ? '打开麦克风' : '静音' }}
        </van-button>
        <van-button
          round
          plain
          type="primary"
          :disabled="!canOperate"
          @click="toggleScreenShare"
        >
          {{ screenSharing ? '停止共享' : '共享屏幕' }}
        </van-button>
        <van-button
          round
          plain
          type="danger"
          @click="disconnectMeeting"
        >
          退出会议
        </van-button>
      </section>

      <section class="surface-card meeting-debug">
        <h2>入会参数</h2>
        <p>URL：{{ joinToken?.liveKitUrl || '-' }}</p>
        <p>身份：{{ joinToken?.participantIdentity || '-' }}</p>
        <p>Token 到期：{{ joinToken?.expiresAt || '-' }}</p>
      </section>
    </div>
  </div>
</template>

<style scoped>
.meeting-body {
  display: grid;
  gap: 12px;
}

.meeting-card {
  padding: 16px;
}

.meeting-eyebrow {
  color: var(--workbench-muted);
  font-size: 12px;
}

.meeting-card h1 {
  margin-top: 4px;
  color: var(--workbench-ink);
  font-size: 18px;
  word-break: break-all;
}

.meeting-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 12px;
}

.meeting-stats span {
  padding: 4px 8px;
  border-radius: 999px;
  color: var(--workbench-primary);
  background: #edf4ff;
  font-size: 12px;
}

.screen-stage {
  min-height: 220px;
  padding: 10px;
}

.screen-media {
  display: grid;
  gap: 8px;
}

.screen-media :deep(video) {
  width: 100%;
  max-height: 360px;
  border-radius: 12px;
  background: #111827;
}

.audio-container {
  width: 0;
  height: 0;
  overflow: hidden;
}

.meeting-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.meeting-debug {
  padding: 12px;
}

.meeting-debug h2 {
  margin-bottom: 8px;
  color: var(--workbench-ink);
  font-size: 15px;
}

.meeting-debug p {
  color: var(--workbench-muted);
  font-size: 12px;
  word-break: break-all;
}
</style>
