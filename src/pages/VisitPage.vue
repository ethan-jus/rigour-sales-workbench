<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute } from 'vue-router';
import { showToast } from 'vant';
import { getFeishuAdapter } from '@/adapters';
import type { RecorderStopResult } from '@/adapters/feishu/types';
import { buildUploadRequest } from '@/api/core/client';
import { useSalesStore } from '@/stores/sales';
import type { CapabilityStatus } from '@/types';
import { formatTime } from '@/utils/datetime';
import { createIdempotencyKey } from '@/utils/id';

type PrimaryAction = 'STOP_RECORDING' | 'EDIT_RESULT' | 'CHECK_OUT' | 'BLOCKED';

const route = useRoute();
const salesStore = useSalesStore();
const adapter = getFeishuAdapter();

const audioStatus = ref<CapabilityStatus>('idle');
const isRecording = ref(false);
const uploadingRecording = ref(false);
const loadingRecordings = ref(false);
const checkingOut = ref(false);
const savingResult = ref(false);
const pendingClips = ref<RecorderStopResult[]>([]);
const recordingUploadError = ref<string | null>(null);
const recordingSessionStartedAt = ref<number | null>(null);
const recordingBaselineUploadedMs = ref(0);
const discardedShortClipCount = ref(0);
const nowMs = ref(Date.now());
let durationTimer: number | null = null;
let uploadQueue: Promise<void> = Promise.resolve();

const kpName = ref('');
const kpPhone = ref('');
const intentionLevel = ref('');
const resultNote = ref('');
const contactOutcome = ref('');

const contactOutcomeOptions = [
  { value: 'CONTACTED', label: '已接触 KP', hint: '正常沟通并填写关键人信息' },
  { value: 'STORE_CLOSED', label: '门店未营业', hint: '关门、暂停营业或已搬迁' },
  { value: 'KP_ABSENT', label: 'KP 不在', hint: '到店但关键人不在现场' },
  { value: 'REFUSED', label: '拒绝接待', hint: '门店或关键人拒绝沟通' },
  { value: 'OTHER_NO_CONTACT', label: '其他未接触', hint: '请在纪要中说明现场情况' },
] as const;

const intentionOptions = [
  { value: 'HIGH', label: '高意向' },
  { value: 'MEDIUM', label: '中意向' },
  { value: 'LOW', label: '低意向' },
  { value: 'NONE', label: '暂无意向' },
] as const;

const visit = computed(() => salesStore.activeVisit);
const isActiveVisit = computed(() => visit.value?.status === 'CHECKED_IN');
const isCompletedVisit = computed(() => visit.value?.status === 'CHECKED_OUT');
const resultSaved = computed(() => Boolean(visit.value?.resultSubmittedAt));
const contactedKp = computed(() => contactOutcome.value === 'CONTACTED');
const resultFormComplete = computed(() => contactedKp.value
  ? Boolean(kpName.value.trim() && kpPhone.value.trim() && intentionLevel.value)
  : Boolean(contactOutcome.value && resultNote.value.trim()));
const resultDirty = computed(() => {
  if (!visit.value) return false;
  return contactOutcome.value !== (visit.value.contactOutcome ?? '')
    || kpName.value.trim() !== (visit.value.kpName ?? '')
    || kpPhone.value.trim() !== (visit.value.kpPhone ?? '')
    || intentionLevel.value !== (visit.value.intentionLevel ?? '')
    || (resultNote.value.trim() || null) !== (visit.value.resultNote ?? null);
});
const uploadedDurationMs = computed(() => salesStore.recordingSession?.uploadedTotalDurationMs ?? 0);
const requiredDurationMs = computed(() => (
  salesStore.recordingSession?.minimumRecordingSeconds ?? 0
) * 1_000);
const minimumClipSeconds = computed(() => salesStore.recordingSession?.minimumClipSeconds ?? 30);
const currentRecordingDurationMs = computed(() => (
  isRecording.value && recordingSessionStartedAt.value
    ? Math.max(0, nowMs.value - recordingSessionStartedAt.value)
    : 0
));
const displayedRecordingDurationMs = computed(() => (
  Math.max(
    uploadedDurationMs.value + pendingClips.value
      .filter((clip) => clip.duration >= minimumClipSeconds.value * 1_000)
      .reduce((total, clip) => total + clip.duration, 0),
    isRecording.value
      ? recordingBaselineUploadedMs.value + currentRecordingDurationMs.value
      : 0,
  )
));
const recordingPolicyInvalid = computed(() => {
  const session = salesStore.recordingSession;
  return Boolean(session?.recordingEnabled && session.minimumRecordingSeconds <= 0);
});
const remainingRecordingSeconds = computed(() => Math.max(
  0,
  Math.ceil((requiredDurationMs.value - displayedRecordingDurationMs.value) / 1_000),
));
const recordingProgress = computed(() => {
  if (recordingPolicyInvalid.value || requiredDurationMs.value <= 0) return 0;
  return Math.min(100, Math.round((displayedRecordingDurationMs.value / requiredDurationMs.value) * 100));
});
const recordingRequirementSatisfied = computed(() => {
  const session = salesStore.recordingSession;
  if (!session) return false;
  if (!session.recordingEnabled) return true;
  return !recordingPolicyInvalid.value && uploadedDurationMs.value >= requiredDurationMs.value;
});
const visitRecordComplete = computed(() => resultSaved.value && !resultDirty.value);
const canRecord = computed(() => isActiveVisit.value
  && salesStore.recordingSession?.recordingEnabled === true
  && !recordingPolicyInvalid.value
  && audioStatus.value !== 'unsupported'
  && !uploadingRecording.value
  && pendingClips.value.length === 0
  && !recordingUploadError.value
  && !loadingRecordings.value);
