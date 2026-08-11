import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertRestaurantPlan,
  buildRestaurantPlanItems,
  findDuplicateBusinessNames,
  findRegionMismatches,
  normalizeBusinessName,
  type RestaurantAccountPlan,
} from '../../src/services/restaurant-plan.service.js';

const buildPlan = (
  accountId: string,
  businessNames: string[],
  blogCharacter = '블루망고',
): RestaurantAccountPlan => ({
  accountId,
  region: '경기남부(수원/용인/분당)',
  blogCharacter,
  items: buildRestaurantPlanItems(
    businessNames.map((businessName, index) => ({
      keyword: `수원상권${index}맛집`,
      businessName,
    })),
  ),
});

test('buildRestaurantPlanItems: 맛집1 / 맛집2 를 번갈아 배정함', () => {
  const items = buildRestaurantPlanItems([
    { keyword: '부천중동맛집', businessName: 'A식당' },
    { keyword: '부천상동맛집', businessName: 'B식당' },
    { keyword: '인천구월동맛집', businessName: 'C식당' },
    { keyword: '송도맛집', businessName: 'D식당' },
  ]);

  assert.deepEqual(
    items.map((item) => item.manuscriptType),
    ['restaurant/v1', 'restaurant/v2', 'restaurant/v1', 'restaurant/v2'],
  );
});

test('buildRestaurantPlanItems: startOffset 이 홀수면 맛집2 부터 시작함', () => {
  const items = buildRestaurantPlanItems(
    [
      { keyword: '서울강남역맛집', businessName: 'A식당' },
      { keyword: '서울성수동맛집', businessName: 'B식당' },
    ],
    1,
  );

  assert.deepEqual(
    items.map((item) => item.manuscriptType),
    ['restaurant/v2', 'restaurant/v1'],
  );
});

test('buildRestaurantPlanItems: 키워드와 업체명 공백을 정리해서 그대로 짝지어 둠', () => {
  const items = buildRestaurantPlanItems([
    { keyword: '  부천중동맛집 ', businessName: ' 유리즉석떡볶이 중동직영점 ' },
  ]);

  assert.equal(items[0].keyword, '부천중동맛집');
  assert.equal(items[0].businessName, '유리즉석떡볶이 중동직영점');
});

test('normalizeBusinessName: 공백/대소문자 차이는 같은 업체로 봄', () => {
  assert.equal(normalizeBusinessName(' 동경규카츠  일산점 '), '동경규카츠 일산점');
  assert.equal(normalizeBusinessName('Blue Bottle 성수'), normalizeBusinessName('blue  bottle 성수'));
});

test('findDuplicateBusinessNames: 계정이 달라도 같은 업체면 중복으로 잡음', () => {
  const duplicates = findDuplicateBusinessNames([
    buildPlan('acc1', ['A식당', 'B식당']),
    buildPlan('acc2', ['C식당', 'a식당 ']),
  ]);

  assert.deepEqual(duplicates, ['A식당']);
});

test('findDuplicateBusinessNames: 전부 다르면 빈 배열임', () => {
  const duplicates = findDuplicateBusinessNames([
    buildPlan('acc1', ['A식당', 'B식당']),
    buildPlan('acc2', ['C식당', 'D식당']),
  ]);

  assert.deepEqual(duplicates, []);
});

test('assertRestaurantPlan: 업체명이 겹치면 에러로 막음', () => {
  assert.throws(
    () => assertRestaurantPlan([buildPlan('acc1', ['A식당']), buildPlan('acc2', ['A식당'])]),
    /업체명 중복: A식당/,
  );
});

test('assertRestaurantPlan: 업체명이 비어 있으면 에러로 막음', () => {
  assert.throws(
    () => assertRestaurantPlan([buildPlan('acc1', ['A식당', '  '])]),
    /업체명 미지정: acc1\/수원상권1맛집/,
  );
});

test('assertRestaurantPlan: 맛집2 캐릭터명이 목록 밖이면 에러로 막음', () => {
  assert.throws(
    () => assertRestaurantPlan([buildPlan('acc1', ['A식당'], '아무개')]),
    /맛집2 캐릭터명이 목록에 없음: acc1=아무개/,
  );
});

test('assertRestaurantPlan: 정상 플랜은 통과함', () => {
  assert.doesNotThrow(() =>
    assertRestaurantPlan([
      buildPlan('acc1', ['A식당', 'B식당'], '블루망고'),
      buildPlan('acc2', ['C식당', 'D식당'], '제이제이'),
    ]),
  );
});

test('findRegionMismatches: 담당 권역 밖 상권 키워드를 잡아냄', () => {
  const seoulPlan: RestaurantAccountPlan = {
    accountId: 'e4f-l',
    region: '서울 강북',
    blogCharacter: '사랑채',
    items: buildRestaurantPlanItems([
      { keyword: '홍대맛집', businessName: '무세이' },
      { keyword: '수원인계동맛집', businessName: '쏘삼208' },
    ]),
  };

  assert.deepEqual(findRegionMismatches([seoulPlan]), [
    { accountId: 'e4f-l', region: '서울 강북', keyword: '수원인계동맛집' },
  ]);
});

test('findRegionMismatches: 권역 안 키워드만 있으면 빈 배열', () => {
  assert.deepEqual(findRegionMismatches([buildPlan('acc1', ['A식당', 'B식당'])]), []);
});

test('assertRestaurantPlan: 블로그 하나가 다른 권역 글을 섞으면 에러로 막음', () => {
  const mixed: RestaurantAccountPlan = {
    accountId: 'e4f-l',
    region: '서울 강북',
    blogCharacter: '사랑채',
    items: buildRestaurantPlanItems([{ keyword: '대구동성로맛집', businessName: '목마식당' }]),
  };

  assert.throws(() => assertRestaurantPlan([mixed]), /권역 밖 키워드: e4f-l\(서울 강북\)\/대구동성로맛집/);
});
