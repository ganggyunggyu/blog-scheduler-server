import { axiosInstance } from '@/app/config/axios';
import type { AutoSchedulePayload, Schedule, ScheduleJob } from '../model';

export const getScheduleList = async (params?: {
  accountId?: string;
  status?: string;
}): Promise<Schedule[]> => {
  const { data } = await axiosInstance.get<{ schedules: Schedule[] }>('/schedules', { params });
  return data.schedules;
};

export const getScheduleDetail = async (
  id: string,
): Promise<{ schedule: Schedule; jobs: ScheduleJob[] }> => {
  const { data } = await axiosInstance.get(`/schedules/${id}`);
  return data;
};

export const cancelSchedule = async (id: string): Promise<void> => {
  await axiosInstance.delete(`/schedules/${id}`);
};

export const createAutoSchedule = async (payload: AutoSchedulePayload) => {
  const { data } = await axiosInstance.post('/bot/auto-schedule', payload);
  return data;
};

export const testLogin = async (account: { id: string; password: string }) => {
  const { data } = await axiosInstance.post('/bot/login-test', { account });
  return data;
};
