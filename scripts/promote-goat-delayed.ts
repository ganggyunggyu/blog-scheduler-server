import 'dotenv/config';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

const ACCOUNTS = ['olgdmp9921', 'yenalk', 'eytkgy5500', 'uqgidh2690', '4giccokx', 'umhu0m83', 'dhtksk1p', 'regular14631'];

const main = async () => {
  const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: null });
  let promoted = 0;
  for (const acc of ACCOUNTS) {
    const safe = acc.replace(/[^a-zA-Z0-9]/g, '_');
    const queue = new Queue(`generate_${safe}`, { connection });
    const delayed = await queue.getDelayed();
    for (const job of delayed) {
      await job.promote();
      promoted += 1;
      console.log(`  promoted ${acc} job=${job.id} kw=${(job.data as any).keyword}`);
    }
    await queue.close();
  }
  console.log(`\ntotal promoted: ${promoted}`);
  await connection.quit();
  process.exit(0);
};
main().catch((e) => { console.error(e); process.exit(1); });
