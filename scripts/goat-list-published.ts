import 'dotenv/config';
import { writeFileSync } from 'fs';
import mongoose from 'mongoose';

const OUT_PATH = '/tmp/goat-published-list.json';

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const schedules = await mongoose.connection.db!
    .collection('schedules')
    .find({ service: { $regex: /^modify-goat-/ } })
    .toArray();
  const ids = schedules.map((s) => s._id);
  const jobs = await mongoose.connection.db!
    .collection('schedulejobs')
    .find({ scheduleId: { $in: ids }, status: 'published' })
    .toArray();

  const accById = new Map<string, string>();
  for (const s of schedules) accById.set(s._id as string, s.accountId as string);

  // cafe-bot accounts에서 계정 정보 조회
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accs = await cafeDb.collection('accounts').find({ category: { $in: ['흑염소', '한려담원'] } }).toArray();
  const accInfoById = new Map<string, { password: string; blogId: string; nickname: string }>();
  for (const a of accs) {
    accInfoById.set(a.accountId as string, {
      password: a.password as string,
      blogId: (a.blogId as string) || (a.accountId as string),
      nickname: (a.nickname as string) || (a.accountId as string),
    });
  }

  const items = jobs.map((j) => {
    const accountId = accById.get(j.scheduleId as string)!;
    const info = accInfoById.get(accountId);
    const logNoMatch = (j.postUrl as string).match(/\/(\d{10,})/);
    return {
      accountId,
      password: info?.password ?? '',
      blogId: info?.blogId ?? accountId,
      nickname: info?.nickname ?? accountId,
      keyword: j.keyword as string,
      logNo: logNoMatch ? logNoMatch[1] : '',
      postUrl: j.postUrl as string,
    };
  });

  // 계정별 정렬, 같은 keyword 중복 제거 (마지막 결과만 유지)
  const dedupe = new Map<string, typeof items[0]>();
  for (const it of items) {
    dedupe.set(`${it.accountId}|${it.keyword}`, it);
  }
  const final = [...dedupe.values()];

  writeFileSync(OUT_PATH, JSON.stringify(final, null, 2));
  console.log(`published jobs: ${jobs.length} (dedupe → ${final.length})`);
  console.log(`저장: ${OUT_PATH}\n`);

  const byAcc: Record<string, number> = {};
  for (const it of final) {
    byAcc[it.nickname] = (byAcc[it.nickname] ?? 0) + 1;
  }
  for (const [nick, n] of Object.entries(byAcc)) {
    console.log(`  ${nick}: ${n}개`);
  }

  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
