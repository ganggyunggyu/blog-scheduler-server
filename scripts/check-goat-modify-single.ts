import 'dotenv/config';
import mongoose from 'mongoose';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: 'modify-goat-single' })
    .sort({ createdAt: -1 })
    .limit(5)
    .toArray();

  for (const s of schedules) {
    const jobs = await mongoose.connection.db!
      .collection('schedulejobs')
      .find({ scheduleId: s._id })
      .toArray();
    console.log(`schedule ${s._id} status=${s.status} acc=${s.accountId}`);
    for (const j of jobs) {
      console.log(`  job status=${j.status} keyword=${j.keyword} logNo=${j.manuscriptId || '-'}`);
      console.log(`    postUrl=${j.postUrl || '-'}`);
      console.log(`    error=${j.error || '-'}`);
      console.log(`    updatedAt=${j.updatedAt?.toISOString?.() || j.updatedAt}`);
    }
  }
  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
