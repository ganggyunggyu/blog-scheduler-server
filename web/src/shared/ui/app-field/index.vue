<script setup lang="ts">
import { cn } from '@/shared/lib/cn';

interface Props {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  hint: '',
  error: '',
  htmlFor: '',
  className: '',
});
</script>

<template>
  <div :class="cn('flex flex-col gap-2', props.className)">
    <label :for="props.htmlFor" class="text-[12px] font-medium text-ink-muted">
      {{ props.label }}
    </label>
    <slot />
    <p v-if="props.hint && !props.error" class="text-[11px] text-ink-faint">{{ props.hint }}</p>
    <p v-if="props.error" class="text-[11px] text-state-failed">{{ props.error }}</p>
  </div>
</template>
