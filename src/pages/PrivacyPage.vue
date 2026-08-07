<template>
  <div class="workbench-page privacy-page">
    <van-nav-bar title="隐私与授权" left-arrow @click-left="$router.back()" />
    <div class="workbench-body">
      <van-cell-group inset title="移动端能力">
        <van-cell title="身份" label="飞书一次性授权码由后端交换，不在前端保存App Secret" />
        <van-cell title="定位" label="仅工作期间前台尽力采样；锁屏和后台可能中断" />
        <van-cell title="录音" label="仅拜访执行时由销售主动开启，并记录告知与授权" />
      </van-cell-group>
      <van-cell-group inset title="使用边界">
        <van-cell title="正式考勤" value="由HR形成" />
        <van-cell title="AI分析" value="只提供建议" />
        <van-cell title="录音播放" value="按权限审计" />
      </van-cell-group>
      <van-notice-bar left-icon="shield-o" text="定位中断、缺少录音或AI低置信度都不能单独作为处罚依据。" wrapable />
    </div>
  </div>
</template>

<style scoped>
.privacy-page :deep(.van-cell-group) { margin-bottom: 16px; }
</style>
