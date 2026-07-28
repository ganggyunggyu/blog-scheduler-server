<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/shared/lib/cn';

interface Props {
  done: number;
  total: number;
  failed?: number;
}

const props = withDefaults(defineProps<Props>(), { failed: 0 });

const donePercent = computed(() => (props.total > 0 ? (props.done / props.total) * 100 : 0));
const failedPercent = computed(() => (props.total > 0 ? (props.failed / props.total) * 100 : 0));
</script>

<template>
  <div class="flex h-[3px] w-full overflow-hidden rounded-full bg-line">
    <div
      :class="cn('h-full bg-accent transition-[width] duration-500 ease-out')"
      :style="{ width: `${donePercent}%` }"
    />
    <div
      v-if="props.failed > 0"
      class="h-full bg-state-failed transition-[width] duration-500 ease-out"
      :style="{ width: `${failedPercent}%` }"
    />
  </div>
</template>
