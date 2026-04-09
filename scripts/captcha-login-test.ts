import 'dotenv/config';
import { chromium } from 'playwright';
import { detectCaptcha, attemptCaptchaSolve } from '../src/services/captcha-solver.service.js';

const TEST_ID = 'qwzx16';
const TEST_PW = 'rkdrudrb123!';
const MAX_ROUNDS = 2;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const main = async () => {
  console.log('=== 캡차 로그인 테스트 ===');
  console.log(`계정: ${TEST_ID}, 최대 ${MAX_ROUNDS}라운드\n`);

  const browser = await chromium.launch({ headless: false, slowMo: 50 });

  let captchaCount = 0;
  let solvedCount = 0;
  let loginCount = 0;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n--- [${round}/${MAX_ROUNDS}] ---`);

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      await page.goto('https://nid.naver.com/nidlogin.login', { waitUntil: 'domcontentloaded', timeout: 15000 });
      await sleep(500);

      // ID/PW 입력
      await page.fill('#id', TEST_ID);
      await sleep(200);
      await page.fill('#pw', TEST_PW);
      await sleep(200);

      // 로그인 클릭
      await page.click(".btn_login, #log\\.login, button[type='submit']");
      await sleep(3000);

      // 캡차 감지
      const captcha = await detectCaptcha(page);

      if (captcha.detected) {
        captchaCount++;
        console.log(`  🔒 캡차 감지! (타입: ${captcha.captchaType}, 질문: ${captcha.question})`);

        const solved = await attemptCaptchaSolve(page, TEST_PW);
        if (solved) {
          solvedCount++;
          console.log(`  ✅ 캡차 풀이 성공!`);
        } else {
          console.log(`  ❌ 캡차 풀이 실패`);
        }
      }

      // 로그인 성공 여부
      const url = page.url();
      if (!url.includes('nidlogin')) {
        loginCount++;
        console.log(`  ✅ 로그인 성공`);

        // 쿠키 확인
        const cookies = await context.cookies();
        const nidAut = cookies.find(c => c.name === 'NID_AUT');
        const nidSes = cookies.find(c => c.name === 'NID_SES');
        console.log(`  쿠키: NID_AUT=${nidAut ? '있음' : '없음'}, NID_SES=${nidSes ? '있음' : '없음'}`);

        // 로그아웃
        await page.goto('https://nid.naver.com/nidlogin.logout', { timeout: 10000 }).catch(() => {});
        await sleep(1000);
      } else {
        console.log(`  ❌ 로그인 실패 (여전히 로그인 페이지)`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  💥 에러: ${msg}`);
    } finally {
      await context.close();
    }

    await sleep(2000);
  }

  await browser.close();

  console.log('\n' + '='.repeat(50));
  console.log('=== 결과 ===');
  console.log(`총 라운드: ${MAX_ROUNDS}`);
  console.log(`캡차 발생: ${captchaCount}회`);
  console.log(`캡차 풀이 성공: ${solvedCount}/${captchaCount}`);
  console.log(`로그인 성공: ${loginCount}/${MAX_ROUNDS}`);
  console.log('='.repeat(50));
};

main().catch(console.error);
