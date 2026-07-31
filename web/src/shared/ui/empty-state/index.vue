<script setup lang="ts">
interface Props {
  title: string;
  description?: string;
}

const props = withDefaults(defineProps<Props>(), { description: '' });
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-1.5 px-6 py-14 text-center">
    <p class="text-[13px] text-ink-muted">{{ props.title }}</p>
    <p v-if="props.description" class="max-w-[46ch] text-[12px] leading-relaxed text-ink-faint">
      {{ props.description }}
    </p>
    <div class="mt-3">
      <slot />
    </div>
  </div>
</template>
