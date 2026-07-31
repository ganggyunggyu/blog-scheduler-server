import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  cleanCompleted,
  drainAccount,
  drainAll,
  getAccountJobs,
  getQueuesDashboard,
  retryJob,
} from '../api';
import type { JobStatus, QueueType } from '../model';

export const queueKeys = {
  all: ['queues'] as const,
  dashboard: () => [...queueKeys.all, 'dashboard'] as const,
  jobs: (accountId: string, type: QueueType, status: JobStatus) =>
    [...queueKeys.all, 'jobs', accountId, type, status] as const,
};

/** 큐는 계속 움직여서 폴링이 기본. 탭이 백그라운드면 브라우저가 알아서 늦춘다. */
export const useQueuesDashboard = (refetchMs: Ref<number>) =>
  useQuery({
    queryKey: queueKeys.dashboard(),
    queryFn: getQueuesDashboard,
    refetchInterval: () => (refetchMs.value > 0 ? refetchMs.value : false),
    refetchOnWindowFocus: true,
    staleTime: 2000,
  });

export const useAccountJobs = (params: {
  accountId: Ref<string>;
  type: Ref<QueueType>;
  status: Ref<JobStatus>;
}) => {
  const { accountId, type, status } = params;
  return useQuery({
    queryKey: computed(() => queueKeys.jobs(accountId.value, type.value, status.value)),
    queryFn: () => getAccountJobs({ accountId: accountId.value, type: type.value, status: status.value }),
    enabled: computed(() => Boolean(accountId.value)),
    staleTime: 3000,
  });
};

export const useQueueMutations = () => {
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: queueKeys.all });
  };

  const retry = useMutation({
    mutationFn: retryJob,
    onSuccess: invalidateAll,
  });

  const clean = useMutation({
    mutationFn: cleanCompleted,
    onSuccess: invalidateAll,
  });

  const drainOne = useMutation({
    mutationFn: drainAccount,
    onSuccess: invalidateAll,
  });

  const drainEverything = useMutation({
    mutationFn: drainAll,
    onSuccess: invalidateAll,
  });

  return { retry, clean, drainOne, drainEverything };
};
