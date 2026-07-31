<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';
import { RouterLink, useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '@/entities/auth';
import { AuthLayout } from '@/widgets';
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

onBeforeUnmount(() => {
  authStore.clearError();
});
</script>

<template>
  <AuthLayout
    eyebrow="Naver publishing"
    headline="발행을 한 화면에서 붙잡아 둡니다"
    description="계정별 큐가 어디까지 갔는지, 무엇이 실패했는지, 다음 예약이 언제인지를 새로고침 없이 확인합니다."
  >
    <div class="mb-8">
      <h2 class="text-[19px] font-semibold tracking-tight text-ink">로그인</h2>
      <p class="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
        다붓 계정으로 들어옵니다. 등록해둔 블로그가 그대로 발행 대상이 됩니다.
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
        class-name="mt-2 h-10 w-full"
        :loading="authStore.isLoading"
        :disabled="!username.trim() || !password"
      >
        로그인
      </AppButton>
    </form>

    <p class="mt-6 text-center text-[12px] text-ink-faint">
      계정이 없으신가요?
      <RouterLink
        to="/signup"
        class="ml-1 text-accent underline-offset-4 transition-colors duration-150 hover:underline"
      >
        회원가입
      </RouterLink>
    </p>
  </AuthLayout>
</template>
