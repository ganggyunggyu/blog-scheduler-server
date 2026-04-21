import 'dotenv/config';
import mongoose from 'mongoose';

const fetchPostCount = async (blogId: string): Promise<number | null> => {
  try {
    const url = `https://blog.naver.com/PostTitleListAsync.naver?blogId=${blogId}&viewdate=&currentPage=1&categoryNo=0&parentCategoryNo=&countPerPage=1`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: `https://blog.naver.com/${blogId}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const m = text.match(/"totalCount"\s*:\s*"?(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  } catch {
    return null;
  }
};

const main = async () => {
  await mongoose.connect(process.env.MONGO_URI!);
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const docs = await cafeDb
    .collection('accounts')
    .find({ isActive: { $ne: false }, category: { $in: ['흑염소', '한려담원'] } })
    .toArray();

  console.log(`\n=== 흑염소 계정 실제 블로그 글 수 ===`);
  console.log(`대상 계정: ${docs.length}개\n`);

  let total = 0;
  for (const d of docs) {
    const blogId = (d.blogId as string) || (d.accountId as string);
    const nickname = (d.nickname as string) || (d.accountId as string);
    const count = await fetchPostCount(blogId);
    if (count === null) {
      console.log(`  [조회실패] ${nickname} (${blogId})`);
      continue;
    }
    total += count;
    console.log(`  ${nickname.padEnd(16)} (${blogId.padEnd(14)})  ${String(count).padStart(4)}개`);
  }
  console.log(`\n총 ${total}개 글`);
  await mongoose.disconnect();
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
