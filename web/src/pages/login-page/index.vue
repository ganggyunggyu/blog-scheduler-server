<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/entities/auth';
import { AppButton, AppField, INPUT_CLASS } from '@/shared/ui';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const username = ref('');
const password = ref('');

const handleSubmit = async () => {
  const ok = await authStore.login(username.value.trim(), password.value);
  if (!ok) return;
  const redirect = typeof route.query.redirect === 'string' ? route.query.redirect : '/';
  router.replace(redirect);
};
</script>

<template>
  <div class="grid min-h-[100dvh] place-items-center bg-surface px-5">
    <div class="w-full max-w-[340px]">
      <div class="mb-8">
        <h1 class="text-[17px] font-semibold tracking-tight text-ink">발행 스케줄러</h1>
        <p class="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
          운영 계정으로 로그인해야 큐와 스케줄에 접근할 수 있습니다.
        </p>
      </div>

      <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
        <AppField label="아이디" html-for="username">
          <input
            id="username"
            v-model="username"
            :class="INPUT_CLASS"
            type="text"
            autocomplete="username"
            autofocus
          />
        </AppField>

        <AppField label="비밀번호" html-for="password" :error="authStore.error">
          <input
            id="password"
            v-model="password"
            :class="INPUT_CLASS"
            type="password"
            autocomplete="current-password"
          />
        </AppField>

        <AppButton
          type="submit"
          variant="primary"
          class-name="mt-1 w-full"
          :loading="authStore.isLoading"
          :disabled="!username.trim() || !password"
        >
          로그인
        </AppButton>
      </form>
    </div>
  </div>
</template>
