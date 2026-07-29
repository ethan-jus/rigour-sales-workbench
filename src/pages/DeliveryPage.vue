<script setup lang="ts">
// 配送跟进页面结构；业务数据由 Platform API 提供。
</script>

<template>
  <div class="delivery-page">
    <van-nav-bar title="配送跟进" :fixed="true" :placeholder="true" />

    <div class="page-body">
      <van-tabs>
        <van-tab title="待配送">
          <van-empty description="暂无待配送订单" />
        </van-tab>
        <van-tab title="配送中">
          <van-empty description="暂无配送中订单" />
        </van-tab>
        <van-tab title="已签收">
          <van-empty description="暂无已签收订单" />
        </van-tab>
      </van-tabs>
    </div>
  </div>
</template>

<style scoped>
.delivery-page {
  min-height: 100vh;
}

.page-body {
  padding: 0;
}
</style>
