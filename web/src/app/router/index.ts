import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { getToken } from '@/entities/auth/lib';

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/pages/login-page/index.vue'),
    meta: { public: true },
  },
  {
    path: '/signup',
    name: 'signup',
    component: () => import('@/pages/signup-page/index.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/pages/dashboard-page/index.vue'),
  },
  {
    path: '/schedules',
    name: 'schedules',
    component: () => import('@/pages/schedule-list-page/index.vue'),
  },
  {
    path: '/schedules/new',
    name: 'schedule-new',
    component: () => import('@/pages/schedule-new-page/index.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

export const router = createRouter({
  history: createWebHistory(),
  routes,
});

router.beforeEach((to) => {
  const isLoggedIn = Boolean(getToken());

  if (!to.meta.public && !isLoggedIn) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }
  if (to.meta.public && isLoggedIn) {
    return { path: '/' };
  }
  return true;
});
