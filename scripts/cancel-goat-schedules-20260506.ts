import mongoose from 'mongoose';
import 'dotenv/config';
import axios from 'axios';

const TARGET_ACCOUNTS = ['q9v3m7a2', 'eghfsa5478', 'pixelninja3'];
const TARGET_SCHEDULE_DATE = '2026-05-06';
const SERVER = 'http://localhost:8001';

const main = async () => {
  const uri = process.env.MONGO_URI as string;
  await mongoose.connect(uri);
  const db = mongoose.connection.getClient().db('scheduler');

  const schedules = await db
    .collection('schedules')
    .find({
      accountId: { $in: TARGET_ACCOUNTS },
      scheduleDate: TARGET_SCHEDULE_DATE,
      status: { $in: ['pending', 'processing'] },
    })
    .sort({ createdAt: -1 })
    .toArray();

  console.log(`발견된 스케쥴: ${schedules.length}개`);
  for (const s of schedules) {
    console.log(`- ${s._id} | ${s.accountId} | totalJobs=${s.totalJobs} | created=${s.createdAt}`);
  }

  for (const s of schedules) {
    const id = String(s._id);
    try {
      const res = await axios.delete(`${SERVER}/schedules/${id}`, {
        validateStatus: () => true,
      });
      console.log(`[CANCEL] ${id} → status=${res.status} body=${JSON.stringify(res.data)}`);
    } catch (e) {
      console.error(`[CANCEL FAIL] ${id}`, e);
    }
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
