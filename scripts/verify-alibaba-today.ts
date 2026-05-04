import 'dotenv/config';
import mongoose from 'mongoose';

const START_DATE_STR = process.argv[2] || '2026-05-01';
const END_DATE_STR = process.argv[3] || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();

const dateInRange = (dateStr: string): boolean => {
  return dateStr >= START_DATE_STR && dateStr <= END_DATE_STR;
};

const enumerateDates = (): string[] => {
  const result: string[] = [];
  const start = new Date(`${START_DATE_STR}T00:00:00+09:00`);
  const end = new Date(`${END_DATE_STR}T00:00:00+09:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    result.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return result;
};

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

interface PostByDate {
  date: string;
  title: string;
}

const checkViaRss = async (blogId: string): Promise<{ byDate: Record<string, string[]>; total: number } | null> => {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const byDate: Record<string, string[]> = {};
    if (!xml.includes('<item>')) return { byDate, total: 0 };
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let total = 0;
    while ((match = itemRegex.exec(xml)) !== null) {
      const pubDate = extractTag(match[1], 'pubDate');
      const dateStr = parseRssDate(pubDate);
      if (dateInRange(dateStr)) {
        if (!byDate[dateStr]) byDate[dateStr] = [];
        byDate[dateStr].push(extractTag(match[1], 'title'));
        total++;
      }
    }
    return { byDate, total };
  } catch {
    return null;
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: '알리바바' })
    .toArray();

  const dates = enumerateDates();
  const expectedPerDay = 3;
  const expectedTotal = expectedPerDay * dates.length;

  console.log(`\n=== ${START_DATE_STR} ~ ${END_DATE_STR} 알리바바 발행글 검증 ===`);
  console.log(`기간: ${dates.length}일 | 일일 기대: ${expectedPerDay}개 | 총 기대: ${expectedTotal}개`);
  console.log(`알리바바 active 계정: ${docs.length}개\n`);

  let totalOkDays = 0;
  let totalShortDays = 0;
  const accountReports: { nickname: string; blogId: string; total: number; problemDates: string[] }[] = [];

  for (const d of docs) {
    const blogId = (d.blogId as string) || (d.accountId as string);
    const nickname = (d.nickname as string) || (d.accountId as string);
    const rss = await checkViaRss(blogId);

    if (!rss) {
      console.log(`[RSS실패] ${nickname} (${blogId})`);
      accountReports.push({ nickname, blogId, total: 0, problemDates: dates });
      continue;
    }

    const problemDates: string[] = [];
    const lines: string[] = [];
    for (const date of dates) {
      const titles = rss.byDate[date] || [];
      if (titles.length >= expectedPerDay) {
        totalOkDays++;
        lines.push(`    ✓ ${date}: ${titles.length}/${expectedPerDay}`);
      } else {
        totalShortDays++;
        problemDates.push(date);
        lines.push(`    ✗ ${date}: ${titles.length}/${expectedPerDay}`);
      }
      for (const t of titles) lines.push(`        - ${t}`);
    }
    const status = problemDates.length === 0 ? 'OK' : 'PROBLEM';
    console.log(`[${status}] ${nickname} (${blogId}) — 총 ${rss.total}/${expectedTotal}`);
    for (const line of lines) console.log(line);
    accountReports.push({ nickname, blogId, total: rss.total, problemDates });
  }

  console.log(`\n--- 요약 ---`);
  console.log(`전체 계정: ${docs.length}`);
  console.log(`정상 일자수 합계: ${totalOkDays} / 미달 일자수 합계: ${totalShortDays}`);
  const problemAccounts = accountReports.filter((r) => r.problemDates.length > 0);
  console.log(`문제 계정: ${problemAccounts.length}개`);
  if (problemAccounts.length > 0) {
    for (const r of problemAccounts) {
      console.log(`  - ${r.nickname} (${r.blogId}): 미달일자 ${r.problemDates.join(', ')}`);
    }
  }

  await mongoose.disconnect();
  process.exit(problemAccounts.length > 0 ? 1 : 0);
};

main().catch((e) => { console.error(e); process.exit(1); });
