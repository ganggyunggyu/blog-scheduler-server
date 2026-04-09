import { calculateSchedule } from '../src/services/schedule.service.js';
import { appendScheduledBlogUtmRows } from '../src/services/google-sheets.service.js';

const accounts = [
  { name: '힘차게', keywords: ['수족냉증', '홍삼효능'] },
  { name: '미식가2', keywords: ['소음인체질', '비타민E효능'] },
  { name: '뽀또', keywords: ['임산부철분제', '면역력높이는음식'] },
  { name: '달리자', keywords: ['흑염소효능', '십전대보탕효능'] },
  { name: '듣는방법', keywords: ['당귀효능', '빈혈증상'] },
  { name: '비밀의정원', keywords: ['만성피로증후군', '관절에좋은음식'] },
  { name: '빨간모자앤', keywords: ['콜레스테롤영양제', '영지버섯효능'] },
  { name: '소원', keywords: ['혈액순환에좋은음식', '키성장영양제'] },
];

const main = async () => {
  const scheduled = accounts.map(({ name, keywords }) => ({
    name,
    items: calculateSchedule(keywords, '2026-04-07', '2'),
  }));

  for (const { name, items } of scheduled) {
    for (const item of items) {
      const d = item.scheduledAt;
      const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
      console.log(`${name} | ${item.keyword} | ${mmdd} | ${d.toISOString()}`);
    }
  }

  console.log('\n--- UTM 시트 등록 중 ---');
  const result = await appendScheduledBlogUtmRows(scheduled);
  console.log('UTM 등록 완료:', JSON.stringify(result, null, 2));
};

main().catch(console.error);
