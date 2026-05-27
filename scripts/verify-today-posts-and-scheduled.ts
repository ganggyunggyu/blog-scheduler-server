import 'dotenv/config';
import mongoose from 'mongoose';
import { ScheduleModel, ScheduleJobModel } from '../src/schemas/schedule.schema.js';

const TARGET_DATE_ARG = process.argv[2];
const TODAY = TARGET_DATE_ARG ? new Date(`${TARGET_DATE_ARG}T00:00:00+09:00`) : new Date();
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;
const THREE_POST_CATEGORIES = ['안과', '에스앤비안과', '에스앤비안과-백업', '알리바바'];
const getExpectedCount = (category: string): number => THREE_POST_CATEGORIES.includes(category) ? 3 : 2;

interface Account { accountId: string; nickname: string; blogId: string; category: string; }
interface VerifyResult {
  account: Account;
  expected: number;
  published: number;
  scheduled: number;
  planned: number;
  status: 'OK' | 'UNDER' | 'OVER' | 'ERROR';
  error?: string;
}

const parseRssDate = (pubDate: string): string => {
  const d = new Date(pubDate);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const extractTag = (xml: string, tag: string): string => {
  const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plainMatch ? plainMatch[1].trim() : '';
};

const checkViaRss = async (blogId: string): Promise<number> => {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return 0;
    const xml = await res.text();
    if (!xml.includes('<item>')) return 0;
    let count = 0;
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const pubDate = extractTag(match[1], 'pubDate');
      if (parseRssDate(pubDate) === TODAY_STR) count += 1;
    }
    return count;
  } catch {
    return 0;
  }
};

const countRemainingScheduled = async (accountId: string): Promise<number> => {
  const scheduleIds = (
    await ScheduleModel.find({ accountId }).select('_id').lean()
  ).map((s) => s._id);

  if (scheduleIds.length === 0) return 0;

  return ScheduleJobModel.countDocuments({
    scheduleId: { $in: scheduleIds },
    scheduledAt: { $regex: `^${TODAY_STR}` },
    status: { $in: ['pending', 'generating', 'generated', 'publishing'] },
  });
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accountCol = cafeDb.collection('accounts');
  const docs = await accountCol
    .find({ isActive: { $ne: false }, category: { $exists: true, $nin: ['', null] } })
    .toArray();

  const accounts: Account[] = docs.map((d) => ({
    accountId: d.accountId as string,
    nickname: (d.nickname as string) || (d.accountId as string),
    blogId: (d.blogId as string) || (d.accountId as string),
    category: (d.category as string) || '-',
  }));

  const results: VerifyResult[] = [];
  console.log(`\n=== ${TODAY_STR} 발행 예정 검증 ===`);
  console.log(`대상: ${accounts.length}개 계정\n`);

  for (const acc of accounts) {
    const expected = getExpectedCount(acc.category);
    try {
      const [published, scheduled] = await Promise.all([
        checkViaRss(acc.blogId),
        countRemainingScheduled(acc.accountId),
      ]);
      const planned = published + scheduled;
      const status = planned >= expected ? 'OK' : planned < expected ? 'UNDER' : 'OVER';
      results.push({ account: acc, expected, published, scheduled, planned, status });
      const icon = status === 'OK' ? '✓' : '✗';
      console.log(`  [${icon}] ${acc.nickname} [${acc.category}]: 발행 ${published} + 잔여예약 ${scheduled} = ${planned}/${expected}`);
    } catch (err) {
      results.push({
        account: acc, expected, published: 0, scheduled: 0, planned: 0, status: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      console.log(`  [!] ${acc.nickname} [${acc.category}]: ERROR - ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const ok = results.filter((r) => r.status === 'OK').length;
  const problems = results.filter((r) => r.status !== 'OK');

  console.log(`\n${'='.repeat(60)}`);
  console.log(`결과: OK=${ok} / 문제=${problems.length} / 전체=${results.length}`);

  if (problems.length > 0) {
    console.log('\n문제 계정:');
    for (const r of problems) {
      console.log(`  ${r.account.nickname} (${r.account.blogId}) [${r.account.category}]: 발행 ${r.published} + 잔여예약 ${r.scheduled} = ${r.planned}/${r.expected} ${r.error || ''}`);
    }
  } else {
    console.log('\n전 계정 정상');
  }
  console.log('='.repeat(60));

  await mongoose.disconnect();
  process.exit(problems.length > 0 ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
