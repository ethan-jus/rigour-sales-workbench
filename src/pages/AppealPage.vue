<template>
  <div class="workbench-page appeal-page">
    <van-nav-bar title="补卡与申诉" left-arrow @click-left="$router.back()" />
    <div class="workbench-body">
      <div class="surface-card appeal-summary">
        <van-icon class="appeal-icon" name="records-o" size="28" />
        <div>
          <strong>本人申请入口</strong>
          <p>用于缺卡、定位中断或拜访结果异议，不直接修改正式考勤。</p>
        </div>
      </div>
      <van-cell-group inset title="可申请事项">
        <van-cell title="上班或下班缺卡" value="待接口接入" />
        <van-cell title="定位证据异常" value="待接口接入" />
        <van-cell title="拜访结果申诉" value="待接口接入" />
      </van-cell-group>
      <van-button block type="primary" disabled>新建申请</van-button>
      <p class="skeleton-note appeal-note">申请由Sales Work受理，涉及正式考勤的结果由HR审批并主写。</p>
    </div>
  </div>
</template>

<style scoped>
.appeal-summary { display: flex; gap: 14px; align-items: center; margin-bottom: 18px; padding: 18px; }
.appeal-icon { color: var(--workbench-primary); }
.appeal-summary strong { color: var(--workbench-ink); }
.appeal-summary p { margin: 5px 0 0; color: var(--workbench-muted); font-size: 12px; line-height: 1.6; }
.appeal-note { margin: 12px 4px 0; text-align: center; }
</style>
