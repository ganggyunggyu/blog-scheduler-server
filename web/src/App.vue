<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { useAuthStore } from '@/entities/auth';
import { AppShell } from '@/widgets';

const route = useRoute();
const authStore = useAuthStore();

const isBareRoute = computed(() => Boolean(route.meta.public));

onMounted(() => {
  authStore.loadMe();
});
</script>

<template>
  <RouterView v-if="isBareRoute" />
  <AppShell v-else>
    <RouterView />
  </AppShell>
</template>
