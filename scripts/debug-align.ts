import 'dotenv/config';
import { naverLogin } from '../src/services/naver-auth.service.js';
import { createSession, closeSession, getMainFrame } from '../src/lib/naver-editor/index.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  console.log('=== 디버그: 1개 계정 테스트 ===');

  const loginResult = await naverLogin('iealpx8p', '2e8f5eg)');
  if (!loginResult.success) {
    console.log('로그인 실패:', loginResult.message);
    return;
  }
  console.log('로그인 성공, 쿠키:', loginResult.cookies.length);

  // 쿠키 도메인 확인
  const cookies = loginResult.cookies as any[];
  const domains = [...new Set(cookies.map((c: any) => c.domain))];
  console.log('쿠키 도메인:', domains);
  console.log('쿠키 목록:', cookies.map((c: any) => `${c.name}@${c.domain}`).join(', '));

  const session = await createSession(loginResult.cookies);
  const { page } = session;

  try {
    // MyBlog 이동
    console.log('\nMyBlog.naver 이동...');
    await page.goto('https://blog.naver.com/MyBlog.naver', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await sleep(3000);
    console.log('현재 URL:', page.url());

    if (page.url().includes('nidlogin') || page.url().includes('nid.naver.com')) {
      console.log('세션 만료됨! 로그인 페이지로 리다이렉트됨');
      return;
    }

    // 프레임 확인
    const frames = page.frames();
    console.log('프레임 수:', frames.length);
    frames.forEach((f, i) => {
      console.log(`  프레임 ${i}: name="${f.name()}" url=${f.url()}`);
    });

    // mainFrame 대기
    console.log('\nmainFrame 대기 (30초)...');
    try {
      const frame = await getMainFrame(page);
      console.log('mainFrame 발견!');
      console.log('mainFrame URL:', frame.url());
    } catch (err) {
      console.log('mainFrame 못 찾음:', err instanceof Error ? err.message : String(err));

      // 직접 PostList 이동
      console.log('\n직접 PostList 이동...');
      await page.goto('https://blog.naver.com/PostList.naver?blogId=iealpx8p', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await sleep(5000);
      console.log('URL:', page.url());

      const frames2 = page.frames();
      console.log('프레임 수:', frames2.length);
      frames2.forEach((f, i) => {
        console.log(`  프레임 ${i}: name="${f.name()}" url=${f.url().substring(0, 100)}`);
      });
    }

    // 에디터 직접 이동 테스트
    console.log('\n에디터 직접 이동 (Update)...');
    await page.goto('https://blog.naver.com/iealpx8p?Redirect=Update&logNo=224239590139', {
      waitUntil: 'domcontentloaded',
      timeout: 60000,
    });
    await sleep(8000);
    console.log('에디터 URL:', page.url());

    const editorFrames = page.frames();
    console.log('에디터 프레임 수:', editorFrames.length);
    editorFrames.forEach((f, i) => {
      console.log(`  프레임 ${i}: name="${f.name()}" url=${f.url().substring(0, 100)}`);
    });

  } finally {
    await closeSession(session);
  }
};

main().catch(console.error);
