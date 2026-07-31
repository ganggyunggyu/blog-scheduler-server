<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/shared/lib/cn';

export type QueueState = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed' | 'paused';

interface Props {
  state: QueueState | string;
  count?: number;
  label?: string;
}

const props = defineProps<Props>();

/* 큐 상태는 실제 의미가 있는 값이라 색을 쓴다. 장식용 색점은 쓰지 않는다. */
const STATE_META: Record<string, { text: string; class: string }> = {
  waiting: { text: '대기', class: 'text-state-waiting' },
  active: { text: '진행', class: 'text-state-active' },
  completed: { text: '완료', class: 'text-state-done' },
  failed: { text: '실패', class: 'text-state-failed' },
  delayed: { text: '예약', class: 'text-state-delayed' },
  paused: { text: '중지', class: 'text-state-waiting' },
};

const meta = computed(() => STATE_META[props.state] ?? { text: props.state, class: 'text-ink-muted' });
</script>

<template>
  <span class="inline-flex items-baseline gap-1.5">
    <span :class="cn('text-[11px]', meta.class)">{{ props.label ?? meta.text }}</span>
    <span
      v-if="props.count !== undefined"
      :class="cn('tnum text-[12px]', props.count > 0 ? meta.class : 'text-ink-faint')"
      >{{ props.count }}</span
    >
  </span>
</template>
