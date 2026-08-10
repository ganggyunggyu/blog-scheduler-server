import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { buildManuscriptRequest, generateImageUrls, prepareJob, prepareProvidedJob } from '../../src/services/manuscript.service.js';

test('buildManuscriptRequest: default 는 blog-filler 엔드포인트를 사용함', () => {
  const result = buildManuscriptRequest('default', '강아지 산책', 'default', '');

  assert.equal(result.url, 'http://localhost:8000/generate/blog-filler');
  assert.deepEqual(result.body, {
    service: 'default',
    keyword: '강아지 산책',
    ref: '',
  });
  assert.equal(result.engine, undefined);
});

test('buildManuscriptRequest: alibaba 도 원고는 blog-filler 엔드포인트로 보냄', () => {
  const result = buildManuscriptRequest('alibaba', '1688', 'default', '', '기타');

  assert.equal(result.url, 'http://localhost:8000/generate/blog-filler');
  assert.deepEqual(result.body, {
    service: 'default',
    keyword: '1688',
    ref: '',
  });
  assert.equal(result.engine, undefined);
});

test('buildManuscriptRequest: grok 은 기존처럼 category 와 engine 을 유지함', () => {
  const result = buildManuscriptRequest('grok', '스마일라식', 'default', '', '안과');

  assert.equal(result.url, 'http://localhost:8000/generate/grok');
  assert.deepEqual(result.body, {
    service: 'default',
    keyword: '스마일라식',
    ref: '',
    category: '안과',
  });
  assert.equal(result.engine, 'grok');
});

test('prepareProvidedJob: 외부에서 만든 원고를 job 아티팩트로 저장함', async () => {
  const prepared = await prepareProvidedJob(
    '뱅갈',
    'default',
    '',
    {
      title: '뱅갈 성격 먼저 봐야 하는 이유',
      content: '안녕하세요 집사입니다.\n\n1. 성격\n활발한 편이에요.',
    },
    false,
    5,
    'product',
    'pet',
  );

  assert.equal(prepared.title, '뱅갈 성격 먼저 봐야 하는 이유');
  assert.equal(prepared.content, '안녕하세요 집사입니다.\n\n1. 성격\n활발한 편이에요.');
  assert.equal(prepared.images.length, 0);
  assert.match(prepared.manuscriptId, /^manual_/);

  const savedManuscript = await readFile(`${prepared.jobDir}/manuscript.txt`, 'utf-8');
  assert.match(savedManuscript, /^뱅갈 성격 먼저 봐야 하는 이유/);

  const savedMeta = JSON.parse(await readFile(`${prepared.jobDir}/meta.json`, 'utf-8')) as {
    source?: string;
    manuscriptType?: string;
  };
  assert.equal(savedMeta.source, 'manual');
  assert.equal(savedMeta.manuscriptType, 'pet');
});

test('prepareJob: restaurant/v2 응답의 businessName/fileName을 job 아티팩트에 반영함', async () => {
  const originalPost = axios.post;

  axios.post = (async (url: string) => {
    assert.match(url, /\/generate\/restaurant\/v2$/);
    return {
      data: {
        _id: 'abc123',
        content: '[제목] 을지로 맛집 다녀온 후기\n------------------------------------------------------------\n\n🏪 상호 : 우레옥\n본문 내용',
        businessName: '우레옥',
        fileName: '을지로맛집_우레옥_1234.txt',
      },
    } as Awaited<ReturnType<typeof axios.post>>;
  }) as typeof axios.post;

  try {
    const prepared = await prepareJob(
      '을지로 맛집',
      'default',
      '',
      false,
      5,
      'ai',
      'restaurant/v2',
    );

    assert.equal(prepared.businessName, '우레옥');

    // manuscript.txt는 그대로 유지되고(파이프라인이 이 이름으로 계속 읽음),
    // 업체명이 들어간 파일명으로도 같은 내용이 추가 저장돼야 한다.
    const canonical = await readFile(`${prepared.jobDir}/manuscript.txt`, 'utf-8');
    assert.match(canonical, /을지로 맛집 다녀온 후기/);

    const labeled = await readFile(`${prepared.jobDir}/을지로맛집_우레옥_1234.txt`, 'utf-8');
    assert.equal(labeled, canonical);

    const savedMeta = JSON.parse(await readFile(`${prepared.jobDir}/meta.json`, 'utf-8')) as {
      businessName?: string;
    };
    assert.equal(savedMeta.businessName, '우레옥');
  } finally {
    axios.post = originalPost;
  }
});

test('prepareJob: businessName이 없는 응답(default 타입 등)은 라벨 파일을 추가로 만들지 않음', async () => {
  const originalPost = axios.post;

  axios.post = (async () => ({
    data: { _id: 'xyz', content: '기본 원고 제목\n\n본문' },
  } as Awaited<ReturnType<typeof axios.post>>)) as typeof axios.post;

  try {
    const prepared = await prepareJob('강아지 산책', 'default', '', false, 5, 'ai', 'default');

    assert.equal(prepared.businessName, undefined);

    const files = await import('node:fs/promises').then((fs) => fs.readdir(prepared.jobDir));
    assert.deepEqual(files.sort(), ['images', 'manuscript.txt', 'meta.json']);
  } finally {
    axios.post = originalPost;
  }
});

test('generateImageUrls: AI 생성 요청에 count 를 싣고 부족분을 보충함', async () => {
  const originalPost = axios.post;
  const bodies: Array<{ keyword?: string; category?: string; count?: number }> = [];

  axios.post = (async (...args: Parameters<typeof axios.post>) => {
    const body = args[1] as { keyword?: string; category?: string; count?: number };
    bodies.push(body);

    const offset = bodies.length === 1 ? 0 : 4;
    const count = body.count ?? 0;
    const returnedCount = bodies.length === 1 ? Math.max(0, count - 1) : count;

    return {
      data: {
        images: Array.from({ length: returnedCount }, (_, index) => ({
          url: `https://example.com/${offset + index + 1}.png`,
        })),
      },
    } as Awaited<ReturnType<typeof axios.post>>;
  }) as typeof axios.post;

  try {
    const images = await generateImageUrls('스핑크스', 5, '애견', 'ai');

    assert.equal(images.length, 5);
    assert.deepEqual(bodies, [
      { keyword: '스핑크스', category: '애견', count: 5 },
      { keyword: '스핑크스', category: '애견', count: 1 },
    ]);
  } finally {
    axios.post = originalPost;
  }
});
