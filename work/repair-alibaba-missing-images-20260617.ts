import 'dotenv/config';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import mongoose from 'mongoose';
import {
  closeSession,
  confirmPublish,
  createSession,
  dismissPopups,
  focusLastParagraphEnd,
  getMainFrame,
  openPublishDialog,
  setPublicVisibility,
  uploadImage,
} from '../src/lib/naver-editor/index.js';
import { getValidCookies } from '../src/services/naver-auth.service.js';
import { prepareProductImages } from '../src/services/product-image.service.js';

const EXECUTE = process.argv.includes('--execute');
const TARGET_DATE = '2026-06-17';
const OUTPUT_PATH = path.join(process.cwd(), 'outputs', `alibaba-missing-image-repair-${TARGET_DATE}${EXECUTE ? '-execute' : '-dry-run'}.json`);
const WORK_ROOT = path.join(process.cwd(), 'work', `alibaba-missing-image-repair-${TARGET_DATE}`);

interface Target {
  accountId: string;
  blogId: string;
  logNo: string;
  keyword: string;
  title: string;
  dateCode: string;
}

interface AccountDoc {
  accountId: string;
  password: string;
  blogId?: string;
  nickname?: string;
}

interface RepairResult {
  target: Target;
  beforeImageCount: number;
  preparedImages: {
    body: number;
    excludeLibrary: number;
    individual: number;
    slide: number;
    collage: number;
  };
  imagePath: string;
  status: 'DRY_RUN' | 'OK' | 'SKIPPED' | 'FAILED';
  afterImageCount?: number;
  postUrl?: string;
  error?: string;
}

const TARGETS: Target[] = [
  {
    accountId: 'mad1651',
    blogId: 'mad1651',
    logNo: '224318488621',
    keyword: '해외구매',
    title: '알리바바닷컴 해외구매대행 절차부터 관세까지 총정리',
    dateCode: '0617',
  },
  {
    accountId: 'mad1651',
    blogId: 'mad1651',
    logNo: '224318473701',
    keyword: '해외배송대행',
    title: '해외배송대행 해외직구 초보자를 위한 가이드',
    dateCode: '0617',
  },
  {
    accountId: 'weed3122',
    blogId: 'weed3122',
    logNo: '224318497711',
    keyword: '해외구매',
    title: '해외구매 통관 A부터 Z까지 총정리',
    dateCode: '0617',
  },
  {
    accountId: 'weed3122',
    blogId: 'weed3122',
    logNo: '224318490743',
    keyword: '해외배송대행',
    title: '해외배송대행 비교 방법부터 주의점까지 총정리',
    dateCode: '0617',
  },
  {
    accountId: 'weed3122',
    blogId: 'weed3122',
    logNo: '224318484952',
    keyword: '해외직구통관배송조회',
    title: '해외직구통관배송조회 완벽정리',
    dateCode: '0616',
  },
  {
    accountId: 'individual14144',
    blogId: 'individual14144',
    logNo: '224318512063',
    keyword: '해외구매',
    title: '해외구매 피해야 하는 이유 지금 알려드려요',
    dateCode: '0617',
  },
];

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const getPublicBodyImageCount = async (target: Target): Promise<number> => {
  const response = await fetch(`https://m.blog.naver.com/${target.blogId}/${target.logNo}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`public check failed: status=${response.status}`);
  }

  const html = await response.text();
  return (html.match(/class="se-image-resource"/g) ?? []).length;
};

const resolveAccounts = async (): Promise<Map<string, AccountDoc>> => {
  const cafeDb = mongoose.connection.useDb('cafe-bot');
  const accountIds = [...new Set(TARGETS.map((target) => target.accountId))];
  const accounts = await cafeDb.collection<AccountDoc>('accounts')
    .find(
      { accountId: { $in: accountIds } },
      { projection: { accountId: 1, password: 1, blogId: 1, nickname: 1 } },
    )
    .toArray();

  const byId = new Map(accounts.map((account) => [account.accountId, account]));
  const missing = accountIds.filter((accountId) => !byId.get(accountId)?.password);
  if (missing.length > 0) {
    throw new Error(`계정 또는 비밀번호 없음: ${missing.join(', ')}`);
  }

  return byId;
};

const chooseRepairImage = (productData: Awaited<ReturnType<typeof prepareProductImages>>): string => {
  const imagePath =
    productData.bodyImages[0] ??
    productData.excludeLibrary[0] ??
    productData.multiImages.individual?.[0] ??
    productData.multiImages.slide?.[0] ??
    productData.multiImages.collage?.[0] ??
    '';

  if (!imagePath) {
    throw new Error('복구 이미지 없음');
  }

  return imagePath;
};

const appendImageToPost = async (
  account: AccountDoc,
  target: Target,
  imagePath: string,
): Promise<string> => {
  const auth = await getValidCookies(account.accountId, account.password);
  const session = await createSession(auth.cookies, account.accountId);
  const { page } = session;

  try {
    const url = `https://blog.naver.com/${target.blogId}?Redirect=Update&logNo=${target.logNo}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3_000);

    const frame = await getMainFrame(page);
    await page.waitForTimeout(2_000);
    await dismissPopups(frame);

    const focused = await focusLastParagraphEnd(frame);
    if (!focused) {
      throw new Error('본문 끝 포커스 실패');
    }

    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);

    const uploaded = await uploadImage(page, frame, imagePath);
    if (!uploaded) {
      throw new Error(`이미지 업로드 실패: ${path.basename(imagePath)}`);
    }

    await page.waitForTimeout(1_500);
    await dismissPopups(frame);
    await openPublishDialog(page, frame);
    await setPublicVisibility(page, frame);
    const postUrl = await confirmPublish(page, frame);
    return postUrl;
  } finally {
    await closeSession(session);
  }
};

