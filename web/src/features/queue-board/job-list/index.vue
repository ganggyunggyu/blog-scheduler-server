<script setup lang="ts">
import { ref, toRef } from 'vue';
import { useAccountJobs, useQueueMutations, type JobStatus, type QueueType } from '@/entities/queue';
import { AppButton, EmptyState, SkeletonRows } from '@/shared/ui';
import { formatKstDateTime, formatRelative } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';

interface Props {
  accountId: string;
}

const props = defineProps<Props>();

const TYPE_TABS: Array<{ value: QueueType; label: string }> = [
  { value: 'generate', label: '생성' },
  { value: 'publish', label: '발행' },
];

const STATUS_TABS: Array<{ value: JobStatus; label: string }> = [
  { value: 'waiting', label: '대기' },
  { value: 'active', label: '진행' },
  { value: 'failed', label: '실패' },
  { value: 'completed', label: '완료' },
];

const type = ref<QueueType>('generate');
const status = ref<JobStatus>('waiting');

const { data, isPending, isError } = useAccountJobs({
  accountId: toRef(props, 'accountId'),
  type,
  status,
});

const { retry } = useQueueMutations();

const handleTypeChange = (next: QueueType) => {
  type.value = next;
};

const handleStatusChange = (next: JobStatus) => {
  status.value = next;
};

const handleRetry = (jobId: string) => {
  retry.mutate({ accountId: props.accountId, jobId, type: type.value });
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div class="flex items-center gap-0.5">
        <button
          v-for="tab in TYPE_TABS"
          :key="tab.value"
          type="button"
          :class="
            cn(
              'rounded-[5px] px-2 py-1 text-[12px] transition-colors duration-150',
              type === tab.value
                ? 'bg-surface-overlay text-ink'
                : 'text-ink-faint hover:text-ink-muted',
            )
          "
          @click="handleTypeChange(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>

      <div class="h-3 w-px bg-line" />

      <div class="flex items-center gap-0.5">
        <button
          v-for="tab in STATUS_TABS"
          :key="tab.value"
          type="button"
          :class="
            cn(
              'rounded-[5px] px-2 py-1 text-[12px] transition-colors duration-150',
              status === tab.value
                ? 'bg-surface-overlay text-ink'
                : 'text-ink-faint hover:text-ink-muted',
            )
          "
          @click="handleStatusChange(tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
    </div>

    <SkeletonRows v-if="isPending" :rows="3" />

    <p v-else-if="isError" class="px-1 py-6 text-[12px] text-state-failed">
      작업 목록을 불러오지 못했습니다.
    </p>

    <EmptyState
      v-else-if="!data?.jobs.length"
      title="해당 상태의 작업이 없습니다."
    />

    <ul v-else class="divide-y divide-line rounded-[8px] border border-line bg-surface">
      <li
        v-for="job in data.jobs"
        :key="job.id"
        class="flex items-center gap-4 px-3 py-2.5"
      >
        <span class="tnum w-14 shrink-0 truncate text-[11px] text-ink-faint">{{ job.id }}</span>
        <span class="min-w-0 flex-1 truncate text-[13px] text-ink">
          {{ job.data.keyword ?? '(키워드 없음)' }}
        </span>
        <span class="tnum w-24 shrink-0 text-right text-[11px] text-ink-faint">
          {{ formatKstDateTime(job.data.scheduledAt) }}
        </span>
        <span class="w-16 shrink-0 text-right text-[11px] text-ink-faint">
          {{ formatRelative(job.data.scheduledAt) }}
        </span>
        <AppButton
          v-if="status === 'failed'"
          size="sm"
          variant="outline"
          :loading="retry.isPending.value"
          @click="handleRetry(job.id)"
        >
          재시도
        </AppButton>
      </li>
    </ul>

    <p
      v-if="status === 'failed' && data?.jobs.length"
      class="px-1 text-[11px] leading-relaxed text-ink-faint"
    >
      실패 사유는 Bull Board(/admin/queues)에서 원문을 확인할 수 있습니다.
    </p>
  </div>
</template>
