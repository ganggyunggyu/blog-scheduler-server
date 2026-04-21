import 'dotenv/config';
import mongoose from 'mongoose';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: 'modify-goat-retitle' })
    .toArray();
  const ids = schedules.map((s) => s._id);
  const jobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: ids } })
    .toArray();
  const statusCount: Record<string, number> = {};
  for (const j of jobs) statusCount[j.status as string] = (statusCount[j.status as string] ?? 0) + 1;
  console.log(`retitle total: ${jobs.length}, status:`, JSON.stringify(statusCount));
  await mongoose.disconnect();
};
main().catch((e) => { console.error(e); process.exit(1); });
