<script setup lang="ts">
import { ref } from 'vue';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import type { CapabilityStatus } from '@/types';

const audioStatus = ref<CapabilityStatus>('idle');
const isRecording = ref(false);
const lastClip = ref<{
  localClipId: string;
  tempFilePath: string;
  duration: number;
  startedAt: number;
} | null>(null);
const adapter = getFeishuAdapter();

function startRecording() {
  try {
    audioStatus.value = 'loading';
    adapter.startRecording();  // 同步调用，录音管理器内部注册 onStart/onStop/onError
    isRecording.value = true;
    audioStatus.value = 'active';
  } catch (err) {
    audioStatus.value = 'failed';
    const msg = err instanceof Error ? err.message : '录音启动失败';
    showToast(msg);
  }
}

async function stopRecording() {
  try {
    const clip = await adapter.stopRecording();
    if (clip) {
      lastClip.value = clip;
      showToast(`录音完成: ${Math.round(clip.duration / 1000)}秒`);
    } else {
      showToast('未在录音中');
    }
    isRecording.value = false;
    audioStatus.value = 'ready';
  } catch (err) {
    audioStatus.value = 'failed';
    const msg = err instanceof Error ? err.message : '录音停止失败';
    showToast(msg);
  }
}

// 检查能力
audioStatus.value = adapter.getAudioStatus();
</script>

<template>
  <div class="visit-page">
    <van-nav-bar title="拜访" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <van-cell-group inset>
        <van-cell title="录音能力" :value="audioStatus" />
        <van-cell
          v-if="lastClip"
          title="最近录音"
          :label="`${Math.round(lastClip.duration / 1000)}秒 · ${new Date(lastClip.startedAt).toLocaleTimeString()}`"
        />
      </van-cell-group>

      <div class="record-controls">
        <van-button
          v-if="!isRecording"
          type="primary"
          size="large"
          icon="microphone-o"
          :disabled="audioStatus === 'unsupported'"
          @click="startRecording"
        >
          开始录音
        </van-button>
        <van-button
          v-else
          type="danger"
          size="large"
          icon="close"
          @click="stopRecording"
        >
          停止录音
        </van-button>
      </div>

      <van-cell-group inset title="拜访信息">
        <van-cell title="客户" value="待选择" is-link />
        <van-cell title="拜访类型" value="常规拜访" />
        <van-cell title="签到时间" value="--:--" />
        <van-cell title="签退时间" value="--:--" />
      </van-cell-group>
    </div>
  </div>
</template>

<style scoped>
.visit-page {
  min-height: 100vh;
}

.page-body {
  padding: 12px 0;
}

.record-controls {
  padding: 16px;
}
</style>