const canCheckOut = computed(() => isActiveVisit.value
  && visitRecordComplete.value
  && !isRecording.value
  && !checkingOut.value);

const primaryAction = computed<PrimaryAction>(() => {
  if (isRecording.value) return 'STOP_RECORDING';
  if (!resultSaved.value || resultDirty.value) return 'EDIT_RESULT';
  return canCheckOut.value ? 'CHECK_OUT' : 'BLOCKED';
});

const primaryActionLabel = computed(() => {
  switch (primaryAction.value) {
    case 'STOP_RECORDING': return '停止并上传录音';
    case 'EDIT_RESULT': return resultSaved.value ? '保存拜访记录修改' : '填写拜访记录';
    case 'CHECK_OUT': return '完成拜访并离店';
    case 'BLOCKED': return audioStatus.value === 'unsupported' ? '当前客户端不支持录音' : '暂时无法完成拜访';
    default: return '暂时无法完成拜访';
  }
});

const currentTaskHint = computed(() => {
  if (isRecording.value) return `正在录音，停止上传后仍可继续录制；达到考核时长不会自动停止。`;
  if (!resultSaved.value) return '请选择本次接触结果并保存拜访记录；关门或 KP 不在也可如实结束。';
  if (resultDirty.value) return '拜访记录有未保存修改。';
  if (recordingUploadError.value || pendingClips.value.length) {
    return '可以先完成离店；录音仍会留在本页等待上传或重传。';
  }
  if (salesStore.recordingSession?.recordingEnabled && !recordingRequirementSatisfied.value) {
    return '可以完成离店；录音不足只影响有效拜访核验，不会限制销售离开门店。';
  }
  return '拜访记录已保存，可以获取离店位置并完成拜访。';
});

const audioStatusLabel = computed(() => {
  if (isRecording.value) return '录音中';
  if (uploadingRecording.value) return '上传中';
  if (recordingUploadError.value) return '待重传';
  if (salesStore.recordingError) return '需要处理';
  if (recordingPolicyInvalid.value) return '规则异常';
  if (salesStore.recordingSession && !salesStore.recordingSession.recordingEnabled) return '规则未要求';
  if (recordingRequirementSatisfied.value) return '已完成';
  return '待录音';
});

const intentionLabel = computed(() => intentionOptions.find(
  (item) => item.value === intentionLevel.value,
)?.label ?? '未填写');
const contactOutcomeLabel = computed(() => contactOutcomeOptions.find(
  (item) => item.value === contactOutcome.value,
)?.label ?? '未选择');

const recordingDurationLabel = computed(() => formatDurationSeconds(
  Math.floor(currentRecordingDurationMs.value / 1_000),
));

watch(() => visit.value?.id, fillResultForm, { immediate: true });

function fillResultForm() {
  contactOutcome.value = visit.value?.contactOutcome
    ?? (visit.value?.resultSubmittedAt ? 'CONTACTED' : '');
  kpName.value = visit.value?.kpName ?? '';
  kpPhone.value = visit.value?.kpPhone ?? '';
  intentionLevel.value = visit.value?.intentionLevel ?? '';
  resultNote.value = visit.value?.resultNote ?? '';
}

function onContactOutcomeChanged(): void {
  if (contactedKp.value) return;
  kpName.value = '';
  kpPhone.value = '';
  intentionLevel.value = '';
}

function dwellMinutes(): string {
  if (!visit.value?.checkedInAt) return '--';
  const end = visit.value.checkedOutAt
    ? new Date(visit.value.checkedOutAt).getTime()
    : nowMs.value;
  return String(Math.max(0, Math.floor((end - new Date(visit.value.checkedInAt).getTime()) / 60_000)));
}

