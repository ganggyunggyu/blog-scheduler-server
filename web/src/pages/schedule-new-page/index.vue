<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  DOMAIN_PRESETS,
  findPreset,
  useScheduleMutations,
  type AutoSchedulePayload,
  type ScheduleMode,
} from '@/entities/schedule';
import { useBlogAccounts, checkBlogCredential } from '@/entities/blog-account';
import {
  AccountEditor,
  createAccountBlock,
  parseTargets,
  validateBlocks,
  type AccountBlock,
} from '@/features/schedule-form';
import { AppButton, AppField, AppPanel, INPUT_CLASS } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

const MODE_OPTIONS: Array<{ value: ScheduleMode; label: string }> = [
  { value: '1', label: '하루 1건' },
  { value: '2', label: '하루 2건' },
  { value: '3', label: '하루 3건' },
  { value: '2121', label: '2-1 교대' },
];

const router = useRouter();
const { create, checkLogin } = useScheduleMutations();
const { data: blogAccountData, isPending: isBlogAccountsLoading } = useBlogAccounts();

const blogAccounts = computed(() => blogAccountData.value ?? []);

const defaultPreset = findPreset('');

const presetId = ref(defaultPreset.id);
const scheduleDate = ref('');
const scheduleMode = ref<ScheduleMode>(defaultPreset.scheduleMode);
const imageCount = ref(5);
const delayBetweenPosts = ref(10);
const blockSeed = ref(1);
const blocks = ref<AccountBlock[]>([createAccountBlock('block-0')]);
const loginResult = ref('');
const submitError = ref('');

const preset = computed(() => findPreset(presetId.value));

const issues = computed(() => validateBlocks(blocks.value, preset.value));
const errors = computed(() => issues.value.filter((issue) => issue.level === 'error'));

const totalKeywords = computed(() =>
  blocks.value.reduce((sum, block) => sum + parseTargets(block, preset.value).length, 0),
);

const perDay = computed(() => (scheduleMode.value === '2121' ? 1.5 : Number(scheduleMode.value)));

const estimatedDays = computed(() => {
  const maxPerAccount = blocks.value.reduce(
    (max, block) => Math.max(max, parseTargets(block, preset.value).length),
    0,
  );
  if (!maxPerAccount || !perDay.value) return 0;
  return Math.ceil(maxPerAccount / perDay.value);
});

const canSubmit = computed(() => totalKeywords.value > 0 && errors.value.length === 0);

const handlePresetChange = (id: string) => {
  presetId.value = id;
  scheduleMode.value = findPreset(id).scheduleMode;
};

const handleModeChange = (event: Event) => {
  scheduleMode.value = (event.target as HTMLSelectElement).value as ScheduleMode;
};

const handleBlockUpdate = (next: AccountBlock) => {
  blocks.value = blocks.value.map((block) => (block.uid === next.uid ? next : block));
};

const handleBlockRemove = (uid: string) => {
  blocks.value = blocks.value.filter((block) => block.uid !== uid);
};

const handleAddBlock = () => {
  blocks.value = [...blocks.value, createAccountBlock(`block-${blockSeed.value}`)];
  blockSeed.value += 1;
};

const handleTestLogin = async (block: AccountBlock) => {
  loginResult.value = '';

  if (block.dabutAccountId) {
    try {
      const result = await checkBlogCredential(block.dabutAccountId);
      loginResult.value = result.ok
        ? `${result.loginId} 크리덴셜 확인됨`
        : `크리덴셜 확인 실패: ${result.message ?? '사유 없음'}`;
    } catch {
      loginResult.value = '크리덴셜 확인 요청이 실패했습니다.';
    }
    return;
  }

  try {
    const result = await checkLogin.mutateAsync({
      id: block.accountId.trim(),
      password: block.password,
    });
    loginResult.value = result?.success
      ? `${block.accountId} 로그인 성공`
      : `${block.accountId} 로그인 실패: ${result?.message ?? '사유 없음'}`;
  } catch {
    loginResult.value = `${block.accountId} 로그인 확인 요청이 실패했습니다.`;
  }
};

const buildPayload = (): AutoSchedulePayload => {
  const current = preset.value;
  return {
    queues: blocks.value.map((block) => {
      const targets = parseTargets(block, current);
      const account = block.dabutAccountId
        ? { dabutAccountId: block.dabutAccountId }
        : { id: block.accountId.trim(), password: block.password };

      return {
        account,
        keywords: targets.map((target) => target.keyword),
        item_options: targets.map((target) => ({
          businessName: target.businessName || undefined,
          manuscriptType: target.manuscriptType,
        })),
        blog_name: block.blogName.trim() || undefined,
      };
    }),
    schedule_date: scheduleDate.value || undefined,
    schedule_mode: scheduleMode.value,
    service: current.service,
    generate_images: true,
    image_count: imageCount.value,
    image_source: current.imageSource,
    manuscript_type: current.manuscriptType,
    delay_between_posts: delayBetweenPosts.value,
    keyword_category: current.keywordCategory || undefined,
  };
};

