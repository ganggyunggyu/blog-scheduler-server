import 'dotenv/config';
import mongoose from 'mongoose';

const extractTag = (xml: string, tag: string): string => {
  const cdataMatch = xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`));
  if (cdataMatch) return cdataMatch[1].trim();
  const plainMatch = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return plainMatch ? plainMatch[1].trim() : '';
};

const fetchRss = async (blogId: string) => {
  try {
    const res = await fetch(`https://rss.blog.naver.com/${blogId}.xml`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    const items: { title: string; link: string; pubDate: string }[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      items.push({
        title: extractTag(match[1], 'title'),
        link: extractTag(match[1], 'link'),
        pubDate: extractTag(match[1], 'pubDate'),
      });
    }
    return items;
  } catch { return null; }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  console.log(`\n=== 흑염소 계정 RSS 발행글 수 ===`);
  console.log(`대상 계정: ${docs.length}개\n`);

  let total = 0;
  for (const d of docs) {
    const blogId = (d.blogId as string) || (d.accountId as string);
    const nickname = (d.nickname as string) || (d.accountId as string);
    const items = await fetchRss(blogId);
    if (!items) {
      console.log(`  [RSS실패] ${nickname} (${blogId})`);
      continue;
    }
    total += items.length;
    const dates = items
      .map((i) => new Date(i.pubDate))
      .filter((d) => !isNaN(d.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const oldest = dates.length ? fmt(dates[0]) : '-';
    const newest = dates.length ? fmt(dates[dates.length - 1]) : '-';
    console.log(`  ${nickname.padEnd(16)} (${blogId.padEnd(14)})  ${String(items.length).padStart(3)}개  ${oldest} ~ ${newest}`);
  }
  console.log(`\n총 ${total}개 글 (RSS 최대 50개/블로그)`);
  await mongoose.disconnect();
};

main().catch((e) => { console.error(e); process.exit(1); });
