import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleModel, ScheduleJobModel } from '../src/schemas/schedule.schema';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const today = process.argv[2] || '2026-04-30';

  const unfinished = await ScheduleJobModel.find({
    scheduledAt: { $regex: `^${today}` },
    status: { $in: ['pending', 'generating', 'generated', 'publishing', 'cancelled', 'failed'] },
  })
    .lean()
    .sort({ status: 1, scheduledAt: 1 });

  const schIds = [...new Set(unfinished.map((j) => j.scheduleId))];
  const schs = await ScheduleModel.find({ _id: { $in: schIds } }).lean();
  const schMap = new Map(schs.map((s) => [s._id, s]));

  const grouped: Record<string, typeof unfinished> = {};
  for (const j of unfinished) {
    grouped[j.status] = grouped[j.status] || [];
    grouped[j.status].push(j);
  }

  for (const status of Object.keys(grouped)) {
    console.log(`\n=== [${status}] ${grouped[status].length}건 ===`);
    for (const j of grouped[status]) {
      const sch = schMap.get(j.scheduleId);
      const acc = sch?.accountId || '?';
      const svc = sch?.service || '?';
      console.log(`- ${j.scheduledAt} | ${svc} | ${acc} | ${j.keyword}${j.error ? ` | err=${j.error.slice(0, 80)}` : ''}`);
    }
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
