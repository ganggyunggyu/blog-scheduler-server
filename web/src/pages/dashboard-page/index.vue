<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQueuesDashboard, useQueueMutations } from '@/entities/queue';
import { AccountRow, JobList } from '@/features/queue-board';
import { AppButton, AppPanel, EmptyState, SkeletonRows } from '@/shared/ui';
import { formatKstTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';

const REFRESH_OPTIONS = [
  { value: 5000, label: '5초' },
  { value: 15000, label: '15초' },
  { value: 60000, label: '1분' },
  { value: 0, label: '수동' },
] as const;

const refetchMs = ref<number>(15000);
const expandedAccountId = ref('');
const onlyBusy = ref(true);

const { data, isPending, isError, refetch, isFetching } = useQueuesDashboard(refetchMs);
const { drainEverything } = useQueueMutations();

const accounts = computed(() => data.value?.accounts ?? []);

const busyAccounts = computed(() =>
  accounts.value.filter((account) => {
    const { generate, publish } = account;
    return (
      generate.active + generate.waiting + generate.failed + generate.delayed > 0 ||
      publish.active + publish.waiting + publish.failed + publish.delayed > 0
    );
  }),
);

const visibleAccounts = computed(() => (onlyBusy.value ? busyAccounts.value : accounts.value));

const totals = computed(() => data.value?.totals);

const summaryCells = computed(() => {
  const generate = totals.value?.generate;
  const publish = totals.value?.publish;
  if (!generate || !publish) return [];
  return [
    { label: '진행 중', value: generate.active + publish.active, tone: 'text-state-active' },
    { label: '대기', value: generate.waiting + publish.waiting, tone: 'text-ink' },
    { label: '예약', value: generate.delayed + publish.delayed, tone: 'text-state-delayed' },
    { label: '완료', value: generate.completed + publish.completed, tone: 'text-ink-muted' },
    { label: '실패', value: generate.failed + publish.failed, tone: 'text-state-failed' },
  ];
});

const handleToggleAccount = (accountId: string) => {
  expandedAccountId.value = expandedAccountId.value === accountId ? '' : accountId;
};

const handleRefreshChange = (event: Event) => {
  refetchMs.value = Number((event.target as HTMLSelectElement).value);
};

const handleManualRefresh = () => {
  refetch();
};

const handleToggleFilter = () => {
  onlyBusy.value = !onlyBusy.value;
};

const handleDrainAll = () => {
  const confirmed = window.confirm(
    '모든 계정의 대기 작업을 삭제합니다. 진행 중인 작업은 남습니다. 계속할까요?',
  );
  if (!confirmed) return;
  drainEverything.mutate();
};
</script>

<template>
  <div class="flex flex-col gap-5">
    <section class="flex flex-wrap items-end justify-between gap-4">
      <div class="flex items-end gap-8">
        <div
          v-for="cell in summaryCells"
          :key="cell.label"
          class="flex flex-col gap-1"
        >
          <span class="text-[11px] text-ink-faint">{{ cell.label }}</span>
          <span :class="cn('tnum text-[22px] leading-none', cell.tone)">{{ cell.value }}</span>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <span class="tnum text-[11px] text-ink-faint">
          {{ data ? `갱신 ${formatKstTime(data.timestamp)}` : '' }}
        </span>
        <select
          :value="refetchMs"
          class="h-7 rounded-[6px] border border-line bg-surface-raised px-2 text-[12px] text-ink-muted hover:border-line-strong focus:border-accent focus:outline-none"
          @change="handleRefreshChange"
        >
          <option v-for="option in REFRESH_OPTIONS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <AppButton size="sm" :loading="isFetching" @click="handleManualRefresh">새로고침</AppButton>
      </div>
    </section>

    <AppPanel
      title="계정별 큐"
      :hint="`${visibleAccounts.length}개 표시 / 전체 ${accounts.length}개`"
    >
      <template #actions>
        <AppButton size="sm" variant="ghost" @click="handleToggleFilter">
          {{ onlyBusy ? '전체 보기' : '작업 있는 계정만' }}
        </AppButton>
        <AppButton size="sm" variant="danger" @click="handleDrainAll">전체 큐 비우기</AppButton>
      </template>

      <SkeletonRows v-if="isPending" :rows="5" />

      <p v-else-if="isError" class="px-4 py-10 text-center text-[13px] text-state-failed">
        서버에 연결하지 못했습니다. 스케줄러가 떠 있는지 확인해주세요.
      </p>

      <EmptyState
        v-else-if="!visibleAccounts.length"
        title="표시할 계정이 없습니다."
        :description="
          onlyBusy
            ? '진행 중이거나 대기 중인 작업이 없습니다. 전체 보기로 바꾸면 완료된 계정도 나옵니다.'
            : '등록된 큐가 없습니다. 새 스케줄을 등록하면 여기에 나타납니다.'
        "
      />

      <div v-else class="divide-y divide-line">
        <AccountRow
          v-for="account in visibleAccounts"
          :key="account.accountId"
          :account="account"
          :expanded="expandedAccountId === account.accountId"
          @toggle="handleToggleAccount"
        >
          <template #detail>
            <JobList :account-id="account.accountId" />
          </template>
        </AccountRow>
      </div>
    </AppPanel>
  </div>
</template>
