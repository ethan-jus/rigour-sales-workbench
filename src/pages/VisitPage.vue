<script setup lang="ts">
import { ref } from 'vue';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import type { CapabilityStatus } from '@/types';

const audioStatus = ref<CapabilityStatus>('idle');
const isRecording = ref(false);
const mockMode = import.meta.env.VITE_FEISHU_MOCK === 'true';
const lastClip = ref<{ localClipId: string; tempFilePath: string; duration: number; startedAt: number } | null>(null);
const adapter = getFeishuAdapter();

function startRecording() {
  try {
    audioStatus.value = 'loading';
    adapter.startRecording();
    isRecording.value = true;
    audioStatus.value = 'active';
  } catch (error) {
    audioStatus.value = 'failed';
    showToast(error instanceof Error ? error.message : '录音启动失败');
  }
}

async function stopRecording() {
  try {
    const clip = await adapter.stopRecording();
    if (clip) {
      lastClip.value = clip;
      showToast(`录音完成：${Math.round(clip.duration / 1000)}秒`);
    } else {
      showToast('未在录音中');
    }
    isRecording.value = false;
    audioStatus.value = 'ready';
  } catch (error) {
    audioStatus.value = 'failed';
    showToast(error instanceof Error ? error.message : '录音停止失败');
  }
}

audioStatus.value = adapter.getAudioStatus();
</script>

<template>
  <div class="workbench-page visit-page">
    <van-nav-bar title="拜访执行" :fixed="true" :placeholder="true" />
    <div class="workbench-body">
      <div class="visit-steps surface-card">
        <div class="visit-step visit-step--active"><span>1</span><strong>选择门店</strong></div>
        <i /><div class="visit-step"><span>2</span><strong>到店签到</strong></div>
        <i /><div class="visit-step"><span>3</span><strong>采集证据</strong></div>
        <i /><div class="visit-step"><span>4</span><strong>提交结果</strong></div>
      </div>

      <div class="section-heading"><h2>拜访对象</h2><span>CRM主数据</span></div>
      <router-link to="/targets" class="target-card surface-card">
        <span class="target-icon"><van-icon name="shop-o" size="26" /></span>
        <div><strong>选择客户或门店</strong><p>只读取本人有效归属；新门店提交CRM线索</p></div>
        <van-icon name="arrow" color="#94a0b4" />
      </router-link>

      <div class="section-heading"><h2>现场执行</h2><span>服务端状态驱动</span></div>
      <div class="execution-card surface-card">
        <van-cell title="拜访状态" value="尚未创建" />
        <van-cell title="到店签到" value="--:--" />
        <van-cell title="停留时长" value="--" />
        <van-cell title="到店签退" value="--:--" />
        <div class="execution-actions">
          <van-button block type="primary" disabled>到店签到</van-button>
          <van-button block plain disabled>到店签退</van-button>
        </div>
      </div>

      <div class="section-heading"><h2>录音证据</h2><span>{{ audioStatus }}</span></div>
      <div class="recording-card surface-card">
        <div class="recording-state">
          <span class="recording-icon" :class="{ 'recording-icon--active': isRecording }"><van-icon name="audio" size="26" /></span>
          <div>
            <strong>{{ isRecording ? '正在录音' : '尚未开始录音' }}</strong>
            <p v-if="lastClip">最近片段 {{ Math.round(lastClip.duration / 1000) }} 秒</p>
            <p v-else>录音由销售主动开启，完成后上传Sales Work</p>
          </div>
        </div>
        <van-button v-if="!isRecording" block plain type="primary" :disabled="audioStatus === 'unsupported' || !mockMode" @click="startRecording">
          {{ mockMode ? '测试录音能力' : '创建拜访后开始录音' }}
        </van-button>
        <van-button v-else block type="danger" @click="stopRecording">停止录音</van-button>
      </div>

      <van-notice-bar class="visit-notice" left-icon="info-o" text="照片、备注、录音和规则快照由服务端归档；AI只给建议，不直接判定拜访无效。" wrapable />
    </div>
  </div>
</template>

<style scoped>
.visit-steps { display: grid; grid-template-columns: auto 1fr auto 1fr auto 1fr auto; align-items: start; padding: 18px 12px; }
.visit-steps > i { height: 1px; margin: 14px 5px 0; background: var(--workbench-line); }
.visit-step { display: flex; flex-direction: column; align-items: center; gap: 6px; color: var(--workbench-muted); font-size: 10px; white-space: nowrap; }
.visit-step span { display: grid; width: 28px; height: 28px; background: #eef2f7; border-radius: 50%; place-items: center; }
.visit-step--active { color: var(--workbench-primary); }
.visit-step--active span { color: #fff; background: var(--workbench-primary); }
.target-card { display: flex; gap: 12px; align-items: center; padding: 16px; }
.target-icon { display: grid; flex: 0 0 48px; height: 48px; color: var(--workbench-primary); background: #edf4ff; border-radius: 14px; place-items: center; }
.target-card > div { min-width: 0; flex: 1; }
.target-card strong { color: var(--workbench-ink); font-size: 14px; }
.target-card p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 11px; }
.execution-card { padding-bottom: 14px; }
.execution-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding: 12px 14px 0; }
.recording-card { padding: 16px; }
.recording-state { display: flex; gap: 12px; align-items: center; margin-bottom: 16px; }
.recording-icon { display: grid; flex: 0 0 48px; height: 48px; color: var(--workbench-primary); background: #edf4ff; border-radius: 50%; place-items: center; }
.recording-icon--active { color: #fff; background: #e64b4b; box-shadow: 0 0 0 8px rgba(230, 75, 75, 0.1); }
.recording-state strong { color: var(--workbench-ink); }
.recording-state p { margin: 4px 0 0; color: var(--workbench-muted); font-size: 11px; }
.visit-notice { margin-top: 16px; border-radius: 12px; }
</style>
