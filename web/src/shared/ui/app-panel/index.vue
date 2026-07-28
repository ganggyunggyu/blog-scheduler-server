<script setup lang="ts">
import { cn } from '@/shared/lib/cn';

interface Props {
  title?: string;
  hint?: string;
  className?: string;
  bodyClassName?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  hint: '',
  className: '',
  bodyClassName: '',
});
</script>

<template>
  <section
    :class="
      cn(
        'rounded-[10px] border border-line bg-surface-raised overflow-hidden',
        props.className,
      )
    "
  >
    <header
      v-if="props.title || $slots.actions"
      class="flex h-11 items-center justify-between gap-3 border-b border-line px-4"
    >
      <div class="flex min-w-0 items-baseline gap-2.5">
        <h2 class="truncate text-[13px] font-medium text-ink">{{ props.title }}</h2>
        <p v-if="props.hint" class="truncate text-[11px] text-ink-faint">{{ props.hint }}</p>
      </div>
      <div class="flex shrink-0 items-center gap-1.5">
        <slot name="actions" />
      </div>
    </header>

    <div :class="cn(props.bodyClassName)">
      <slot />
    </div>
  </section>
</template>