function formatDurationSeconds(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

async function reloadRecordings() {
  if (!visit.value) return;
  loadingRecordings.value = true;
  try {
    await salesStore.loadRecordings(visit.value.id);
  } finally {
    loadingRecordings.value = false;
  }
}

function startRecording() {
  if (!canRecord.value) {
    showToast(salesStore.recordingError || '录音规则尚未就绪');
    return;
  }
  try {
    audioStatus.value = 'loading';
    adapter.startRecording({
      onSegment: (clip) => {
        void enqueueClip(clip).catch(() => undefined);
      },
      onError: (error) => {
        isRecording.value = false;
        recordingSessionStartedAt.value = null;
        audioStatus.value = 'failed';
        recordingUploadError.value = error.message;
        showToast(error.message);
      },
    });
    isRecording.value = true;
    recordingSessionStartedAt.value = Date.now();
    recordingBaselineUploadedMs.value = uploadedDurationMs.value;
    recordingUploadError.value = null;
    audioStatus.value = 'active';
  } catch (error) {
    audioStatus.value = 'failed';
    recordingSessionStartedAt.value = null;
    showToast(error instanceof Error ? error.message : '录音启动失败');
  }
}

async function stopRecording() {
  try {
    const clip = await adapter.stopRecording();
    isRecording.value = false;
    recordingSessionStartedAt.value = null;
    if (clip) {
      await enqueueClip(clip);
    } else {
      showToast('未检测到正在进行的录音');
    }
  } catch (error) {
    isRecording.value = false;
    recordingSessionStartedAt.value = null;
    audioStatus.value = 'failed';
    showToast(error instanceof Error ? error.message : '录音停止失败');
  }
}

function enqueueClip(clip: RecorderStopResult): Promise<void> {
  if (!pendingClips.value.some((item) => item.localClipId === clip.localClipId)) {
    pendingClips.value.push(clip);
  }
  // 前一片段失败时保留后续片段，等待销售一次性按时间顺序重传，避免服务端clipIndex错序。
  if (recordingUploadError.value) return Promise.resolve();
  const task = uploadQueue.then(() => processClip(clip));
  uploadQueue = task.catch(() => undefined);
  return task;
}

async function processClip(clip: RecorderStopResult) {
  if (!visit.value) return;
  uploadingRecording.value = true;
  recordingUploadError.value = null;
  try {
    if (clip.duration < minimumClipSeconds.value * 1_000) {
      const command = {
        clientClipId: clip.localClipId,
        durationMs: clip.duration,
        recordedFrom: new Date(clip.startedAt).toISOString(),
        recordedTo: new Date(clip.endedAt).toISOString(),
        reason: 'TOO_SHORT' as const,
      };
      const discardError = await salesStore.recordDiscardedClip(visit.value.id, command);
      if (discardError) throw new Error(discardError);
      try {
        await adapter.discardRecording(clip);
      } catch (error) {
        console.warn('[VisitRecording] 短录音临时文件删除失败，等待客户端清理', error);
      }
      pendingClips.value = pendingClips.value.filter((item) => item.localClipId !== clip.localClipId);
      discardedShortClipCount.value += 1;
      audioStatus.value = 'ready';
      showToast(`录音不足 ${minimumClipSeconds.value} 秒，已丢弃且不计入时长`);
      return;
    }
    const target = buildUploadRequest(`/sales/me/visits/${visit.value.id}/recordings/clips`);
    await adapter.uploadRecording(clip, {
      ...target,
      formData: {
        clientClipId: clip.localClipId,
        durationMs: String(clip.duration),
        recordedFrom: new Date(clip.startedAt).toISOString(),
        recordedTo: new Date(clip.endedAt).toISOString(),
      },
      fileName: `${clip.localClipId}.aac`,
    });
    pendingClips.value = pendingClips.value.filter((item) => item.localClipId !== clip.localClipId);
    try {
      await adapter.discardRecording(clip);
    } catch (error) {
      console.warn('[VisitRecording] 已上传录音的临时文件删除失败，等待客户端清理', error);
    }
    audioStatus.value = 'ready';
    await reloadRecordings();
    showToast(`录音已上传：${Math.round(clip.duration / 1000)} 秒`);
  } catch (error) {
    audioStatus.value = 'failed';
    recordingUploadError.value = error instanceof Error ? error.message : '录音上传失败';
    showToast(recordingUploadError.value);
    throw error;
  } finally {
    uploadingRecording.value = false;
  }
}

async function retryPendingClips() {
  const clips = [...pendingClips.value];
  if (!clips.length) return;
  recordingUploadError.value = null;
  for (const clip of clips) {
    try {
      await processClip(clip);
    } catch {
      break;
    }
  }
}

async function saveResult() {
  if (!visit.value) return;
  if (!resultFormComplete.value) {
    showToast(contactedKp.value
      ? '请完整填写 KP 称呼、电话号码和合作意向'
      : '请选择现场结果并在沟通纪要中说明情况');
    return;
  }
  savingResult.value = true;
  try {
    const updated = await salesStore.submitVisitResult(visit.value.id, {
      contactOutcome: contactOutcome.value as 'CONTACTED' | 'STORE_CLOSED' | 'KP_ABSENT' | 'REFUSED' | 'OTHER_NO_CONTACT',
      kpName: contactedKp.value ? kpName.value.trim() : null,
      kpPhone: contactedKp.value ? kpPhone.value.trim() : null,
      intentionLevel: contactedKp.value ? intentionLevel.value : null,
      resultNote: resultNote.value.trim() || null,
    });
    showToast(updated ? '拜访记录已保存' : salesStore.visitError || '拜访记录保存失败');
  } finally {
    savingResult.value = false;
  }
}

async function checkOut() {
  if (!visit.value || !canCheckOut.value) return;
  checkingOut.value = true;
  try {
    const current = await adapter.getCurrentLocation();
    const updated = await salesStore.checkOutVisit(visit.value.id, {
      idempotencyKey: createIdempotencyKey('visit-checkout'),
      clientOccurredAt: new Date().toISOString(),
      location: {
        longitude: current.longitude,
        latitude: current.latitude,
        accuracyMeters: current.accuracy,
        source: 'FEISHU',
      },
      deviceEventId: `visit-check-out-${createIdempotencyKey('device')}`,
    });
    showToast(updated ? '拜访已完成' : salesStore.visitError || '离店签退失败');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '离店签退失败');
  } finally {
    checkingOut.value = false;
  }
}

