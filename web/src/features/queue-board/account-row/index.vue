<script setup lang="ts">
import { computed } from 'vue';
import type { AccountQueueStatus } from '@/entities/queue';
import { ProgressLine, StateBadge } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';

interface Props {
  account: AccountQueueStatus;
  expanded: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits<{ toggle: [accountId: string] }>();

const totalOf = (counts: { waiting: number; active: number; completed: number }) =>
  counts.waiting + counts.active + counts.completed;

const generateTotal = computed(() => totalOf(props.account.generate));
const publishTotal = computed(() => totalOf(props.account.publish));

const failedTotal = computed(() => props.account.generate.failed + props.account.publish.failed);
const isRunning = computed(() => props.account.generate.active + props.account.publish.active > 0);

const handleToggle = () => {
  emit('toggle', props.account.accountId);
};
</script>

<template>
  <div class="px-4 py-3 transition-colors duration-150 hover:bg-surface-overlay/40">
    <button
      type="button"
      class="flex w-full items-center gap-4 text-left"
      @click="handleToggle"
    >
      <span
        :class="
          cn(
            'w-[164px] shrink-0 truncate text-[13px]',
            isRunning ? 'text-ink' : 'text-ink-muted',
          )
        "
        >{{ props.account.accountId }}</span
      >

      <span class="flex w-[210px] shrink-0 items-baseline gap-3">
        <span class="w-8 text-[11px] text-ink-faint">생성</span>
        <StateBadge state="active" :count="props.account.generate.active" />
        <StateBadge state="waiting" :count="props.account.generate.waiting" />
        <span class="tnum text-[12px] text-ink-faint"
          >{{ props.account.generate.completed }}/{{ generateTotal }}</span
        >
      </span>

      <span class="flex w-[210px] shrink-0 items-baseline gap-3">
        <span class="w-8 text-[11px] text-ink-faint">발행</span>
        <StateBadge state="active" :count="props.account.publish.active" />
        <StateBadge state="waiting" :count="props.account.publish.waiting" />
        <span class="tnum text-[12px] text-ink-faint"
          >{{ props.account.publish.completed }}/{{ publishTotal }}</span
        >
      </span>

      <span class="min-w-0 flex-1">
        <ProgressLine
          :done="props.account.publish.completed"
          :total="Math.max(publishTotal, 1)"
          :failed="props.account.publish.failed"
        />
      </span>

      <StateBadge
        v-if="failedTotal > 0"
        state="failed"
        :count="failedTotal"
        class="shrink-0"
      />
      <span v-else class="w-10 shrink-0" />
    </button>

    <div v-if="props.expanded" class="mt-3 border-t border-line pt-3">
      <slot name="detail" />
    </div>
  </div>
</template>
