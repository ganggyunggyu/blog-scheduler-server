import { calculateSchedule } from '../src/services/schedule.service.js';
import { appendScheduledBlogUtmRows } from '../src/services/google-sheets.service.js';

const accounts = [
  { name: '힘차게', keywords: ['수족냉증원인', '녹용효능'] },
  { name: '미식가2', keywords: ['소음인흑염소', '비타민B12효능'] },
  { name: '뽀또', keywords: ['임산부흑염소', '간에좋은음식'] },
  { name: '달리자', keywords: ['흑염소진액복용법', '경옥고효능'] },
  { name: '듣는방법', keywords: ['기력회복', '빈혈원인'] },
  { name: '비밀의정원', keywords: ['도라지효능', '만성피로증상'] },
  { name: '빨간모자앤', keywords: ['면역력영양제', '혈압영양제'] },
  { name: '소원', keywords: ['골밀도높이는법', '혈액순환개선제'] },
];

const main = async () => {
  const scheduled = accounts.map(({ name, keywords }) => ({
    name,
    items: calculateSchedule(keywords, '2026-04-08', '2'),
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
