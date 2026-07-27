import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeGeoArticle,
  buildArticleJsonLd,
  buildFaqJsonLd,
  buildLlmsTxt,
  extractFaqPairs,
} from '../../src/services/geo-optimizer.service.js';

const richHtml = [
  '<p>원주마사지는 원주 지역에서 받는 전신 관리 서비스를 말합니다.</p>',
  '<blockquote>가격보다 실제 관리 시간을 먼저 확인해야 합니다.</blockquote>',
  '<h3>원주마사지 가격은 얼마인가요?</h3>',
  '<p>평일 낮 기준 60분 코스가 5만 원, 90분 코스가 8만 원 선입니다. 주말에는 1만~3만 원 더 붙습니다.</p>',
  '<h3>관리 시간은 어떻게 확인하나요?</h3>',
  '<p>한국소비자원 자료에 따르면 표기 시간과 실제 시간이 10~20분 차이 나는 사례가 많습니다.</p>',
  '<h3>원주마사지 예약 전 확인할 점은?</h3>',
  '<p>부위별 추가금, 오일 종류, 주차 여부 3가지를 미리 물어보면 좋습니다.</p>',
].join('\n');

const poorHtml = [
  '<p>안녕하세요 오늘은 좋은 하루입니다 그냥 편하게 읽어주세요 어쩌구 저쩌구 계속 이야기가 이어집니다 특별한 정보는 없습니다 그래도 읽어주세요</p>',
  '<p>계속 비슷한 이야기를 늘어놓습니다 결론은 없습니다 그냥 흘러가는 문장입니다 여기까지 읽어주셔서 감사합니다</p>',
].join('\n');

test('analyzeGeoArticle: 통계/인용/질문형 소제목이 갖춰진 원고는 높은 점수를 받음', () => {
  const report = analyzeGeoArticle({
    title: '원주마사지 가격 코스와 선택 기준',
    html: richHtml,
    keyword: '원주마사지',
  });

  assert.ok(report.score >= 70, `기대 70점 이상, 실제 ${report.score}`);
  assert.equal(report.signals.find((s) => s.key === 'statistics')?.passed, true);
  assert.equal(report.signals.find((s) => s.key === 'quotation')?.passed, true);
  assert.equal(report.signals.find((s) => s.key === 'questionHeading')?.passed, true);
  assert.equal(report.signals.find((s) => s.key === 'citation')?.passed, true);
});

test('analyzeGeoArticle: 근거 없는 잡담형 원고는 낮은 점수와 개선안을 돌려줌', () => {
  const report = analyzeGeoArticle({
    title: '오늘의 일상',
    html: poorHtml,
    keyword: '원주마사지',
  });

  assert.ok(report.score < 50, `기대 50점 미만, 실제 ${report.score}`);
  assert.ok(report.suggestions.length > 0);
});

test('analyzeGeoArticle: 점수 구간에 맞는 grade 를 돌려줌', () => {
  const good = analyzeGeoArticle({
    title: '원주마사지 가격 코스와 선택 기준',
    html: richHtml,
    keyword: '원주마사지',
  });
  const bad = analyzeGeoArticle({ title: '오늘의 일상', html: poorHtml, keyword: '원주마사지' });

  assert.ok(['A', 'B'].includes(good.grade));
  assert.ok(['D', 'C'].includes(bad.grade));
});

test('extractFaqPairs: 질문형 소제목과 바로 뒤 본문을 Q/A 쌍으로 뽑음', () => {
  const pairs = extractFaqPairs(richHtml);

  assert.equal(pairs.length, 3);
  assert.equal(pairs[0].question, '원주마사지 가격은 얼마인가요?');
  assert.ok(pairs[0].answer.includes('60분 코스가 5만 원'));
});

test('extractFaqPairs: 질문형 소제목이 없으면 빈 배열을 돌려줌', () => {
  assert.deepEqual(extractFaqPairs(poorHtml), []);
});