function scrollToResult() {
  document.getElementById('visit-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function handlePrimaryAction() {
  switch (primaryAction.value) {
    case 'STOP_RECORDING': await stopRecording(); break;
    case 'EDIT_RESULT':
      if (resultFormComplete.value && resultDirty.value) await saveResult();
      else scrollToResult();
      break;
    case 'CHECK_OUT': await checkOut(); break;
    default: break;
  }
}

onMounted(async () => {
  const visitId = route.query.visitId;
  if (typeof visitId === 'string' && visitId) {
    if (salesStore.activeVisit?.id !== visitId) await salesStore.loadVisit(visitId);
  } else {
    const page = await salesStore.loadVisits();
    const ongoing = page?.items.find((item) => item.status === 'CHECKED_IN');
    if (ongoing) await salesStore.loadVisit(ongoing.id);
    else {
      salesStore.activeVisit = null;
      salesStore.recordingSession = null;
    }
  }
  audioStatus.value = adapter.getAudioStatus();
  if (visit.value) await reloadRecordings();
  durationTimer = window.setInterval(() => { nowMs.value = Date.now(); }, 1_000);
});

onBeforeUnmount(() => {
  if (durationTimer !== null) window.clearInterval(durationTimer);
});

onBeforeRouteLeave(() => {
  if (!isRecording.value && !uploadingRecording.value && pendingClips.value.length === 0) return true;
  showToast(isRecording.value
    ? '请先停止并上传录音，再离开拜访页面'
    : '仍有录音正在上传或等待重传，请先处理');
  return false;
});
</script>

<template>
  <div class="workbench-page visit-page" :class="{ 'visit-page--active': isActiveVisit }">
    <van-nav-bar title="拜访执行" :fixed="true" :placeholder="true" />

    <div class="workbench-body visit-body">
      <div v-if="salesStore.visitLoading && !visit" class="visit-loading surface-card">
        <van-loading type="spinner" />
        <p>正在读取拜访信息</p>
      </div>

      <template v-else-if="visit">
        <section class="visit-hero surface-card">
          <div class="visit-hero__top">
            <div class="visit-target-icon"><van-icon name="shop-o" size="24" /></div>
            <div class="visit-hero__title">
              <p>{{ visit.targetSnapshot?.customerName || '本次拜访' }}</p>
              <h1>{{ visit.targetSnapshot?.storeName || '门店拜访' }}</h1>
              <span>{{ visit.targetSnapshot?.storeAddress || '门店地址以创建拜访时快照为准' }}</span>
            </div>
            <van-tag :type="isCompletedVisit ? 'success' : 'primary'" round>
              {{ isCompletedVisit ? '已完成' : '拜访中' }}
            </van-tag>
          </div>
          <div class="visit-hero__facts">
            <div><span>到店时间</span><strong>{{ formatTime(visit.checkedInAt) }}</strong></div>
            <div><span>已停留</span><strong>{{ dwellMinutes() }} 分钟</strong></div>
            <div><span>离店时间</span><strong>{{ formatTime(visit.checkedOutAt) }}</strong></div>
          </div>
        </section>

        <section class="visit-journey" aria-label="拜访进度">
          <div class="journey-step journey-step--done">
            <span><van-icon name="success" /></span><strong>已到店</strong>
          </div>
          <i :class="{ 'journey-line--done': visitRecordComplete }" />
          <div class="journey-step" :class="{ 'journey-step--done': visitRecordComplete, 'journey-step--active': !visitRecordComplete }">
            <span><van-icon :name="visitRecordComplete ? 'success' : 'edit'" /></span><strong>拜访记录</strong>
          </div>
          <i :class="{ 'journey-line--done': isCompletedVisit }" />
          <div class="journey-step" :class="{ 'journey-step--done': isCompletedVisit, 'journey-step--active': visitRecordComplete && !isCompletedVisit }">
            <span><van-icon :name="isCompletedVisit ? 'success' : 'location-o'" /></span><strong>完成离店</strong>
          </div>
        </section>

        <div v-if="isActiveVisit" class="current-task" :class="{ 'current-task--ready': canCheckOut }">
          <van-icon :name="canCheckOut ? 'passed' : 'clock-o'" />
          <div><strong>{{ canCheckOut ? '可以完成拜访' : '下一步' }}</strong><p>{{ currentTaskHint }}</p></div>
        </div>

        <div class="section-heading">
          <h2>现场录音</h2>
          <span :class="{ 'section-state--success': recordingRequirementSatisfied }">{{ audioStatusLabel }}</span>
        </div>
        <section id="visit-recording" class="recording-card surface-card">
          <div v-if="recordingUploadError" class="recording-error">
            <span><van-icon name="warning-o" size="22" /></span>
            <div>
              <strong>录音片段等待重传</strong>
              <p>{{ recordingUploadError }}</p>
              <small>不会把上传失败误报成角色权限问题；请保持在本页并点击重传。</small>
            </div>
          </div>
          <div v-if="salesStore.recordingError" class="recording-error">
            <span><van-icon name="warning-o" size="22" /></span>
            <div>
              <strong>录音能力暂不可用</strong>
              <p>{{ salesStore.recordingError }}</p>
              <small>可重新加载或联系管理员检查销售角色授权；该异常不会阻止保存结果和完成离店。</small>
            </div>
          </div>

          <div v-else-if="loadingRecordings || !salesStore.recordingSession" class="recording-loading">
            <van-loading size="22" /><span>正在读取本次拜访录音规则</span>
          </div>

          <template v-else>
            <div v-if="recordingPolicyInvalid" class="recording-error">
              <span><van-icon name="warning-o" size="22" /></span>
              <div>
                <strong>录音规则配置异常</strong>
                <p>本次规则启用了现场录音，但要求时长为 0 秒，系统不会将其判定为已完成。</p>
                <small>请管理员修正规则；当前拜访仍可保存现场结果并完成离店。</small>
              </div>
            </div>
            <div class="recording-summary">
              <div class="recording-icon" :class="{ 'recording-icon--active': isRecording }">
                <van-icon name="audio" size="24" />
              </div>
              <div>
                <strong>{{ isRecording ? '正在录制现场沟通' : `${salesStore.recordingSession.clipCount} 段录音` }}</strong>
                <p v-if="isRecording">
                  已连续录制 {{ recordingDurationLabel }} · 单段10分钟自动续录，不会因达标停止
                </p>
                <p v-if="salesStore.recordingSession.recordingEnabled && !recordingPolicyInvalid">
                  已上传 {{ Math.round(uploadedDurationMs / 1000) }} 秒 · 要求 {{ salesStore.recordingSession.minimumRecordingSeconds }} 秒
                </p>
                <p v-else-if="recordingPolicyInvalid">尚未开始录音 · 规则时长无效</p>
                <p v-else>本次拜访规则未要求录音</p>
              </div>
            </div>

            <div v-if="salesStore.recordingSession.recordingEnabled && !recordingPolicyInvalid" class="recording-progress">
              <div><span :style="{ width: `${recordingProgress}%` }" /></div>
              <p v-if="isRecording && remainingRecordingSeconds === 0">
                已达到考核时长，正在继续录音；停止后上传才计入有效证据
              </p>
              <p v-else>{{ recordingRequirementSatisfied ? '录音要求已完成，可按实际沟通继续录制' : `距离要求预计还剩 ${remainingRecordingSeconds} 秒` }}</p>
            </div>

            <p class="recording-policy-note">
              单段不足 {{ minimumClipSeconds }} 秒将删除音频，仅登记短录音审计；达到该时长即正常上传并累计。
            </p>

            <p v-if="pendingClips.length" class="recording-pending">
              <van-icon name="clock-o" /> {{ pendingClips.length }} 段等待上传或重传
            </p>
            <p v-if="discardedShortClipCount" class="recording-discarded">
              本次已丢弃 {{ discardedShortClipCount }} 段过短录音
            </p>

            <div v-if="salesStore.recordingSession.clips.length" class="recording-clips">
              <div v-for="clip in salesStore.recordingSession.clips" :key="clip.clipId">
                <span><van-icon name="success" /> 第 {{ clip.clipIndex + 1 }} 段</span>
                <strong>{{ Math.round((clip.clientDurationMs ?? 0) / 1000) }} 秒 · 已上传</strong>
              </div>
            </div>
          </template>

          <van-button
            v-if="salesStore.recordingError"
            block
            plain
            type="primary"
            :loading="loadingRecordings"
            @click="reloadRecordings"
          >重新加载</van-button>
          <van-button
            v-if="pendingClips.length && !isRecording"
            class="recording-retry"
            block
            plain
            type="warning"
            :loading="uploadingRecording"
            @click="retryPendingClips"
          >重传全部待上传录音</van-button>
          <van-button
            v-if="isActiveVisit && !isRecording && canRecord"
            class="recording-retry"
            block
            plain
            type="primary"
            @click="startRecording"
          >{{ recordingRequirementSatisfied ? '继续现场录音（不限制总时长）' : '开始现场录音' }}</van-button>
        </section>

        <div id="visit-result" class="section-heading visit-result-heading">
          <h2>拜访记录</h2>
          <span :class="{ 'section-state--success': resultSaved && !resultDirty }">
            {{ resultSaved ? (resultDirty ? '有未保存修改' : `已保存 ${formatTime(visit.resultSubmittedAt)}`) : '待填写' }}
          </span>
        </div>
        <section class="result-card surface-card">
          <div class="outcome-field">
            <span>本次接触结果 <i>*</i></span>
            <van-radio-group v-model="contactOutcome" @change="onContactOutcomeChanged">
              <van-radio v-for="option in contactOutcomeOptions" :key="option.value" :name="option.value">
                <strong>{{ option.label }}</strong><small>{{ option.hint }}</small>
              </van-radio>
            </van-radio-group>
          </div>
          <template v-if="contactedKp">
            <van-field v-model="kpName" label="KP 称呼" required maxlength="128" placeholder="例如：王店长" />
            <van-field v-model="kpPhone" label="联系电话" required type="tel" maxlength="32" placeholder="请输入联系电话" />
          </template>
          <div v-if="contactedKp" class="intention-field">
            <span>合作意向 <i>*</i></span>
            <van-radio-group v-model="intentionLevel" direction="horizontal">
              <van-radio v-for="option in intentionOptions" :key="option.value" :name="option.value">
                {{ option.label }}
              </van-radio>
            </van-radio-group>
          </div>
          <van-field
            v-model="resultNote"
            :label="contactedKp ? '沟通纪要' : '现场说明'"
            :required="!contactedKp"
            type="textarea"
            rows="4"
            maxlength="1024"
            show-word-limit
            :placeholder="contactedKp ? '记录需求、异议、承诺事项和下一步计划' : '说明关门、KP不在、拒绝接待等现场情况'"
          />

          <div v-if="resultSaved && !resultDirty" class="result-saved">
            <van-icon name="passed" size="20" />
            <div><strong>拜访记录已保存</strong><p>{{ contactOutcomeLabel }}<template v-if="contactedKp"> · {{ kpName }} · {{ intentionLabel }}</template></p></div>
          </div>
          <div v-else class="result-actions">
            <van-button block plain type="primary" :loading="savingResult" @click="saveResult">
              {{ resultSaved ? '保存修改' : '保存拜访记录' }}
            </van-button>
          </div>
          <p v-if="salesStore.visitError" class="form-error">{{ salesStore.visitError }}</p>
        </section>

        <section v-if="isCompletedVisit" class="completed-card surface-card">
          <van-icon name="passed" size="30" />
          <div><strong>本次拜访已完成</strong><p>到店、拜访结果和离店位置已归档；录音证据按实际上传情况核验。</p></div>
        </section>

        <van-notice-bar
          class="visit-notice"
          left-icon="info-o"
          text="录音不足不会阻止离店；它只影响有效拜访核验。关门、KP不在或拒绝接待请如实选择现场结果。"
          wrapable
        />
      </template>

      <template v-else-if="!salesStore.visitLoading">
        <section class="empty-visit surface-card">
          <div class="empty-visit__icon"><van-icon name="friends-o" size="32" /></div>
          <h1>开始一次门店拜访</h1>
          <p>选择负责门店或附近门店，系统会在创建拜访时完成到店定位签到。</p>
          <router-link to="/targets"><van-button block type="primary">选择拜访对象</van-button></router-link>
        </section>
        <div v-if="salesStore.visitError" class="visit-error">
          <van-icon name="warning-o" /><span>{{ salesStore.visitError }}</span>
        </div>
      </template>
    </div>

    <div v-if="isActiveVisit" class="visit-action-bar">
      <div class="visit-action-bar__content">
        <div>
          <strong>{{ primaryAction === 'CHECK_OUT' ? '可以完成离店' : '进行中' }}</strong>
          <p>{{ currentTaskHint }}</p>
        </div>
        <van-button
          v-if="primaryAction !== 'BLOCKED'"
          :type="primaryAction === 'STOP_RECORDING' ? 'danger' : 'primary'"
          :loading="checkingOut || uploadingRecording || loadingRecordings || savingResult"
          @click="handlePrimaryAction"
        >{{ primaryActionLabel }}</van-button>
        <van-icon v-else name="warning-o" class="visit-action-bar__warning" size="22" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.visit-page--active .visit-body { padding-bottom: 132px; }
.visit-loading { display: flex; gap: 10px; align-items: center; justify-content: center; min-height: 160px; color: var(--workbench-muted); }
.visit-hero { padding: 18px; background: linear-gradient(145deg, #fff 0%, #f4f8ff 100%); }
.visit-hero__top { display: flex; gap: 12px; align-items: flex-start; }
.visit-target-icon { display: grid; flex: 0 0 46px; height: 46px; color: var(--workbench-primary); background: #e7f0ff; border-radius: 14px; place-items: center; }
.visit-hero__title { min-width: 0; flex: 1; }
.visit-hero__title p { color: var(--workbench-primary); font-size: 12px; font-weight: 600; }
.visit-hero__title h1 { margin-top: 2px; overflow: hidden; color: var(--workbench-ink); font-size: 19px; text-overflow: ellipsis; white-space: nowrap; }
.visit-hero__title span { display: block; margin-top: 4px; overflow: hidden; color: var(--workbench-muted); font-size: 12px; line-height: 1.5; text-overflow: ellipsis; white-space: nowrap; }
.visit-hero__facts { display: grid; grid-template-columns: repeat(3, 1fr); margin-top: 18px; padding-top: 15px; border-top: 1px solid rgba(36, 104, 242, 0.1); }
.visit-hero__facts div { text-align: center; border-right: 1px solid var(--workbench-line); }
.visit-hero__facts div:last-child { border-right: 0; }
.visit-hero__facts span { display: block; color: var(--workbench-muted); font-size: 11px; }
.visit-hero__facts strong { display: block; margin-top: 4px; color: var(--workbench-ink); font-size: 13px; }
.visit-journey { display: grid; grid-template-columns: auto 1fr auto 1fr auto; align-items: start; padding: 20px 12px 8px; }
.visit-journey > i { height: 2px; margin: 15px 7px 0; background: #dde4ef; border-radius: 2px; }
.visit-journey > i.journey-line--done { background: var(--workbench-success); }
.journey-step { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 62px; color: var(--workbench-muted); font-size: 11px; }
.journey-step span { display: grid; width: 32px; height: 32px; background: #e9eef5; border-radius: 50%; place-items: center; }
.journey-step--active { color: var(--workbench-primary); }
.journey-step--active span { color: #fff; background: var(--workbench-primary); box-shadow: 0 0 0 5px rgba(36, 104, 242, 0.1); }
.journey-step--done { color: var(--workbench-success); }
.journey-step--done span { color: #fff; background: var(--workbench-success); box-shadow: none; }
.current-task { display: flex; gap: 10px; align-items: flex-start; margin: 12px 0 2px; padding: 12px 14px; color: #9a6818; background: #fff8e8; border: 1px solid #f2dfb5; border-radius: 13px; }
.current-task--ready { color: #16794f; background: #edf9f3; border-color: #ccebdc; }
.current-task strong { font-size: 13px; }
.current-task p { margin-top: 2px; font-size: 12px; line-height: 1.5; }
.section-state--success { color: var(--workbench-success) !important; }
.recording-card { padding: 16px; }
.recording-error { display: flex; gap: 11px; margin-bottom: 14px; color: #b35437; }
.recording-error > span { display: grid; flex: 0 0 40px; height: 40px; background: #fff0ea; border-radius: 12px; place-items: center; }
.recording-error strong { color: var(--workbench-ink); font-size: 13px; }
.recording-error p { margin-top: 3px; font-size: 12px; line-height: 1.5; }
.recording-error small { display: block; margin-top: 5px; color: var(--workbench-muted); font-size: 11px; line-height: 1.5; }
.recording-loading { display: flex; gap: 10px; align-items: center; justify-content: center; min-height: 80px; color: var(--workbench-muted); font-size: 12px; }
.recording-summary { display: flex; gap: 12px; align-items: center; }
.recording-icon { display: grid; flex: 0 0 48px; height: 48px; color: var(--workbench-primary); background: #eaf2ff; border-radius: 50%; place-items: center; }
.recording-icon--active { color: #fff; background: #e64b4b; box-shadow: 0 0 0 7px rgba(230, 75, 75, 0.1); }
.recording-summary strong { color: var(--workbench-ink); font-size: 14px; }
.recording-summary p { margin-top: 4px; color: var(--workbench-muted); font-size: 12px; }
.recording-progress { margin: 15px 0; }
.recording-progress > div { height: 7px; overflow: hidden; background: #e9eef5; border-radius: 99px; }
.recording-progress > div span { display: block; height: 100%; background: linear-gradient(90deg, var(--workbench-primary), #60a5fa); border-radius: inherit; transition: width 0.25s ease; }
.recording-progress p { margin-top: 6px; color: var(--workbench-muted); font-size: 11px; text-align: right; }
.recording-policy-note { margin: 10px 0 0; color: var(--workbench-muted); font-size: 11px; line-height: 1.55; }
.recording-pending { margin-top: 8px; color: #b35437; font-size: 11px; }
.recording-discarded { margin-top: 6px; color: var(--workbench-muted); font-size: 11px; }
.recording-retry { margin-top: 10px; }
.recording-clips { margin-top: 14px; padding-top: 8px; border-top: 1px solid var(--workbench-line); }
.recording-clips > div { display: flex; justify-content: space-between; padding: 7px 2px; color: var(--workbench-muted); font-size: 11px; }
.recording-clips span { display: flex; gap: 5px; align-items: center; color: var(--workbench-success); }
.recording-clips strong { color: var(--workbench-muted); font-weight: 500; }
.visit-result-heading { scroll-margin-top: 60px; }
.result-card { overflow: hidden; padding-bottom: 14px; }
.outcome-field { padding: 14px 16px; border-bottom: 1px solid var(--workbench-line); }
.outcome-field > span { display: block; margin-bottom: 12px; color: var(--workbench-ink); font-size: 14px; }
.outcome-field i { color: #ee0a24; font-style: normal; }
.outcome-field :deep(.van-radio-group) { display: grid; gap: 9px; }
.outcome-field :deep(.van-radio) { align-items: flex-start; padding: 10px 12px; background: #f7f9fc; border: 1px solid transparent; border-radius: 10px; }
.outcome-field :deep(.van-radio[aria-checked="true"]) { background: #edf4ff; border-color: #cddfff; }
.outcome-field :deep(.van-radio__label) { display: flex; flex-direction: column; margin-left: 8px; }
.outcome-field :deep(.van-radio__label strong) { color: var(--workbench-ink); font-size: 12px; }
.outcome-field :deep(.van-radio__label small) { margin-top: 2px; color: var(--workbench-muted); font-size: 10px; }
.intention-field { padding: 14px 16px; border-bottom: 1px solid var(--workbench-line); }
.intention-field > span { display: block; margin-bottom: 12px; color: var(--workbench-ink); font-size: 14px; }
.intention-field i { color: #ee0a24; font-style: normal; }
.intention-field :deep(.van-radio-group) { gap: 10px 16px; }
.intention-field :deep(.van-radio__label) { margin-left: 5px; font-size: 12px; }
.result-actions { padding: 14px 14px 0; }
.result-saved { display: flex; gap: 10px; align-items: center; margin: 14px; padding: 12px; color: var(--workbench-success); background: #edf9f3; border-radius: 12px; }
.result-saved strong { color: #16794f; font-size: 12px; }
.result-saved p { margin-top: 2px; color: var(--workbench-muted); font-size: 11px; }
.form-error { margin: 10px 14px 0; color: #c45656; font-size: 11px; line-height: 1.6; }
.completed-card { display: flex; gap: 12px; align-items: center; margin-top: 18px; padding: 17px; color: var(--workbench-success); }
.completed-card strong { color: var(--workbench-ink); }
.completed-card p { margin-top: 3px; color: var(--workbench-muted); font-size: 11px; }
.visit-notice { margin-top: 16px; border-radius: 12px; }
.empty-visit { margin-top: 18px; padding: 34px 24px 24px; text-align: center; }
.empty-visit__icon { display: grid; width: 64px; height: 64px; margin: 0 auto 16px; color: var(--workbench-primary); background: #eaf2ff; border-radius: 20px; place-items: center; }
.empty-visit h1 { color: var(--workbench-ink); font-size: 20px; }
.empty-visit p { margin: 8px 4px 22px; color: var(--workbench-muted); font-size: 12px; line-height: 1.65; }
.visit-error { display: flex; gap: 8px; align-items: center; margin-top: 12px; padding: 12px; color: #c45656; background: #fdf3f3; border-radius: 12px; font-size: 12px; }
.visit-action-bar { position: fixed; z-index: 20; right: auto; bottom: calc(50px + env(safe-area-inset-bottom)); left: 50%; width: 100%; max-width: 540px; padding: 10px 12px; background: rgba(255, 255, 255, 0.96); border-top: 1px solid var(--workbench-line); transform: translateX(-50%); backdrop-filter: blur(14px); }
.visit-action-bar__content { display: flex; gap: 12px; align-items: center; justify-content: space-between; }
.visit-action-bar__content > div { min-width: 0; flex: 1; }
.visit-action-bar strong { color: var(--workbench-ink); font-size: 12px; }
.visit-action-bar p { margin-top: 2px; overflow: hidden; color: var(--workbench-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.visit-action-bar :deep(.van-button) { flex: 0 0 auto; min-width: 132px; }
.visit-action-bar__warning { color: #c97820; }

@media (max-width: 360px) {
  .visit-action-bar__content > div { display: none; }
  .visit-action-bar :deep(.van-button) { width: 100%; }
  .visit-hero__facts strong { font-size: 12px; }
  .journey-step { min-width: 56px; }
}
</style>
