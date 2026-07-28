<script setup lang="ts">
interface Props {
  rows?: number;
}

const props = withDefaults(defineProps<Props>(), { rows: 4 });
</script>

<template>
  <div class="divide-y divide-line">
    <div
      v-for="row in props.rows"
      :key="row"
      class="flex items-center gap-4 px-4 py-3"
    >
      <div class="h-3 w-32 animate-pulse rounded bg-line" />
      <div class="h-3 flex-1 animate-pulse rounded bg-line opacity-60" />
      <div class="h-3 w-16 animate-pulse rounded bg-line opacity-40" />
    </div>
  </div>
</template>
