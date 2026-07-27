import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import axios from 'axios';
import { buildManuscriptRequest, findManuscriptRejection, generateImageUrls, parseManuscriptContent, prepareProvidedJob } from '../../src/services/manuscript.service.js';

test('buildManuscriptRequest: restaurant/v1 은 맛집1 엔드포인트로 업체명을 고정해서 보냄', () => {
  const result = buildManuscriptRequest('restaurant/v1', '부천중동맛집', 'restaurant', '', undefined, {
    businessName: '베코',
    blogName: '블루망고',
  });

  assert.equal(result.url, 'http://localhost:8000/generate/restaurant/v1');
  assert.deepEqual(result.body, {
    service: 'restaurant',
    keyword: '부천중동맛집',
    ref: '',
    business_name: '베코',
    blog_name: '블루망고',
  });
});

test('buildManuscriptRequest: restaurant/v2 는 맛집2 엔드포인트를 씀', () => {
  const result = buildManuscriptRequest('restaurant/v2', '송도맛집', 'restaurant', '', undefined, {
    businessName: '이터스 현대프리미엄아울렛송도점',
    blogName: '제이제이',
  });

  assert.equal(result.url, 'http://localhost:8000/generate/restaurant/v2');
  assert.equal(result.body.business_name, '이터스 현대프리미엄아울렛송도점');
  assert.equal(result.body.blog_name, '제이제이');
});

test('buildManuscriptRequest: 업체명을 안 주면 빈 문자열로 보내 생성기 자유 선택에 맡김', () => {
  const result = buildManuscriptRequest('restaurant/v1', '청라맛집', 'restaurant');

  assert.equal(result.body.business_name, '');
  assert.equal(result.body.blog_name, '');
});

test('buildManuscriptRequest: 기존 restaurant 는 글밥 엔드포인트 그대로이고 업체명을 안 보냄', () => {
  const result = buildManuscriptRequest('restaurant', '수원맛집', 'restaurant', '', undefined, {
    businessName: '무시돼야 함',
  });

  assert.equal(result.url, 'http://localhost:8000/generate/blog-filler-restaurant');
  assert.deepEqual(result.body, {
    service: 'restaurant',
    keyword: '수원맛집',
    ref: '',
  });
});

test('parseManuscriptContent: 맛집2 의 [제목] 접두어와 구분선을 걷어냄', () => {
  const raw = [
    '[제목] 일산 웨스턴돔 맛집 동경규카츠, 개인 화로에서 익혀 먹는 규카츠 정식',
    '------------------------------------------------------------',
    '',
    '평일 저녁, 친구와 웨스턴돔에서',
    '따뜻한 고기 한 접시를 찾았습니다.',
  ].join('\n');

  const { title, content } = parseManuscriptContent(raw, '일산웨스턴돔맛집');

  assert.equal(title, '일산 웨스턴돔 맛집 동경규카츠, 개인 화로에서 익혀 먹는 규카츠 정식');
  assert.ok(content.startsWith('평일 저녁, 친구와 웨스턴돔에서'));
  assert.ok(!content.includes('---'));
});

test('parseManuscriptContent: 맛집1 처럼 접두어 없는 원고는 그대로 둠', () => {
  const raw = [
    '보글보글 즉석떡볶이 나눠 먹기 좋은 부천 중동 맛집 추천',
    '',
    '떡볶이가 생각날 때마다 조용히 들르던',
  ].join('\n');

  const { title, content } = parseManuscriptContent(raw, '부천중동맛집');

  assert.equal(title, '보글보글 즉석떡볶이 나눠 먹기 좋은 부천 중동 맛집 추천');
  assert.equal(content, '떡볶이가 생각날 때마다 조용히 들르던');
});

test('parseManuscriptContent: 제목 줄이 비면 키워드를 제목으로 씀', () => {
  const { title } = parseManuscriptContent('\n본문만 있음', '청라맛집');

  assert.equal(title, '청라맛집');
});

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

test('findManuscriptRejection: 실제로 발행돼버린 거절문을 잡아냄', () => {
  const refusal = [
    '네이버 검색을 직접 실행할 수 있는 환경이 아니라서, 지침상 필수인 지식인,블로그,쇼핑 검색 검증을 완료할 수 없습니다.',
    '특히 메뉴별 가격, 실제 웨이팅 시간은 제공 자료에 없어 사실처럼 작성하면 안 됩니다.',
    '',
    '네이버 플레이스 링크 또는 메뉴판 사진을 주시면 완성 원고로 작성할 수 있습니다.',
  ].join('\n');

  assert.match(findManuscriptRejection(refusal) ?? '', /거절문/);
});

test('findManuscriptRejection: 정상 길이의 맛집 원고는 통과시킴', () => {
  const article = `${'부천 상동에서 초밥이 당길 때 자주 가는 집을 소개합니다. '.repeat(40)}`;

  assert.equal(findManuscriptRejection(article), undefined);
});

test('findManuscriptRejection: 거절 문구가 없어도 너무 짧으면 막음', () => {
  assert.match(findManuscriptRejection('짧은 본문입니다.') ?? '', /너무 짧음/);
});
