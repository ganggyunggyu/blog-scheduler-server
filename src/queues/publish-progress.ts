export type ScheduleJobStatus =
  | 'pending'
  | 'generating'
  | 'generated'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'cancelled';

export interface ScheduleProgressSummary {
  completedJobs: number;
  failedJobs: number;
  status: 'processing' | 'completed' | 'failed';
}

export const summarizeScheduleProgress = (
  jobStatuses: ScheduleJobStatus[],
  totalJobs: number,
): ScheduleProgressSummary => {
  const completedJobs = jobStatuses.filter((status) => status === 'published').length;
  const failedJobs = jobStatuses.filter((status) => status === 'failed').length;
  const doneJobs = completedJobs + failedJobs;

  if (doneJobs >= totalJobs) {
    return {
      completedJobs,
      failedJobs,
      status: failedJobs > 0 ? 'failed' : 'completed',
    };
  }

  return {
    completedJobs,
    failedJobs,
    status: 'processing',
  };
};