const handleSubmit = async () => {
  submitError.value = '';
  const confirmed = window.confirm(
    `${blocks.value.length}개 계정 / 키워드 ${totalKeywords.value}개를 ${preset.value.label} 설정으로 등록합니다. 계속할까요?`,
  );
  if (!confirmed) return;

  try {
    await create.mutateAsync(buildPayload());
    router.push('/');
  } catch (error: unknown) {
    const message =
      error && typeof error === 'object' && 'message' in error ? String(error.message) : '';
    submitError.value = `등록에 실패했습니다. ${message}`;
  }
};
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppPanel title="도메인" :hint="preset.note">
      <div class="flex flex-wrap gap-1.5 p-3">
        <button
          v-for="item in DOMAIN_PRESETS"
          :key="item.id"
          type="button"
          :class="
            cn(
              'rounded-[6px] border px-3 py-1.5 text-[13px] transition-colors duration-150',
              presetId === item.id
                ? 'border-accent bg-accent-dim text-accent'
                : 'border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink',
            )
          "
          @click="handlePresetChange(item.id)"
        >
          {{ item.label }}
        </button>
      </div>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-2 border-t border-line px-4 py-3 md:grid-cols-4">
        <div class="flex items-baseline justify-between gap-2">
          <dt class="text-[11px] text-ink-faint">원고</dt>
          <dd class="font-mono text-[12px] text-ink">{{ preset.manuscriptType }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-2">
          <dt class="text-[11px] text-ink-faint">이미지</dt>
          <dd class="font-mono text-[12px] text-ink">{{ preset.imageSource }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-2">
          <dt class="text-[11px] text-ink-faint">서비스</dt>
          <dd class="font-mono text-[12px] text-ink">{{ preset.service }}</dd>
        </div>
        <div class="flex items-baseline justify-between gap-2">
          <dt class="text-[11px] text-ink-faint">카테고리</dt>
          <dd class="font-mono text-[12px] text-ink">{{ preset.keywordCategory || '계정 설정' }}</dd>
        </div>
      </dl>
    </AppPanel>

    <AppPanel title="발행 조건">
      <div class="grid gap-4 p-3 md:grid-cols-4">
        <AppField label="시작 날짜" hint="비우면 오늘부터 시작합니다.">
          <input v-model="scheduleDate" :class="INPUT_CLASS" type="date" />
        </AppField>

        <AppField label="모드">
          <select :value="scheduleMode" :class="INPUT_CLASS" @change="handleModeChange">
            <option v-for="option in MODE_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </AppField>

        <AppField label="이미지 개수">
          <input v-model.number="imageCount" :class="INPUT_CLASS" type="number" min="1" max="20" />
        </AppField>

        <AppField label="글 사이 간격(분)">
          <input
            v-model.number="delayBetweenPosts"
            :class="INPUT_CLASS"
            type="number"
            min="0"
            max="120"
          />
        </AppField>
      </div>
    </AppPanel>

    <div class="flex flex-col gap-3">
      <AccountEditor
        v-for="(block, index) in blocks"
        :key="block.uid"
        :block="block"
        :preset="preset"
        :index="index"
        :removable="blocks.length > 1"
        :blog-accounts="blogAccounts"
        :blog-accounts-loading="isBlogAccountsLoading"
        @update="handleBlockUpdate"
        @remove="handleBlockRemove"
        @test-login="handleTestLogin"
      />

      <AppButton variant="outline" class-name="self-start" @click="handleAddBlock">
        계정 추가
      </AppButton>

      <p v-if="loginResult" class="text-[12px] text-ink-muted">{{ loginResult }}</p>
    </div>

    <AppPanel title="확인">
      <div class="flex flex-wrap items-end gap-8 px-4 py-3">
        <div class="flex flex-col gap-1">
          <span class="text-[11px] text-ink-faint">계정</span>
          <span class="tnum text-[20px] leading-none text-ink">{{ blocks.length }}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-[11px] text-ink-faint">총 키워드</span>
          <span class="tnum text-[20px] leading-none text-ink">{{ totalKeywords }}</span>
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-[11px] text-ink-faint">예상 소요일</span>
          <span class="tnum text-[20px] leading-none text-ink">{{ estimatedDays }}</span>
        </div>
      </div>

      <ul v-if="errors.length" class="border-t border-line px-4 py-3">
        <li
          v-for="(issue, index) in errors"
          :key="index"
          class="py-0.5 text-[12px] leading-relaxed text-state-failed"
        >
          {{ issue.message }}
        </li>
      </ul>

      <div class="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
        <p class="text-[11px] leading-relaxed text-ink-faint">
          등록하면 계정별 큐에 바로 들어갑니다. 실제 예약 여부는 네이버에서 다시 확인해야 합니다.
        </p>
        <AppButton
          variant="primary"
          :disabled="!canSubmit"
          :loading="create.isPending.value"
          @click="handleSubmit"
        >
          스케줄 등록
        </AppButton>
      </div>

      <p v-if="submitError" class="border-t border-line px-4 py-2.5 text-[12px] text-state-failed">
        {{ submitError }}
      </p>
    </AppPanel>
  </div>
</template>
