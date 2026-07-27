import 'dotenv/config';
import { prepareJob } from '../src/services/manuscript.service.js';
import type { ManuscriptType } from '../src/services/manuscript.service.js';

const main = async (): Promise<void> => {
  const [manuscriptType, keyword, businessName, blogName = ''] = process.argv.slice(2);
  if (!manuscriptType || !keyword || !businessName) {
    throw new Error('사용법: tsx scripts/_restaurant-generate-check.ts <restaurant1|restaurant2> <키워드> <업체명> [캐릭터명]');
  }

  const prepared = await prepareJob(
    keyword,
    'restaurant',
    '',
    true,
    5,
    'google',
    manuscriptType as ManuscriptType,
    undefined,
    { businessName, blogName },
  );

  console.log('=== title ===');
  console.log(prepared.title);
  console.log('=== content head ===');
  console.log(prepared.content.split('\n').slice(0, 8).join('\n'));
  console.log('=== stats ===');
  console.log('길이:', prepared.content.replace(/\s/g, '').length, '자');
  console.log('이미지:', prepared.images.length);
  console.log('업체명 본문 포함:', prepared.content.includes(businessName.split(' ')[0]));
  console.log('구분선 잔존:', /^[-—–_=*]{5,}$/m.test(prepared.content));
  console.log('제목 라벨 잔존:', /^\[?\s*제목/.test(prepared.title));
};

main().catch((error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
