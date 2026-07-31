export interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface AccountQueueStatus {
  accountId: string;
  maskedAccountId: string;
  generate: QueueCounts;
  publish: QueueCounts;
}

export interface QueuesDashboard {
  timestamp: string;
  accounts: AccountQueueStatus[];
  totals: { generate: QueueCounts; publish: QueueCounts };
}

export type QueueType = 'generate' | 'publish';
export type JobStatus = 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';

export interface QueueJob {
  id: string;
  name: string;
  attemptsMade?: number;
  timestamp?: number;
  processedOn?: number;
  finishedOn?: number;
  failedReason?: string;
  data: {
    keyword?: string;
    scheduledAt?: string;
    mode?: string;
  };
}

export interface QueueJobsResponse {
  accountId: string;
  type: QueueType;
  status: JobStatus;
  count: number;
  jobs: QueueJob[];
}
