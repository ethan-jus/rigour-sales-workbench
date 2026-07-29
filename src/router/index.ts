import { createRouter, createWebHashHistory } from 'vue-router';

/**
 * 飞书销售 H5 路由配置。
 *
 * 使用 Hash Router，使业务路由变化不改变飞书 JSSDK 的签名 URL（签名时需移除 fragment），
 * 同时避免直接刷新子页面时依赖 Web 服务器 SPA fallback。
 * 路由按销售日常工作流组织：工作台 → 拜访/配送 → 考勤/轨迹 → 个人。
 * 每个路由的 meta.title 用于 document.title 和页面标题展示。
 *
 * 页面组件使用动态 import 实现路由级代码分割。
 */
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/home',
    },
    {
      path: '/home',
      name: 'home',
      component: () => import('@/pages/HomePage.vue'),
      meta: { title: '工作台' },
    },
    {
      path: '/attendance',
      name: 'attendance',
      component: () => import('@/pages/AttendancePage.vue'),
      meta: { title: '考勤' },
    },
    {
      path: '/visit',
      name: 'visit',
      component: () => import('@/pages/VisitPage.vue'),
      meta: { title: '拜访' },
    },
    {
      path: '/track',
      name: 'track',
      component: () => import('@/pages/TrackPage.vue'),
      meta: { title: '轨迹' },
    },
    {
      path: '/delivery',
      name: 'delivery',
      component: () => import('@/pages/DeliveryPage.vue'),
      meta: { title: '配送跟进' },
    },
    {
      path: '/profile',
      name: 'profile',
      component: () => import('@/pages/ProfilePage.vue'),
      meta: { title: '个人' },
    },
  ],
});

router.afterEach((to) => {
  const title = (to.meta.title as string) || '瑞盖销售工作台';
  document.title = title;
});

export default router;
