import mongoose from 'mongoose';
import 'dotenv/config';
import axios from 'axios';

const TARGETS = ['q9v3m7a2', 'eghfsa5478', 'pixelninja3'];

const today = new Date();
const yyyy = today.getFullYear();
const mm = String(today.getMonth() + 1).padStart(2, '0');
const dd = String(today.getDate()).padStart(2, '0');
const TODAY_KEY = `${yyyy}-${mm}-${dd}`;

const fetchRss = async (blogId: string): Promise<string> => {
  const url = `https://rss.blog.naver.com/${blogId}.xml`;
  const res = await axios.get(url, {
    timeout: 10000,
    validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  return typeof res.data === 'string' ? res.data : String(res.data);
};

const isToday = (pubDate: string): boolean => {
  try {
    const d = new Date(pubDate);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return k === TODAY_KEY;
  } catch {
    return false;
  }
};

const extractTodayItems = (xml: string): { title: string; pubDate: string }[] => {
  const items: { title: string; pubDate: string }[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  const titleRegex = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/;
  const pubDateRegex = /<pubDate>([\s\S]*?)<\/pubDate>/;
  let match: RegExpExecArray | null;
  while ((match = itemRegex.exec(xml))) {
    const block = match[1];
    const t = block.match(titleRegex);
    const p = block.match(pubDateRegex);
    if (t && p && isToday(p[1].trim())) {
      items.push({ title: t[1].trim(), pubDate: p[1].trim() });
    }
  }
  return items;
};

const main = async () => {
  const uri = process.env.MONGO_URI as string;
  await mongoose.connect(uri);
  const db = mongoose.connection.getClient().db('cafe-bot');
  const accounts = await db
    .collection('accounts')
    .find(
      { accountId: { $in: TARGETS } },
      { projection: { _id: 0, accountId: 1, nickname: 1, blogId: 1 } },
    )
    .toArray();

  console.log(`오늘 = ${TODAY_KEY}\n`);

  for (const acc of accounts) {
    const blogId = (acc.blogId ?? acc.accountId) as string;
    try {
      const xml = await fetchRss(blogId);
      const items = extractTodayItems(xml);
      console.log(`[${acc.nickname} / ${acc.accountId} / blogId=${blogId}] 오늘 발행 ${items.length}개`);
      for (const it of items) {
        console.log(`  - ${it.title} (${it.pubDate})`);
      }
    } catch (e) {
      console.log(`[${acc.nickname} / ${acc.accountId}] RSS 실패: ${(e as Error).message}`);
    }
  }

  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
