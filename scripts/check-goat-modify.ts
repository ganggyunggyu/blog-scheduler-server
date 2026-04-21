import 'dotenv/config';
import mongoose from 'mongoose';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);

  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: 'modify-test' })
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  console.log(`schedules: ${schedules.length}\n`);

  const ids = schedules.map((s) => s._id);
  const jobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: ids } })
    .toArray();

  const byId = new Map<string, any>();
  for (const s of schedules) byId.set(s._id as string, s);

  console.log('status     | account        | keyword            | postUrl / error');
  console.log('-'.repeat(120));
  for (const j of jobs) {
    const s = byId.get(j.scheduleId as string);
    const acc = (s?.accountId as string) || '?';
    const st = (j.status as string).padEnd(10);
    const last = j.postUrl ? `✅ ${j.postUrl}` : `❌ ${j.error ?? '(대기)'}`;
    console.log(`${st} | ${acc.padEnd(14)} | ${(j.keyword as string).padEnd(18)} | ${last}`);
  }

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
