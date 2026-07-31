<script setup lang="ts">
import { computed } from 'vue';
import { cn } from '@/shared/lib/cn';

interface Props {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md';
  type?: 'button' | 'submit';
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

const props = withDefaults(defineProps<Props>(), {
  variant: 'outline',
  size: 'md',
  type: 'button',
  disabled: false,
  loading: false,
  className: '',
});

const VARIANT_CLASS = {
  primary: 'bg-accent text-[#06120d] hover:bg-[#4ade9f] border border-transparent font-medium',
  outline: 'bg-surface-raised text-ink border border-line hover:border-line-strong hover:bg-surface-overlay',
  ghost: 'bg-transparent text-ink-muted border border-transparent hover:text-ink hover:bg-surface-raised',
  danger: 'bg-transparent text-state-failed border border-[#4a2630] hover:bg-[#2a151b]',
} as const;

const SIZE_CLASS = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-9 px-3.5 text-[13px] gap-2',
} as const;

const isBlocked = computed(() => props.disabled || props.loading);
</script>

<template>
  <button
    :type="props.type"
    :disabled="isBlocked"
    :class="
      cn(
        'inline-flex items-center justify-center rounded-[6px] whitespace-nowrap',
        'transition-colors duration-150',
        'active:translate-y-[1px]',
        'disabled:opacity-45 disabled:pointer-events-none',
        VARIANT_CLASS[props.variant],
        SIZE_CLASS[props.size],
        props.className,
      )
    "
  >
    <span
      v-if="props.loading"
      class="size-3 shrink-0 rounded-full border-[1.5px] border-current border-r-transparent animate-spin"
    />
    <slot />
  </button>
</template>
