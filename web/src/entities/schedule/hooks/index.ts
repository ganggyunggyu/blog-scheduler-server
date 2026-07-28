import { computed, type Ref } from 'vue';
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query';
import {
  cancelSchedule,
  createAutoSchedule,
  getScheduleDetail,
  getScheduleList,
  testLogin,
} from '../api';

export const scheduleKeys = {
  all: ['schedules'] as const,
  list: (accountId: string, status: string) => [...scheduleKeys.all, 'list', accountId, status] as const,
  detail: (id: string) => [...scheduleKeys.all, 'detail', id] as const,
};

export const useScheduleList = (filters: { accountId: Ref<string>; status: Ref<string> }) => {
  const { accountId, status } = filters;
  return useQuery({
    queryKey: computed(() => scheduleKeys.list(accountId.value, status.value)),
    queryFn: () =>
      getScheduleList({
        accountId: accountId.value || undefined,
        status: status.value || undefined,
      }),
    staleTime: 5000,
  });
};

export const useScheduleDetail = (id: Ref<string>) =>
  useQuery({
    queryKey: computed(() => scheduleKeys.detail(id.value)),
    queryFn: () => getScheduleDetail(id.value),
    enabled: computed(() => Boolean(id.value)),
  });

export const useScheduleMutations = () => {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: scheduleKeys.all });
    queryClient.invalidateQueries({ queryKey: ['queues'] });
  };

  const create = useMutation({ mutationFn: createAutoSchedule, onSuccess: invalidate });
  const cancel = useMutation({ mutationFn: cancelSchedule, onSuccess: invalidate });
  const checkLogin = useMutation({ mutationFn: testLogin });

  return { create, cancel, checkLogin };
};
