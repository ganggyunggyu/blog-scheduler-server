<script setup lang="ts">
import { computed } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/entities/auth';
import { AppButton } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

const NAV_ITEMS = [
  { to: '/', label: '큐 현황' },
  { to: '/schedules', label: '스케줄' },
  { to: '/schedules/new', label: '새 등록' },
] as const;

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const currentPath = computed(() => route.path);

const isCurrent = (to: string): boolean =>
  to === '/' ? currentPath.value === '/' : currentPath.value.startsWith(to);

const handleLogout = () => {
  authStore.logout();
  router.replace('/login');
};
</script>

<template>
  <div class="min-h-[100dvh] bg-surface">
    <header
      class="sticky top-0 z-30 h-14 border-b border-line bg-surface/85 backdrop-blur-md"
    >
      <div class="mx-auto flex h-full max-w-[1400px] items-center gap-6 px-5">
        <RouterLink to="/" class="shrink-0 text-[13px] font-semibold tracking-tight text-ink">
          발행 스케줄러
        </RouterLink>

        <nav class="flex min-w-0 items-center gap-0.5">
          <RouterLink
            v-for="item in NAV_ITEMS"
            :key="item.to"
            :to="item.to"
            :class="
              cn(
                'rounded-[6px] px-2.5 py-1.5 text-[13px] whitespace-nowrap transition-colors duration-150',
                isCurrent(item.to)
                  ? 'bg-surface-overlay text-ink'
                  : 'text-ink-muted hover:text-ink hover:bg-surface-raised',
              )
            "
          >
            {{ item.label }}
          </RouterLink>
        </nav>

        <div class="ml-auto flex shrink-0 items-center gap-3">
          <span class="text-[12px] text-ink-faint">{{ authStore.displayName }}</span>
          <AppButton variant="ghost" size="sm" @click="handleLogout">로그아웃</AppButton>
        </div>
      </div>
    </header>

    <main class="mx-auto max-w-[1400px] px-5 py-6">
      <slot />
    </main>
  </div>
</template>
