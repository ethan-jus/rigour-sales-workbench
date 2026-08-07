<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useSalesStore } from '@/stores/sales';

const salesStore = useSalesStore();
const workDay = computed(() => salesStore.workDay);

function localDate(): string {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

onMounted(() => {
  void salesStore.loadWorkDay(localDate());
});
</script>

<template>
  <div class="workbench-page">
    <van-nav-bar title="我的记录" :fixed="true" :placeholder="true" />
    <van-tabs sticky offset-top="46">
      <van-tab title="当日轨迹">
        <div v-if="workDay" class="record-card surface-card">
          <div class="record-card__header"><strong>今日工作日</strong><span>{{ workDay.status }}</span></div>
          <van-cell title="签到" :value="workDay.checkedInAt || '--'" />
          <van-cell title="签退" :value="workDay.checkedOutAt || '--'" />
          <div class="record-card__grid">
            <div><span>定位点</span><strong>{{ workDay.locationPointCount }}</strong></div>
            <div><span>中断</span><strong>{{ workDay.interruptionCount }}</strong></div>
            <div><span>规则版本</span><strong>{{ workDay.fieldPolicyVersionId.slice(0, 8) }}</strong></div>
          </div>
          <p>定位点和中断是Sales Work保存的运行事实，不直接等同于绩效或考勤结论。</p>
        </div>
        <div v-else class="record-state">
          <van-icon class="record-icon" name="location-o" size="34" />
          <strong>{{ salesStore.attendanceError || '今日尚未创建工作日' }}</strong>
          <p>签到后由Sales Work接收前台定位采样；中断只形成证据质量记录。</p>
        </div>
      </van-tab>
      <van-tab title="拜访记录">
        <div class="record-state">
          <van-icon class="record-icon" name="orders-o" size="34" />
          <strong>暂无拜访记录</strong>
          <p>接入本人拜访查询后显示门店、到店时间、提交状态和复核结果。</p>
        </div>
      </van-tab>
      <van-tab title="证据状态">
        <div class="record-state">
          <van-icon class="record-icon" name="shield-o" size="34" />
          <strong>暂无证据处理结果</strong>
          <p>录音上传、AI分析和主管复核状态由服务端返回，H5不自行判定。</p>
        </div>
      </van-tab>
    </van-tabs>
  </div>
</template>

<style scoped>
.record-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 18px 14px;
  padding: 52px 30px;
  color: var(--workbench-muted);
  text-align: center;
  background: #fff;
  border: 1px solid var(--workbench-line);
  border-radius: 16px;
}
.record-card { margin: 18px 14px; padding: 6px 0 14px; overflow: hidden; }
.record-card__header { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px 8px; color: var(--workbench-ink); }
.record-card__header span { color: var(--workbench-primary); font-size: 12px; }
.record-card__grid { display: grid; grid-template-columns: repeat(3, 1fr); padding: 14px 8px; text-align: center; border-top: 1px solid var(--workbench-line); }
.record-card__grid div { border-right: 1px solid var(--workbench-line); }
.record-card__grid div:last-child { border-right: 0; }
.record-card__grid span { display: block; color: var(--workbench-muted); font-size: 11px; }
.record-card__grid strong { display: block; margin-top: 5px; color: var(--workbench-ink); font-size: 14px; }
.record-card > p { margin: 0 16px; color: var(--workbench-muted); font-size: 11px; line-height: 1.6; }
.record-icon { color: #8ba9dd; }
.record-state strong { margin-top: 16px; color: var(--workbench-ink); font-size: 15px; }
.record-state p { margin: 8px 0 0; font-size: 12px; line-height: 1.7; }
</style>
