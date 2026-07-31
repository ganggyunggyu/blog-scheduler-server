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
const expandedUid = ref('block-0');
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
  const uid = `block-${blockSeed.value}`;
  blocks.value = [...blocks.value, createAccountBlock(uid)];
  expandedUid.value = uid;
  blockSeed.value += 1;
};

/** 한 번에 하나만 펼친다. 계정이 늘어나면 세로로 감당이 안 된다. */
const handleBlockToggle = (uid: string) => {
  expandedUid.value = expandedUid.value === uid ? '' : uid;
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
    <AppPanel title="발행 설정" :hint="preset.note">
      <div class="flex flex-wrap gap-1.5 border-b border-line p-3">
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

      <div class="grid gap-4 p-3 md:grid-cols-4">
        <AppField label="시작 날짜" hint="비우면 오늘부터">
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

        <AppField label="글 간격(분)">
          <input
            v-model.number="delayBetweenPosts"
            :class="INPUT_CLASS"
            type="number"
            min="0"
            max="120"
          />
        </AppField>
      </div>

      <!-- 프리셋이 확정한 값은 읽기 전용이라 한 줄 메타로만 깐다. -->
      <p
        class="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-ink-faint"
      >
        <span>원고 <span class="font-mono text-ink-muted">{{ preset.manuscriptType }}</span></span>
        <span>이미지 <span class="font-mono text-ink-muted">{{ preset.imageSource }}</span></span>
        <span>서비스 <span class="font-mono text-ink-muted">{{ preset.service }}</span></span>
        <span>
          카테고리
          <span class="font-mono text-ink-muted">{{ preset.keywordCategory || '계정 설정' }}</span>
        </span>
      </p>
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
        :expanded="expandedUid === block.uid"
        @toggle="handleBlockToggle"
        @update="handleBlockUpdate"
        @remove="handleBlockRemove"
        @test-login="handleTestLogin"
      />

      <AppButton variant="outline" class-name="self-start" @click="handleAddBlock">
        계정 추가
      </AppButton>

      <p v-if="loginResult" class="text-[12px] text-ink-muted">{{ loginResult }}</p>
    </div>

    <div class="sticky bottom-0 -mx-5 mt-1 border-t border-line bg-surface/95 px-5 py-3 backdrop-blur-md">
      <ul v-if="errors.length" class="mb-2.5 flex max-h-24 flex-col overflow-y-auto">
        <li
          v-for="(issue, index) in errors"
          :key="index"
          class="py-0.5 text-[12px] leading-relaxed text-state-failed"
        >
          {{ issue.message }}
        </li>
      </ul>

      <div class="flex flex-wrap items-center justify-between gap-4">
        <div class="flex items-baseline gap-6">
          <span class="text-[12px] text-ink-muted">
            계정 <span class="tnum text-ink">{{ blocks.length }}</span>
          </span>
          <span class="text-[12px] text-ink-muted">
            키워드 <span class="tnum text-ink">{{ totalKeywords }}</span>
          </span>
          <span class="text-[12px] text-ink-muted">
            예상 <span class="tnum text-ink">{{ estimatedDays }}</span>일
          </span>
          <span v-if="submitError" class="text-[12px] text-state-failed">{{ submitError }}</span>
        </div>

        <AppButton
          variant="primary"
          :disabled="!canSubmit"
          :loading="create.isPending.value"
          @click="handleSubmit"
        >
          스케줄 등록
        </AppButton>
      </div>
    </div>

  </div>
</template>
