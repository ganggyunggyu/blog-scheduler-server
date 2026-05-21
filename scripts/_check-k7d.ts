import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleJobModel, ScheduleModel } from '../src/schemas/schedule.schema.js';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await ScheduleModel.find({
    accountId: 'k7d9x2m4',
    service: 'pet-modify-redo',
  }).sort({ createdAt: -1 }).limit(5).lean();
  for (const s of schedules) {
    const jobs = await ScheduleJobModel.find({ scheduleId: s._id }).lean();
    console.log(`schedule=${s._id} ref=${s.ref} status=${s.status}`);
    for (const j of jobs) {
      console.log(`  job kw=${(j as any).keyword} status=${(j as any).status} postUrl=${(j as any).postUrl ?? '-'} err=${(j as any).error ?? '-'}`);
    }
  }
  await mongoose.disconnect();
};
main().catch(console.error);
