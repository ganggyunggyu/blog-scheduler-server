import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleModel, ScheduleJobModel } from '../src/schemas/schedule.schema';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const today = '2026-04-30';

  const todaySchedules = await ScheduleModel.find({ scheduleDate: today }).lean();
  console.log(`\n=== 오늘(${today}) 스케쥴: ${todaySchedules.length}개 ===`);

  const summary = todaySchedules.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});
  console.log('스케쥴 상태 분포:', summary);

  const totalJobs = todaySchedules.reduce((a, s) => a + (s.totalJobs || 0), 0);
  const completedJobs = todaySchedules.reduce((a, s) => a + (s.completedJobs || 0), 0);
  const failedJobs = todaySchedules.reduce((a, s) => a + (s.failedJobs || 0), 0);
  console.log(
    `잡 합계: total=${totalJobs}, completed=${completedJobs}, failed=${failedJobs}, left=${totalJobs - completedJobs - failedJobs}`
  );

  console.log('\n=== 계정/서비스별 ===');
  const sorted = [...todaySchedules].sort((a, b) =>
    (a.service || '').localeCompare(b.service || '') || (a.accountId || '').localeCompare(b.accountId || '')
  );
  for (const s of sorted) {
    const left = (s.totalJobs || 0) - (s.completedJobs || 0) - (s.failedJobs || 0);
    console.log(
      `[${s.status}] ${s.service} | ${s.accountId} - total ${s.totalJobs} / done ${s.completedJobs} / fail ${s.failedJobs} / left ${left}`
    );
  }

  const todayJobsAgg = await ScheduleJobModel.aggregate([
    { $match: { scheduledAt: { $regex: `^${today}` } } },
    { $group: { _id: { status: '$status', category: '$category' }, count: { $sum: 1 } } },
    { $sort: { '_id.category': 1, '_id.status': 1 } },
  ]);
  console.log('\n=== 오늘 잡 상태 분포 (카테고리별) ===');
  for (const row of todayJobsAgg) {
    console.log(`- ${row._id.category} / ${row._id.status} : ${row.count}`);
  }

  const failedJobsList = await ScheduleJobModel.find({
    scheduledAt: { $regex: `^${today}` },
    status: 'failed',
  })
    .lean()
    .limit(20);
  if (failedJobsList.length) {
    console.log('\n=== 실패 잡 (최대 20) ===');
    for (const j of failedJobsList) {
      console.log(`- ${j.scheduledAt} | ${j.category} | ${j.keyword} | err=${(j.error || '').slice(0, 120)}`);
    }
  }

  const pendingJobsList = await ScheduleJobModel.find({
    scheduledAt: { $regex: `^${today}` },
    status: { $in: ['pending', 'generating', 'generated', 'publishing'] },
  })
    .lean()
    .sort({ scheduledAt: 1 })
    .limit(40);
  if (pendingJobsList.length) {
    console.log(`\n=== 미완료 잡 (${pendingJobsList.length}개 표시) ===`);
    for (const j of pendingJobsList) {
      console.log(`- [${j.status}] ${j.scheduledAt} | ${j.category} | ${j.keyword}`);
    }
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
