import 'dotenv/config';
import mongoose from 'mongoose';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ accountId: 'regular14631', service: { $regex: /^modify-goat-/ } })
    .sort({ createdAt: 1 })
    .toArray();
  const ids = schedules.map((s) => s._id);
  const jobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: ids } })
    .toArray();
  const statusCount: Record<string, number> = {};
  for (const j of jobs) statusCount[j.status as string] = (statusCount[j.status as string] ?? 0) + 1;
  console.log(`소원 total: ${jobs.length}, status:`, JSON.stringify(statusCount));
  // 활성 job 상세
  for (const j of jobs) {
    if (j.status !== 'published') {
      console.log(`  ${j.status} kw=${j.keyword} error=${j.error || '-'} updatedAt=${j.updatedAt}`);
    }
  }
  await mongoose.disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
