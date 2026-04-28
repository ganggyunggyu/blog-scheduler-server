import 'dotenv/config';
import axios from 'axios';
import mongoose from 'mongoose';
import type { ProductImagesResponse } from '../src/types/metadata.js';

interface RepairPost {
  keyword: string;
  link: string;
}

interface RepairAccount {
  blogId: string;
  blogName: string;
  posts: RepairPost[];
}

interface RepairTarget {
  account: RepairAccount;
  post: RepairPost;
}

const IMAGE_API_URL = process.env.IMAGE_API_URL ?? 'http://localhost:3939';
const SCHEDULER_API_URL = process.env.SCHEDULER_API_URL ?? 'http://127.0.0.1:8001';
const DATE_CODE = '0428';
const DELAY_ARG = process.argv.find((arg) => arg.startsWith('--delay-minutes='));
const DELAY_MINUTES = DELAY_ARG ? Number(DELAY_ARG.split('=')[1]) : 0;
const VALIDATION_RETRIES = 20;
const VALIDATION_INTERVAL_MS = 60_000;

const ACCOUNTS: RepairAccount[] = [
  {
    blogId: 'nes1p2kx',
    blogName: '에스앤비안과',
    posts: [
      { keyword: '스마일라식후기:라식라섹정보', link: 'https://blog.naver.com/nes1p2kx/224268573051' },
      { keyword: '백내장초기증상:시력교정정보', link: 'https://blog.naver.com/nes1p2kx/224268576079' },
      { keyword: '정밀안과검사:시력교정정보', link: 'https://blog.naver.com/nes1p2kx/224268628738' },
    ],
  },
  {
    blogId: 'h9ag469z',
    blogName: '에스앤비안과 정보',
    posts: [
      { keyword: '라식후기:라식라섹정보', link: 'https://blog.naver.com/h9ag469z/224268619594' },
      { keyword: '안구건조증치료:시력교정정보', link: 'https://blog.naver.com/h9ag469z/224268621984' },
      { keyword: '백내장증상:시력교정정보', link: 'https://blog.naver.com/h9ag469z/224268624324' },
    ],
  },
];

const sleep = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const stripCategory = (keyword: string): string => keyword.split(':')[0] ?? keyword;

const getTargets = (): RepairTarget[] =>
  ACCOUNTS.flatMap((account) => account.posts.map((post) => ({ account, post })));

const validateProductData = async ({ account, post }: RepairTarget): Promise<string[]> => {
  const keyword = stripCategory(post.keyword);
  const response = await axios.get<ProductImagesResponse>(`${IMAGE_API_URL}/api/image/product-images`, {
    params: {
      keyword,
      blogId: account.blogId,
      dateCode: DATE_CODE,
      blogName: account.blogName,
      manuscriptType: 'default',
    },
    timeout: 300_000,
  });

  const { images, metadata } = response.data;
  const errors: string[] = [];

  if ((images.body?.length ?? 0) === 0) errors.push('body=0');
  if ((images.slide?.length ?? 0) === 0) errors.push('slide=0');
  if ((images.excludeLibrary?.length ?? 0) === 0) errors.push('excludeLibrary=0');
  if ((images.excludeLibraryLink?.length ?? 0) === 0) errors.push('excludeLibraryLink=0');
  if ((metadata?.lib_url?.length ?? 0) < (images.excludeLibraryLink?.length ?? 0)) errors.push('lib_url 부족');
  if ((metadata?.mapQueries?.length ?? 0) === 0) errors.push('mapQueries=0');

  console.log(JSON.stringify({
    keyword,
    blogId: account.blogId,
    body: images.body?.length ?? 0,
    slide: images.slide?.length ?? 0,
    excludeLibrary: images.excludeLibrary?.length ?? 0,
    excludeLibraryLink: images.excludeLibraryLink?.length ?? 0,
    libUrl: metadata?.lib_url?.length ?? 0,
    mapQueries: metadata?.mapQueries ?? [],
    phone: metadata?.phone ?? '',
    url: metadata?.url ?? '',
    valid: errors.length === 0,
    errors,
  }));

  return errors.map((error) => `${account.blogId}/${keyword}: ${error}`);
};

const validateAllProductData = async (): Promise<void> => {
  for (let attempt = 1; attempt <= VALIDATION_RETRIES; attempt += 1) {
    console.log(`[validate] attempt=${attempt}/${VALIDATION_RETRIES}`);
    const results = await Promise.allSettled(getTargets().map(validateProductData));
    const errors = results.flatMap((result) => {
      if (result.status === 'fulfilled') return result.value;
      return [result.reason instanceof Error ? result.reason.message : String(result.reason)];
    });

    if (errors.length === 0) {
      console.log('[validate] product image metadata ok');
      return;
    }

    console.log(`[validate] failed: ${errors.join(' | ')}`);
    if (attempt < VALIDATION_RETRIES) {
      await sleep(VALIDATION_INTERVAL_MS);
    }
  }

  throw new Error('product image metadata validation failed after retries');
};

const ensureAccountsExist = async (): Promise<void> => {
  await mongoose.connect(process.env.MONGO_URI!);
  const accountCollection = mongoose.connection.useDb('cafe-bot').collection('accounts');
  const accountIds = ACCOUNTS.map((account) => account.blogId);
  const accounts = await accountCollection.find({ accountId: { $in: accountIds } }).project({ accountId: 1, password: 1 }).toArray();
  const found = new Set(accounts.filter((account) => Boolean(account.password)).map((account) => String(account.accountId)));
  const missing = accountIds.filter((accountId) => !found.has(accountId));
  await mongoose.disconnect();

  if (missing.length > 0) {
    throw new Error(`missing accounts or passwords: ${missing.join(', ')}`);
  }
};

const enqueueLinkUpdate = async (): Promise<void> => {
  const keywords = ACCOUNTS.flatMap((account) => account.posts.map((post) => post.keyword));
  const links = ACCOUNTS.flatMap((account) => account.posts.map((post) => post.link));
  const response = await axios.post(`${SCHEDULER_API_URL}/bot/link-update`, {
    keywords,
    links,
    service: 'default',
    ref: `eye-image-repair-20260428-${Date.now()}`,
    generate_images: true,
    image_count: 5,
    image_source: 'product',
    manuscript_type: 'default',
    delay_between_posts: 10,
    keyword_category: '안과',
  }, {
    timeout: 60_000,
  });

  console.log(JSON.stringify(response.data, null, 2));
};

const main = async (): Promise<void> => {
  if (DELAY_MINUTES > 0) {
    console.log(`[delay] waiting ${DELAY_MINUTES} minutes`);
    await sleep(DELAY_MINUTES * 60_000);
  }

  await ensureAccountsExist();
  await validateAllProductData();
  await enqueueLinkUpdate();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
}).finally(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => undefined);
  }
});
