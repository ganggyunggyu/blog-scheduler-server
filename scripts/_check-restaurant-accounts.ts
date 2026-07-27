import 'dotenv/config';
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
import { findAccountById } from '../src/services/account-directory.service.js';

const IDS = process.argv.slice(2);

const main = async (): Promise<void> => {
  await mongoose.connect(env.MONGO_URI);

  for (const id of IDS) {
    const account = await findAccountById(id);
    if (!account) {
      console.log(`${id}\tNOT_FOUND`);
      continue;
    }
    console.log(
      `${id}\tfound\tnickname=${account.name}\tblogId=${account.blogId ?? '-'}\tcategory=${account.category ?? '-'}\thasPw=${account.password ? 'Y' : 'N'}`,
    );
  }

  await mongoose.disconnect();
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
