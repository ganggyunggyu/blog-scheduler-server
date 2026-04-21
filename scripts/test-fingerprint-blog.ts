/**
 * Fingerprint 적용 블로그 글 발행 테스트
 *
 * Usage:
 *   FINGERPRINT_ENABLED=true npx tsx scripts/test-fingerprint-blog.ts qwzx16
 */
import { connectMongo } from '../src/config/mongo.js';
import { findAccountById } from '../src/services/account-directory.service.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { writePost } from '../src/services/naver-blog.service.js';

const main = async () => {
  const accountId = process.argv[2];
  if (!accountId) {
    console.error('사용법: npx tsx scripts/test-fingerprint-blog.ts <accountId>');
    process.exit(1);
  }

  console.log(`[FINGERPRINT] ${process.env.FINGERPRINT_ENABLED === 'true' ? 'ON' : 'OFF'}`);
  console.log(`[ACCOUNT] ${accountId}`);

  await connectMongo();

  const account = await findAccountById(accountId);
  if (!account) {
    console.error(`계정을 찾을 수 없음: ${accountId}`);
    process.exit(1);
  }
  console.log(`[FOUND] ${account.id}`);

  const { cookies, fromCache } = await getValidCookies(account.id, account.password);
  console.log(`[COOKIES] ${cookies.length}개 ${fromCache ? '(캐시)' : '(새 로그인)'}`);

  const title = '새 커피머신 들여놨는데 생각보다 만족스럽네요';
  const content = `오늘 드디어 고민하던 커피머신이 도착했어요.\n\n박스 뜯어서 세팅하는데 생각보다 간단하더라고요. 물 넣고 원두 갈아서 한 잔 내려봤는데 향이 진짜 좋네요. 평소 홈카페 관심만 있다가 큰맘 먹고 질렀는데 이거면 아침마다 카페 가던 돈 금방 뽑을 것 같아요.\n\n당분간 아메리카노 내려 먹으면서 세팅 익혀봐야겠어요.`;

  console.log(`[TITLE] ${title}`);
  console.log(`[CONTENT] ${content.length}자\n`);

  const result = await writePost({
    cookies,
    accountId: account.id,
    title,
    content,
  });

  console.log('\n=== 결과 ===');
  console.log(JSON.stringify(result, null, 2));

  process.exit(result.success ? 0 : 1);
};

main().catch((e) => {
  console.error('실패:', e);
  process.exit(1);
});
