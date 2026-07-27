import 'dotenv/config';
import { getBrowser, closeBrowser } from '../src/lib/browser/playwright.js';

const shotDir = process.env.SHOT_DIR ?? '/tmp';

const main = async (): Promise<void> => {
  const postUrl = process.argv[2];
  if (!postUrl) throw new Error('사용법: tsx scripts/verify-post.ts <포스트 URL>');

  const browser = await getBrowser();
  const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
  const page = await context.newPage();

  await page.goto(postUrl.replace('blog.naver.com', 'm.blog.naver.com'), {
    waitUntil: 'domcontentloaded',
  });
  await page.waitForTimeout(5000);

  const summary = await page.evaluate(() => {
    const root = document.querySelector('.se-main-container') ?? document.body;
    const images = [...root.querySelectorAll('img')].filter((img) => (img as HTMLImageElement).naturalWidth > 200);
    const quotes = [...root.querySelectorAll('.se-quotation, blockquote')];
    const colored = [...root.querySelectorAll('span[style*="color"], strong[style*="color"]')];
    return {
      title: document.querySelector('.se-title-text, .se_title')?.textContent?.trim() ?? '',
      textLength: (root.textContent ?? '').replace(/\s+/g, '').length,
      images: images.length,
      quotes: quotes.length,
      quoteTexts: quotes.slice(0, 8).map((q) => (q.textContent ?? '').trim().slice(0, 40)),
      coloredSpans: colored.length,
      coloredSamples: colored.slice(0, 6).map((c) => (c.textContent ?? '').trim().slice(0, 20)),
      head: (root.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
    };
  });

  console.log(JSON.stringify(summary, null, 2));
  await page.screenshot({ path: `${shotDir}/published-post.png`, fullPage: true }).catch(() => undefined);

  await context.close();
  await closeBrowser();
};

main().catch(async (error) => {
  console.error('[error]', error instanceof Error ? error.message : String(error));
  await closeBrowser().catch(() => undefined);
  process.exit(1);
});
