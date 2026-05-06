import mongoose from 'mongoose';
import 'dotenv/config';

const TARGETS = ['q9v3m7a2', 'eghfsa5478', 'pixelninja3'];

const main = async () => {
  const uri = process.env.MONGO_URI as string;
  await mongoose.connect(uri);
  const db = mongoose.connection.getClient().db('cafe-bot');
  const docs = await db
    .collection('accounts')
    .find(
      { accountId: { $in: TARGETS } },
      {
        projection: {
          _id: 0,
          accountId: 1,
          nickname: 1,
          password: 1,
          isActive: 1,
          category: 1,
        },
      },
    )
    .toArray();
  console.log(JSON.stringify(docs, null, 2));
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
