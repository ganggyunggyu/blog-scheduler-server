<script setup lang="ts">
import { computed } from 'vue';
import type { DomainPreset } from '@/entities/schedule';
import { AppButton, AppField, INPUT_CLASS } from '@/shared/ui';
import { parseTargets, type AccountBlock } from '../model';

interface Props {
  block: AccountBlock;
  preset: DomainPreset;
  index: number;
  removable: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{
  update: [block: AccountBlock];
  remove: [uid: string];
  testLogin: [block: AccountBlock];
}>();

const targets = computed(() => parseTargets(props.block, props.preset));

const patch = (partial: Partial<AccountBlock>) => {
  emit('update', { ...props.block, ...partial });
};

const handleAccountIdInput = (event: Event) => {
  patch({ accountId: (event.target as HTMLInputElement).value });
};

const handlePasswordInput = (event: Event) => {
  patch({ password: (event.target as HTMLInputElement).value });
};

const handleBlogNameInput = (event: Event) => {
  patch({ blogName: (event.target as HTMLInputElement).value });
};

const handleKeywordsInput = (event: Event) => {
  patch({ rawKeywords: (event.target as HTMLTextAreaElement).value });
};

const handleOffsetToggle = () => {
  patch({ startOffset: props.block.startOffset === 0 ? 1 : 0 });
};

const handleRemove = () => {
  emit('remove', props.block.uid);
};

const handleTestLogin = () => {
  emit('testLogin', props.block);
};
</script>

<template>
  <div class="rounded-[10px] border border-line bg-surface-raised">
    <header class="flex h-10 items-center justify-between border-b border-line px-3">
      <span class="tnum text-[12px] text-ink-faint">계정 {{ props.index + 1 }}</span>
      <div class="flex items-center gap-1.5">
        <AppButton
          size="sm"
          variant="ghost"
          :disabled="!props.block.accountId || !props.block.password"
          @click="handleTestLogin"
        >
          로그인 확인
        </AppButton>
        <AppButton v-if="props.removable" size="sm" variant="danger" @click="handleRemove">
          삭제
        </AppButton>
      </div>
    </header>

    <div class="grid gap-4 p-3 md:grid-cols-2">
      <AppField label="계정 ID">
        <input
          :class="INPUT_CLASS"
          type="text"
          autocomplete="off"
          :value="props.block.accountId"
          @input="handleAccountIdInput"
        />
      </AppField>

      <AppField label="비밀번호">
        <input
          :class="INPUT_CLASS"
          type="password"
          autocomplete="new-password"
          :value="props.block.password"
          @input="handlePasswordInput"
        />
      </AppField>

      <AppField
        v-if="props.preset.alternatingTypes"
        label="블로그 캐릭터"
        hint="맛집2 원고의 화자를 계정마다 하나로 고정합니다. 맛집1은 이 값을 쓰지 않습니다."
      >
        <input
          :class="INPUT_CLASS"
          type="text"
          placeholder="블루망고 / 제이제이 / 삼남매 / 사랑채 / 호이호이 / 바글바글"
          :value="props.block.blogName"
          @input="handleBlogNameInput"
        />
      </AppField>

      <AppField
        v-if="props.preset.alternatingTypes"
        label="시작 원고"
        hint="첫 글을 맛집1로 시작할지 맛집2로 시작할지 정합니다."
      >
        <AppButton size="md" variant="outline" class-name="w-full" @click="handleOffsetToggle">
          {{ props.block.startOffset === 0 ? '맛집1부터 시작' : '맛집2부터 시작' }}
        </AppButton>
      </AppField>

      <AppField
        label="키워드"
        class-name="md:col-span-2"
        :hint="
          props.preset.requiresBusinessName
            ? '한 줄에 하나씩. `키워드 | 업체명` 형식으로 업체명을 함께 넣어주세요.'
            : '한 줄에 하나씩 입력하세요.'
        "
      >
        <textarea
          :class="[INPUT_CLASS, 'min-h-[132px] resize-y font-mono text-[12px] leading-relaxed']"
          spellcheck="false"
          :placeholder="
            props.preset.requiresBusinessName
              ? '부천상동맛집 | 긴꼬리초밥\n인천부평맛집 | 복화루'
              : '키워드1\n키워드2'
          "
          :value="props.block.rawKeywords"
          @input="handleKeywordsInput"
        />
      </AppField>
    </div>

    <div v-if="targets.length" class="border-t border-line px-3 py-2.5">
      <ul class="flex flex-col gap-1">
        <li
          v-for="(target, targetIndex) in targets"
          :key="`${target.keyword}-${targetIndex}`"
          class="flex items-baseline gap-3 text-[12px]"
        >
          <span class="tnum w-5 shrink-0 text-ink-faint">{{ targetIndex + 1 }}</span>
          <span class="min-w-0 flex-1 truncate text-ink">{{ target.keyword }}</span>
          <span
            v-if="props.preset.requiresBusinessName"
            class="w-40 shrink-0 truncate text-ink-muted"
            >{{ target.businessName || '업체명 없음' }}</span
          >
          <span class="w-24 shrink-0 text-right font-mono text-[11px] text-ink-faint">
            {{ target.manuscriptType }}
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
