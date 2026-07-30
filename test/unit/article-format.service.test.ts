import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toSemanticHtml } from '../../src/services/article-format.service.js';

const naverHtml = [
  '<div>원주마사지 가격 코스와 선택 <strong style="color:#18715f;font-weight:800;">기준</strong></div>',
  '<br>',
  '<div>국민건강보험공단 통계를 보면 진료 인원이 많습니다.</div>',
  '<div>원주마사지도 어깨 결림을 풀기 위해 찾습니다.</div>',
  '<br>',
  '<blockquote style="border-left:4px solid #18715f;"><div style="font-weight:800;">1. 원주마사지 종류부터 구분하기</div></blockquote>',
  '<div>이미지1)</div>',
  '<br>',
  '<div>아로마, 스포츠, 건식, 풋 관리로 나뉩니다.</div>',
].join('');

test('toMarkdown: 소제목은 ## 로, 문단은 빈 줄로 구분해 변환함', () => {
  const md = toMarkdown(naverHtml);

  assert.ok(md.includes('## 1. 원주마사지 종류부터 구분하기'), md);
  assert.ok(md.includes('아로마, 스포츠, 건식, 풋 관리로 나뉩니다.'));
  assert.ok(md.includes('\n\n'));
});

test('toMarkdown: 이미지 마커를 마크다운 이미지로 치환함', () => {
  const md = toMarkdown(naverHtml, {
    imageUrls: ['https://cdn.example.com/1.png'],
    imageAltPrefix: '원주마사지',
  });

  assert.ok(md.includes('![원주마사지 1](https://cdn.example.com/1.png)'), md);
  assert.ok(!md.includes('이미지1)'));
});

test('toMarkdown: 강조 태그를 마크다운 볼드로 살림', () => {
  const md = toMarkdown(naverHtml);

  assert.ok(md.includes('**기준**'), md);
});

test('toMarkdown: 이미지 URL 이 없으면 마커 줄을 지움', () => {
  const md = toMarkdown(naverHtml);

  assert.ok(!md.includes('이미지1)'));
});

test('toSemanticHtml: div 덩어리를 h2/p 로 승격함', () => {
  const html = toSemanticHtml(naverHtml, { title: '원주마사지 가격 코스와 선택 기준', keyword: '원주마사지' });

  assert.ok(html.includes('<h2>1. 원주마사지 종류부터 구분하기</h2>'), html);
  assert.ok(html.includes('<p>아로마, 스포츠, 건식, 풋 관리로 나뉩니다.</p>'));
  assert.ok(!html.includes('<div>'));
});

test('toSemanticHtml: Article JSON-LD 스크립트를 붙임', () => {
  const html = toSemanticHtml(naverHtml, {
    title: '원주마사지 가격 코스와 선택 기준',
    keyword: '원주마사지',
    url: 'https://example.com/1',
  });

  assert.ok(html.includes('<script type="application/ld+json">'));
  assert.ok(html.includes('"@type": "Article"'));
});

test('toSemanticHtml: includeJsonLd=false 면 스크립트를 붙이지 않음', () => {
  const html = toSemanticHtml(naverHtml, {
    title: '제목',
    keyword: '원주마사지',
    includeJsonLd: false,
  });

  assert.ok(!html.includes('ld+json'));
});

/**
 * 네이버 파이프라인은 `이미지1)` 리터럴 마커를 쓰지만, 외부에서 들여온 원고는
 * 진짜 `<img>` / `<table>` 을 그대로 담고 있음. 예전 구현은 태그를 통째로 벗겨서
 * 이미지와 표가 조용히 사라졌음.
 */
const richHtml = [
  '<p>원주마사지는 원주에서 받는 손 기법 관리를 말합니다.</p>',
  '<figure><img src="https://cdn.example.com/room.png" alt="관리실 내부" />',
  '<figcaption>표기 시간에 상담이 포함되는지 본다</figcaption></figure>',
  '<h2>종류는 어떻게 다른가요?</h2>',
  '<table><thead><tr><th>종류</th><th>오일</th></tr></thead>',
  '<tbody><tr><td>스웨디시</td><td>사용</td></tr>',
  '<tr><td>타이</td><td>없음</td></tr></tbody></table>',
  '<p>오일을 쓰느냐가 첫 갈래입니다.</p>',
].join('');

test('toMarkdown: 실제 img 태그를 마크다운 이미지로 옮김', () => {
  const md = toMarkdown(richHtml);

  assert.ok(md.includes('![관리실 내부](https://cdn.example.com/room.png)'), md);
});

test('toMarkdown: figcaption 을 이미지 아래 캡션 줄로 남김', () => {
  const md = toMarkdown(richHtml);

  assert.ok(md.includes('표기 시간에 상담이 포함되는지 본다'), md);
});

test('toMarkdown: table 을 GFM 파이프 표로 옮김', () => {
  const md = toMarkdown(richHtml);

  assert.ok(md.includes('| 종류 | 오일 |'), md);
  assert.ok(md.includes('| --- | --- |'), md);
  assert.ok(md.includes('| 스웨디시 | 사용 |'), md);
  assert.ok(md.includes('| 타이 | 없음 |'), md);
});

test('toMarkdown: 표 안의 셀이 문단으로 흩어지지 않음', () => {
  const md = toMarkdown(richHtml);

  assert.ok(!/^스웨디시\s*$/m.test(md), md);
});

test('toSemanticHtml: img 와 table 을 그대로 살려 둠', () => {
  const html = toSemanticHtml(richHtml, { title: '원주마사지', keyword: '원주마사지' });

  assert.ok(html.includes('<img src="https://cdn.example.com/room.png"'), html);
  assert.ok(html.includes('<table>'), html);
  assert.ok(html.includes('<td>스웨디시</td>'), html);
});

test('toMarkdown: 이미지 마커 방식은 그대로 동작함', () => {
  const md = toMarkdown(naverHtml, {
    imageUrls: ['https://cdn.example.com/1.png'],
    imageAltPrefix: '원주마사지',
  });

  assert.ok(md.includes('![원주마사지 1](https://cdn.example.com/1.png)'), md);
});