const runTarget = async (
  accounts: Map<string, AccountDoc>,
  target: Target,
): Promise<RepairResult> => {
  const beforeImageCount = await getPublicBodyImageCount(target);
  const account = accounts.get(target.accountId);
  if (!account) {
    throw new Error(`계정 없음: ${target.accountId}`);
  }

  if (beforeImageCount > 0) {
    return {
      target,
      beforeImageCount,
      preparedImages: { body: 0, excludeLibrary: 0, individual: 0, slide: 0, collage: 0 },
      imagePath: '',
      status: 'SKIPPED',
      afterImageCount: beforeImageCount,
    };
  }

  const imagesDir = path.join(WORK_ROOT, target.blogId, target.logNo);
  await mkdir(imagesDir, { recursive: true });
  const productData = await prepareProductImages({
    keyword: target.keyword,
    blogId: target.blogId,
    category: '기타',
    dateCode: target.dateCode,
    blogName: account.nickname ?? target.accountId,
    manuscriptType: 'alibaba',
    imagesDir,
  });
  const imagePath = chooseRepairImage(productData);
  const preparedImages = {
    body: productData.bodyImages.length,
    excludeLibrary: productData.excludeLibrary.length,
    individual: productData.multiImages.individual?.length ?? 0,
    slide: productData.multiImages.slide?.length ?? 0,
    collage: productData.multiImages.collage?.length ?? 0,
  };

  if (!EXECUTE) {
    return {
      target,
      beforeImageCount,
      preparedImages,
      imagePath,
      status: 'DRY_RUN',
    };
  }

  const postUrl = await appendImageToPost(account, target, imagePath);
  await sleep(3_000);
  const afterImageCount = await getPublicBodyImageCount(target);

  return {
    target,
    beforeImageCount,
    preparedImages,
    imagePath,
    status: afterImageCount > beforeImageCount ? 'OK' : 'FAILED',
    afterImageCount,
    postUrl,
    error: afterImageCount > beforeImageCount ? undefined : '공개 본문 이미지 수 증가 확인 실패',
  };
};

const main = async (): Promise<void> => {
  if (!process.env.MONGO_URI?.startsWith('mongodb+srv://')) {
    throw new Error('Atlas MONGO_URI가 필요함');
  }

  await mongoose.connect(process.env.MONGO_URI);
  const accounts = await resolveAccounts();
  await mongoose.disconnect();

  const results: RepairResult[] = [];
  for (const target of TARGETS) {
    try {
      results.push(await runTarget(accounts, target));
    } catch (error) {
      results.push({
        target,
        beforeImageCount: 0,
        preparedImages: { body: 0, excludeLibrary: 0, individual: 0, slide: 0, collage: 0 },
        imagePath: '',
        status: 'FAILED',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const report = {
    targetDate: TARGET_DATE,
    execute: EXECUTE,
    generatedAt: new Date().toISOString(),
    totals: {
      targets: results.length,
      ok: results.filter((result) => result.status === 'OK').length,
      skipped: results.filter((result) => result.status === 'SKIPPED').length,
      failed: results.filter((result) => result.status === 'FAILED').length,
      dryRun: results.filter((result) => result.status === 'DRY_RUN').length,
    },
    results,
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({
    outputPath: OUTPUT_PATH,
    totals: report.totals,
    results: results.map((result) => ({
      accountId: result.target.accountId,
      logNo: result.target.logNo,
      status: result.status,
      beforeImageCount: result.beforeImageCount,
      afterImageCount: result.afterImageCount,
      preparedImages: result.preparedImages,
      error: result.error,
    })),
  }, null, 2));
};

main().catch(async (error) => {
  await mongoose.disconnect().catch(() => undefined);
  console.error(error);
  process.exit(1);
});
