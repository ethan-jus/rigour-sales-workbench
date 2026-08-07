<template>
  <div class="policy-page">
    <van-nav-bar title="当前生效规则" left-arrow @click-left="$router.back()" />
    <van-cell-group inset title="外勤规则">
      <van-cell title="签到与签退" value="由Sales Work规则版本下发" />
      <van-cell title="定位采样" value="签到后开始 · 签退后停止" />
      <van-cell title="业务日与工作时长" value="待接口接入" />
    </van-cell-group>
    <van-cell-group inset title="拜访规则">
      <van-cell title="客户与门店" value="CRM有效归属" />
      <van-cell title="签到距离与停留" value="待接口接入" />
      <van-cell title="录音与AI" value="服务端验证 · 异常复核" />
    </van-cell-group>
    <van-notice-bar left-icon="info-o" text="H5只展示本人当前生效规则；规则草稿、审批和发布在Portal销售管理中完成。" wrapable />
  </div>
</template>

<style scoped>
.policy-page { min-height: 100vh; padding-bottom: 16px; }
</style>
