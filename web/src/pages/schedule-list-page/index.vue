<script setup lang="ts">
import { computed, ref } from 'vue';
import { useScheduleList, useScheduleMutations } from '@/entities/schedule';
import { AppButton, AppPanel, EmptyState, SkeletonRows, StateBadge } from '@/shared/ui';
import { formatKstDateTime } from '@/shared/lib/format';
import { INPUT_CLASS } from '@/shared/ui';

const STATUS_FILTERS = [
  { value: '', label: '전체' },
  { value: 'pending', label: '대기' },
  { value: 'running', label: '진행' },
  { value: 'completed', label: '완료' },
  { value: 'cancelled', label: '취소' },
] as const;

const accountId = ref('');
const status = ref('');
const accountInput = ref('');

const { data, isPending, isError } = useScheduleList({ accountId, status });
const { cancel } = useScheduleMutations();

const schedules = computed(() => data.value ?? []);

const handleApplyAccount = () => {
  accountId.value = accountInput.value.trim();
};

const handleStatusChange = (event: Event) => {
  status.value = (event.target as HTMLSelectElement).value;
};

const handleCancel = (id: string) => {
  const confirmed = window.confirm('이 스케줄의 남은 작업을 큐에서 제거합니다. 계속할까요?');
  if (!confirmed) return;
  cancel.mutate(id);
};
</script>

<template>
  <div class="flex flex-col gap-5">
    <AppPanel title="스케줄" :hint="`${schedules.length}건`">
      <template #actions>
        <input
          v-model="accountInput"
          :class="[INPUT_CLASS, 'h-7 w-44 py-0 text-[12px]']"
          type="text"
          placeholder="계정 ID로 필터"
          @keyup.enter="handleApplyAccount"
        />
        <select
          :value="status"
          class="h-7 rounded-[6px] border border-line bg-surface px-2 text-[12px] text-ink-muted hover:border-line-strong focus:border-accent focus:outline-none"
          @change="handleStatusChange"
        >
          <option v-for="item in STATUS_FILTERS" :key="item.value" :value="item.value">
            {{ item.label }}
          </option>
        </select>
      </template>

      <SkeletonRows v-if="isPending" :rows="6" />

      <p v-else-if="isError" class="px-4 py-10 text-center text-[13px] text-state-failed">
        스케줄 목록을 불러오지 못했습니다.
      </p>

      <EmptyState
        v-else-if="!schedules.length"
        title="등록된 스케줄이 없습니다."
        description="새 등록 화면에서 도메인과 계정을 골라 예약을 만들 수 있습니다."
      />

      <table v-else class="w-full text-left">
        <thead>
          <tr class="border-b border-line text-[11px] text-ink-faint">
            <th class="px-4 py-2 font-normal">계정</th>
            <th class="px-4 py-2 font-normal">서비스</th>
            <th class="px-4 py-2 font-normal">모드</th>
            <th class="px-4 py-2 font-normal">키워드</th>
            <th class="px-4 py-2 font-normal">상태</th>
            <th class="px-4 py-2 font-normal">생성</th>
            <th class="px-4 py-2" />
          </tr>
        </thead>
        <tbody class="divide-y divide-line">
          <tr
            v-for="schedule in schedules"
            :key="schedule._id"
            class="transition-colors duration-150 hover:bg-surface-overlay/40"
          >
            <td class="max-w-[180px] truncate px-4 py-2.5 text-[13px] text-ink">
              {{ schedule.accountId }}
            </td>
            <td class="px-4 py-2.5 text-[12px] text-ink-muted">{{ schedule.service ?? '-' }}</td>
            <td class="tnum px-4 py-2.5 text-[12px] text-ink-muted">{{ schedule.mode ?? '-' }}</td>
            <td class="tnum px-4 py-2.5 text-[12px] text-ink-muted">
              {{ schedule.keywords?.length ?? 0 }}
            </td>
            <td class="px-4 py-2.5">
              <StateBadge
                :state="schedule.status === 'running' ? 'active' : schedule.status"
                :label="schedule.status"
              />
            </td>
            <td class="tnum px-4 py-2.5 text-[12px] text-ink-faint">
              {{ formatKstDateTime(schedule.createdAt) }}
            </td>
            <td class="px-4 py-2.5 text-right">
              <AppButton
                v-if="schedule.status !== 'cancelled' && schedule.status !== 'completed'"
                size="sm"
                variant="danger"
                :loading="cancel.isPending.value"
                @click="handleCancel(schedule._id)"
              >
                취소
              </AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </AppPanel>
  </div>
</template>
