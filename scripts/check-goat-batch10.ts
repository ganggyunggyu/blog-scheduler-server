import 'dotenv/config';
import mongoose from 'mongoose';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: 'modify-goat-batch10' })
    .sort({ createdAt: 1 })
    .toArray();

  const ids = schedules.map((s) => s._id);
  const jobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: ids } })
    .toArray();

  const byId = new Map<string, any>();
  for (const s of schedules) byId.set(s._id as string, s);

  const statusCount: Record<string, number> = {};
  for (const j of jobs) {
    statusCount[j.status as string] = (statusCount[j.status as string] ?? 0) + 1;
  }

  console.log(`total jobs: ${jobs.length}`);
  console.log(`status: ${JSON.stringify(statusCount)}\n`);

  for (const j of jobs) {
    const s = byId.get(j.scheduleId as string);
    const acc = (s?.accountId as string) || '?';
    const st = (j.status as string).padEnd(11);
    const url = j.postUrl ? `✅ ${j.postUrl}` : (j.status === 'failed' ? `❌ ${j.error}` : '...');
    console.log(`${st} | ${acc.padEnd(14)} | ${(j.keyword as string).padEnd(16)} | ${url}`);
  }

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
