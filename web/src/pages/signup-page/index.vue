<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { RouterLink, useRouter } from 'vue-router';
import { useAuthStore } from '@/entities/auth';
import { AuthLayout } from '@/widgets';
import { AppButton, AppField, INPUT_CLASS } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

const router = useRouter();
const authStore = useAuthStore();

const username = ref('');
const label = ref('');
const password = ref('');
const passwordConfirm = ref('');

const usernameError = computed(() => {
  const value = username.value.trim();
  if (!value) return '';
  if (value.length < 3) return '아이디는 3자 이상이어야 합니다.';
  if (value.length > 50) return '아이디는 50자를 넘을 수 없습니다.';
  return '';
});

const passwordError = computed(() => {
  if (!password.value) return '';
  if (password.value.length < 8) return '비밀번호는 8자 이상이어야 합니다.';
  return '';
});

const confirmError = computed(() => {
  if (!passwordConfirm.value) return '';
  if (password.value !== passwordConfirm.value) return '비밀번호가 일치하지 않습니다.';
  return '';
});

const passwordStrength = computed(() => {
  const value = password.value;
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return score;
});

const STRENGTH_LABEL = ['', '약함', '보통', '괜찮음', '강함'] as const;

const canSubmit = computed(
  () =>
    Boolean(username.value.trim()) &&
    Boolean(password.value) &&
    Boolean(passwordConfirm.value) &&
    !usernameError.value &&
    !passwordError.value &&
    !confirmError.value,
);

const handleSubmit = async () => {
  if (!canSubmit.value) return;
  const ok = await authStore.signup({
    username: username.value.trim(),
    password: password.value,
    label: label.value.trim(),
  });
  if (ok) router.replace('/');
};

onBeforeUnmount(() => {
  authStore.clearError();
});
</script>

<template>
  <AuthLayout
    eyebrow="Get started"
    headline="블로그를 등록하면 나머지는 큐가 합니다"
    description="다붓에 등록한 네이버 계정이 그대로 발행 대상이 됩니다. 키워드와 업체명만 넣으면 원고와 이미지까지 이어서 처리합니다."
  >
    <div class="mb-8">
      <h2 class="text-[19px] font-semibold tracking-tight text-ink">회원가입</h2>
      <p class="mt-1.5 text-[12px] leading-relaxed text-ink-faint">
        다붓 계정이 새로 만들어집니다. 이미 있다면 그대로 로그인하면 됩니다.
      </p>
    </div>

    <form class="flex flex-col gap-4" @submit.prevent="handleSubmit">
      <AppField label="아이디" html-for="signup-username" :error="usernameError" hint="3자 이상">
        <input
          id="signup-username"
          v-model="username"
          :class="INPUT_CLASS"
          type="text"
          autocomplete="username"
          autofocus
        />
      </AppField>

      <AppField label="표시 이름" html-for="signup-label" hint="비워두면 아이디가 쓰입니다">
        <input
          id="signup-label"
          v-model="label"
          :class="INPUT_CLASS"
          type="text"
          autocomplete="nickname"
        />
      </AppField>

      <AppField label="비밀번호" html-for="signup-password" :error="passwordError">
        <input
          id="signup-password"
          v-model="password"
          :class="INPUT_CLASS"
          type="password"
          autocomplete="new-password"
        />
        <div v-if="password" class="mt-2 flex items-center gap-2">
          <div class="flex flex-1 gap-1">
            <span
              v-for="step in 4"
              :key="step"
              :class="
                cn(
                  'h-[3px] flex-1 rounded-full transition-colors duration-200',
                  step <= passwordStrength ? 'bg-accent' : 'bg-line',
                )
              "
            />
          </div>
          <span class="w-10 text-right text-[11px] text-ink-faint">
            {{ STRENGTH_LABEL[passwordStrength] }}
          </span>
        </div>
      </AppField>

      <AppField
        label="비밀번호 확인"
        html-for="signup-password-confirm"
        :error="confirmError || authStore.error"
      >
        <input
          id="signup-password-confirm"
          v-model="passwordConfirm"
          :class="INPUT_CLASS"
          type="password"
          autocomplete="new-password"
        />
      </AppField>

      <AppButton
        type="submit"
        variant="primary"
        class-name="mt-2 h-10 w-full"
        :loading="authStore.isLoading"
        :disabled="!canSubmit"
      >
        계정 만들기
      </AppButton>
    </form>

    <p class="mt-6 text-center text-[12px] text-ink-faint">
      이미 계정이 있으신가요?
      <RouterLink
        to="/login"
        class="ml-1 text-accent underline-offset-4 transition-colors duration-150 hover:underline"
      >
        로그인
      </RouterLink>
    </p>
  </AuthLayout>
</template>
