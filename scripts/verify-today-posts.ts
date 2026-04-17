import 'dotenv/config';
import mongoose from 'mongoose';

const TARGET_DATE_ARG = process.argv[2];
const TODAY = TARGET_DATE_ARG ? new Date(`${TARGET_DATE_ARG}T00:00:00+09:00`) : new Date();
const TODAY_STR = `${TODAY.getFullYear()}-${String(TODAY.getMonth() + 1).padStart(2, '0')}-${String(TODAY.getDate()).padStart(2, '0')}`;

const THREE_POST_CATEGORIES = ['안과', '에스앤비안과', '에스앤비안과-백업', '알리바바'];
const getExpectedCount = (category: string): number =>
  THREE_POST_CATEGORIES.includes(category) ? 3 : 2;

interface Account {
  accountId: string;
  nickname: string;
  blogId: string;
  category: string;
}

interface VerifyResult {
  account: Account;
  expected: number;
  actual: number;
  titles: string[];
  status: 'OK' | 'UNDER' | 'OVER' | 'RSS_FAIL';
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

const checkViaRss = async (blogId: string): Promise<{ count: number; titles: string[] } | null> => {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml.includes('<item>')) return { count: 0, titles: [] };

    const titles: string[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const pubDate = extractTag(match[1], 'pubDate');
      if (parseRssDate(pubDate) === TODAY_STR) {
        titles.push(extractTag(match[1], 'title'));
      }
    }
    return { count: titles.length, titles };
  } catch {
    return null;
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: { $exists: true, $nin: ['', null] } })
    .toArray();

  const accounts: Account[] = docs.map((d) => ({
    accountId: d.accountId as string,
    nickname: (d.nickname as string) || (d.accountId as string),
    blogId: (d.blogId as string) || (d.accountId as string),
    category: (d.category as string) || '-',
  }));

  const results: VerifyResult[] = [];

  for (const acc of accounts) {
    const expected = getExpectedCount(acc.category);
    const rss = await checkViaRss(acc.blogId);

    if (!rss) {
      results.push({ account: acc, expected, actual: 0, titles: [], status: 'RSS_FAIL' });
      continue;
    }

    const status = rss.count >= expected ? 'OK' : rss.count < expected ? 'UNDER' : 'OVER';
    results.push({ account: acc, expected, actual: rss.count, titles: rss.titles, status });
  }

  const ok = results.filter((r) => r.status === 'OK');
  const problems = results.filter((r) => r.status !== 'OK');

  console.log(`\n=== ${TODAY_STR} 발행글 검증 ===`);
  console.log(`전체 ${results.length}개 계정 | OK: ${ok.length} | 문제: ${problems.length}\n`);

  if (problems.length > 0) {
    console.log('--- 문제 계정 ---');
    for (const r of problems) {
      const tag = r.status === 'UNDER' ? '미달' : r.status === 'RSS_FAIL' ? 'RSS실패' : '초과';
      console.log(`  [${tag}] ${r.account.nickname} (${r.account.blogId}) [${r.account.category}]: ${r.actual}/${r.expected}`);
      if (r.titles.length > 0) {
        for (const t of r.titles) console.log(`         - ${t}`);
      }
    }
  } else {
    console.log('전 계정 정상 발행 완료');
  }

  console.log('');
  await mongoose.disconnect();
  process.exit(problems.length > 0 ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
