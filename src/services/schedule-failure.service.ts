import { ScheduleJobModel, ScheduleModel } from '../schemas/schedule.schema';

interface FailAccountSchedulesResult {
  scheduleIds: string[];
  updatedJobs: number;
}

export const failAccountSchedules = async (
  accountId: string,
  reason: string
): Promise<FailAccountSchedulesResult> => {
  const schedules = await ScheduleModel.find(
    { accountId, status: { $in: ['pending', 'processing'] } },
    { _id: 1 }
  );

  if (schedules.length === 0) {
    return { scheduleIds: [], updatedJobs: 0 };
  }

  const scheduleIds = schedules.map((schedule) => String(schedule._id));
  const now = new Date();

  const updateResult = await ScheduleJobModel.updateMany(
    { scheduleId: { $in: scheduleIds }, status: { $nin: ['published', 'failed', 'cancelled'] } },
    { status: 'failed', error: reason, completedAt: now }
  );

  const counts = await ScheduleJobModel.aggregate<{
    _id: { scheduleId: string; status: string };
    count: number;
  }>([
    { $match: { scheduleId: { $in: scheduleIds } } },
    { $group: { _id: { scheduleId: '$scheduleId', status: '$status' }, count: { $sum: 1 } } },
  ]);

  const summary = new Map<string, { completed: number; failed: number }>();
  for (const scheduleId of scheduleIds) {
    summary.set(scheduleId, { completed: 0, failed: 0 });
  }

  for (const entry of counts) {
    const scheduleId = String(entry._id.scheduleId);
    const status = entry._id.status;
    const record = summary.get(scheduleId);
    if (!record) continue;

    if (status === 'published') {
      record.completed = entry.count;
    } else if (status === 'failed') {
      record.failed = entry.count;
    }
  }

  await Promise.all(
    Array.from(summary.entries()).map(([scheduleId, stats]) =>
      ScheduleModel.findOneAndUpdate(
        { _id: scheduleId, status: { $ne: 'cancelled' } },
        {
          status: 'failed',
          completedJobs: stats.completed,
          failedJobs: stats.failed,
        }
      )
    )
  );

  return {
    scheduleIds,
    updatedJobs: updateResult.modifiedCount ?? 0,
  };
};
