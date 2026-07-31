<script setup lang="ts">
import { computed } from 'vue';
import type { AccountQueueStatus } from '@/entities/queue';
import { ProgressLine } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

interface Props {
  account: AccountQueueStatus;
  expanded: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ toggle: [accountId: string] }>();

const totalOf = (counts: { waiting: number; active: number; completed: number }) =>
  counts.waiting + counts.active + counts.completed;

const publishTotal = computed(() => totalOf(props.account.publish));
const failedTotal = computed(() => props.account.generate.failed + props.account.publish.failed);
const isRunning = computed(() => props.account.generate.active + props.account.publish.active > 0);

/* 0 은 흐리게 깔아두고 값이 있을 때만 색을 준다. 행이 100개 넘어가면 이게 유일한 단서다. */
const numberClass = (value: number, tone: string) =>
  cn('tnum text-[12px]', value > 0 ? tone : 'text-ink-faint/40');

const handleToggle = () => {
  emit('toggle', props.account.accountId);
};
</script>

<template>
  <div class="transition-colors duration-150 hover:bg-surface-overlay/40">
    <button
      type="button"
      class="grid w-full grid-cols-[minmax(0,1fr)_repeat(6,44px)_minmax(80px,120px)] items-center gap-x-2 px-4 py-2 text-left"
      @click="handleToggle"
    >
      <span
        :class="
          cn(
            'flex min-w-0 items-center gap-2 truncate text-[13px]',
            isRunning ? 'text-ink' : 'text-ink-muted',
          )
        "
      >
        <span
          v-if="isRunning"
          class="size-1.5 shrink-0 rounded-full bg-state-active"
          aria-label="진행 중"
        />
        <span class="truncate">{{ props.account.accountId }}</span>
      </span>

      <span :class="[numberClass(props.account.generate.active, 'text-state-active'), 'text-right']">
        {{ props.account.generate.active }}
      </span>
      <span :class="[numberClass(props.account.generate.waiting, 'text-ink'), 'text-right']">
        {{ props.account.generate.waiting }}
      </span>
      <span :class="[numberClass(props.account.generate.completed, 'text-ink-muted'), 'text-right']">
        {{ props.account.generate.completed }}
      </span>

      <span :class="[numberClass(props.account.publish.active, 'text-state-active'), 'text-right']">
        {{ props.account.publish.active }}
      </span>
      <span :class="[numberClass(props.account.publish.waiting, 'text-ink'), 'text-right']">
        {{ props.account.publish.waiting }}
      </span>
      <span :class="[numberClass(failedTotal, 'text-state-failed'), 'text-right']">
        {{ failedTotal }}
      </span>

      <span class="pl-3">
        <ProgressLine
          :done="props.account.publish.completed"
          :total="Math.max(publishTotal, 1)"
          :failed="props.account.publish.failed"
        />
      </span>
    </button>

    <div v-if="props.expanded" class="border-t border-line px-4 py-3">
      <slot name="detail" />
    </div>
  </div>
</template>
