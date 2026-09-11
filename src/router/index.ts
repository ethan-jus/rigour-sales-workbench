import { createRouter, createWebHashHistory } from 'vue-router';
import { useAuthStore } from '@/stores/auth';
import { ROUTE_FEATURES, type AppFeature } from '@/features/catalog';

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
      meta: { title: '考勤', feature: 'sales.attendance' },
    },
    {
      path: '/targets',
      name: 'targets',
      component: () => import('@/pages/VisitTargetsPage.vue'),
      meta: { title: '客户与门店', feature: 'sales.targets' },
    },
    {
      path: '/visit',
      name: 'visit',
      component: () => import('@/pages/VisitPage.vue'),
      meta: { title: '拜访', feature: 'sales.visit' },
    },
    {
      path: '/track',
      name: 'track',
      component: () => import('@/pages/TrackPage.vue'),
      meta: { title: '轨迹', feature: 'sales.track' },
    },
    {
      path: '/chat',
      name: 'chat',
      component: () => import('@/pages/ChatPage.vue'),
      meta: { title: '内部沟通', feature: 'chat' },
    },
    {
      path: '/chat/:conversationId',
      name: 'conversation',
      component: () => import('@/pages/ConversationPage.vue'),
      meta: { title: '会话', feature: 'chat' },
    },
    {
      path: '/meetings/:meetingId',
      name: 'meeting',
      component: () => import('@/pages/MeetingPage.vue'),
      meta: { title: '语音会议', feature: 'chat' },
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
    {
      path: '/policy',
      name: 'policy',
      component: () => import('@/pages/PolicyPage.vue'),
      meta: { title: '当前规则', feature: 'sales.policy' },
    },
    {
      path: '/appeals',
      name: 'appeals',
      component: () => import('@/pages/AppealPage.vue'),
      meta: { title: '补卡与申诉', feature: 'sales.appeals' },
    },
    {
      path: '/privacy',
      name: 'privacy',
      component: () => import('@/pages/PrivacyPage.vue'),
      meta: { title: '隐私与授权' },
    },
  ],
});

router.beforeEach((to) => {
  const authStore = useAuthStore();
  if (!authStore.isLoggedIn) return true;
  if (to.name === 'home' && !authStore.isSalesUser) {
    return authStore.hasFeature('chat') ? '/chat' : '/profile';
  }
  const routeName = typeof to.name === 'string' ? to.name : '';
  const feature = (to.meta.feature as AppFeature | undefined) || ROUTE_FEATURES[routeName];
  if (feature && !authStore.hasFeature(feature)) {
    return authStore.hasFeature('chat') ? '/chat' : '/profile';
  }
  return true;
});

router.afterEach((to) => {
  const title = (to.meta.title as string) || '瑞盖销售工作台';
  document.title = title;
});

export default router;
