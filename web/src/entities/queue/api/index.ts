import { axiosInstance } from '@/app/config/axios';
import type { JobStatus, QueueJobsResponse, QueueType, QueuesDashboard } from '../model';

export const getQueuesDashboard = async (): Promise<QueuesDashboard> => {
  const { data } = await axiosInstance.get<QueuesDashboard>('/api/queues/dashboard');
  return data;
};

export const getAccountJobs = async (params: {
  accountId: string;
  type: QueueType;
  status: JobStatus;
  limit?: number;
}): Promise<QueueJobsResponse> => {
  const { accountId, type, status, limit = 20 } = params;
  const { data } = await axiosInstance.get<QueueJobsResponse>(
    `/api/queues/${encodeURIComponent(accountId)}/jobs`,
    { params: { type, status, limit } },
  );
  return data;
};

export const retryJob = async (params: {
  accountId: string;
  jobId: string;
  type: QueueType;
}): Promise<void> => {
  const { accountId, jobId, type } = params;
  await axiosInstance.post(`/api/queues/${encodeURIComponent(accountId)}/retry`, { jobId, type });
};

export const cleanCompleted = async (params: {
  accountId: string;
  type: QueueType;
  grace?: number;
}): Promise<{ removed: number }> => {
  const { accountId, type, grace = 0 } = params;
  const { data } = await axiosInstance.post(
    `/api/queues/${encodeURIComponent(accountId)}/clean`,
    { type, grace },
  );
  return data;
};

export const drainAccount = async (accountId: string): Promise<void> => {
  await axiosInstance.post(`/api/queues/${encodeURIComponent(accountId)}/drain`);
};

export const drainAll = async (): Promise<void> => {
  await axiosInstance.post('/api/queues/drain-all');
};