test('extractFaqPairs: FAQ 문단 안의 "1) 질문?" 형식도 Q/A 로 뽑음', () => {
  const faqHtml = [
    '<blockquote style="font-weight:800;"><div>7. 자주 묻는 질문</div></blockquote>',
    '<div>1) 첫 방문은 몇 분이 적당한가요?</div>',
    '<br>',
    '<div>처음이라면 60분이 무난합니다.</div>',
    '<br>',
    '<div>2) 멍이 들면 효과가 좋은 것인가요?</div>',
    '<br>',
    '<div>아닙니다. 압박이 과했다는 신호일 수 있습니다.</div>',
  ].join('');

  const pairs = extractFaqPairs(faqHtml);

  assert.equal(pairs.length, 2);
  assert.equal(pairs[0].question, '첫 방문은 몇 분이 적당한가요?');
  assert.equal(pairs[0].answer, '처음이라면 60분이 무난합니다.');
  assert.equal(pairs[1].question, '멍이 들면 효과가 좋은 것인가요?');
});

test('buildArticleJsonLd: Article 스키마 필수 필드를 채움', () => {
  const jsonLd = JSON.parse(
    buildArticleJsonLd({
      title: '원주마사지 가격 코스와 선택 기준',
      html: richHtml,
      keyword: '원주마사지',
      url: 'https://blog.naver.com/sosoharu2026/1',
      authorName: '소소한 하루',
      publishedAt: '2026-07-27T12:00:00+09:00',
      imageUrls: ['https://cdn.example.com/1.png'],
    }),
  );

  assert.equal(jsonLd['@type'], 'Article');
  assert.equal(jsonLd.headline, '원주마사지 가격 코스와 선택 기준');
  assert.equal(jsonLd.author.name, '소소한 하루');
  assert.equal(jsonLd.datePublished, '2026-07-27T12:00:00+09:00');
  assert.deepEqual(jsonLd.image, ['https://cdn.example.com/1.png']);
  assert.ok(String(jsonLd.description).length > 0);
});

test('buildArticleJsonLd: KST offset 문자열을 UTC 로 변환하지 않고 그대로 유지함', () => {
  const jsonLd = JSON.parse(
    buildArticleJsonLd({
      title: '제목',
      html: richHtml,
      keyword: '원주마사지',
      publishedAt: '2026-07-27T12:00:00+09:00',
    }),
  );

  assert.ok(String(jsonLd.datePublished).endsWith('+09:00'));
});

test('buildFaqJsonLd: FAQPage 스키마로 Q/A 를 감쌈', () => {
  const jsonLd = JSON.parse(buildFaqJsonLd(extractFaqPairs(richHtml)));

  assert.equal(jsonLd['@type'], 'FAQPage');
  assert.equal(jsonLd.mainEntity.length, 3);
  assert.equal(jsonLd.mainEntity[0]['@type'], 'Question');
  assert.equal(jsonLd.mainEntity[0].acceptedAnswer['@type'], 'Answer');
});

test('buildFaqJsonLd: Q/A 가 없으면 빈 문자열을 돌려줌', () => {
  assert.equal(buildFaqJsonLd([]), '');
});

test('buildLlmsTxt: AI 크롤러용 요약 목록을 마크다운으로 만듦', () => {
  const txt = buildLlmsTxt({
    siteName: '소소한 하루',
    siteUrl: 'https://blog.naver.com/sosoharu2026',
    summary: '원주 지역 생활 정보를 정리하는 블로그',
    entries: [
      { title: '원주마사지 가격 코스와 선택 기준', url: 'https://blog.naver.com/sosoharu2026/1', summary: '가격대와 확인 항목' },
    ],
  });

  assert.ok(txt.startsWith('# 소소한 하루'));
  assert.ok(txt.includes('> 원주 지역 생활 정보를 정리하는 블로그'));
  assert.ok(txt.includes('- [원주마사지 가격 코스와 선택 기준](https://blog.naver.com/sosoharu2026/1): 가격대와 확인 항목'));
});
