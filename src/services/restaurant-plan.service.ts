/**
 * 맛집 자동발행 플랜 빌더.
 *
 * 대윤기획 요구사항이 코드로 강제돼야 하는 부분만 담음.
 * - 맛집1 / 맛집2 원고를 번갈아 쓴다.
 * - 블로그 하나는 같은 권역만 쓴다(권역 = 계정별 고정).
 * - 업체명은 전체 플랜에서 한 번도 겹치면 안 된다.
 *
 * 업체명을 비워두면 dabut 쪽 `resolve_restaurant_ref` 가 키워드만 보고 알아서
 * 업체를 고르는데, 이러면 같은 상권 키워드가 계속 같은 식당으로 수렴함
 * (실제로 "식당 똑같은 애만 적음" 컴플레인이 여기서 나옴). 그래서 업체명을
 * 비운 항목은 아예 플랜 검증에서 막음.
 */

export const RESTAURANT_MANUSCRIPT_TYPES = ['restaurant/v1', 'restaurant/v2'] as const;

export type RestaurantManuscriptType = (typeof RESTAURANT_MANUSCRIPT_TYPES)[number];

/** 맛집2 프롬프트가 인정하는 캐릭터명. 계정마다 하나로 고정해서 화자가 안 흔들리게 함. */
export const RESTAURANT_BLOG_CHARACTERS = [
  '블루망고',
  '제이제이',
  '삼남매',
  '사랑채',
  '호이호이',
  '바글바글',
] as const;

export type RestaurantBlogCharacter = (typeof RESTAURANT_BLOG_CHARACTERS)[number];

export interface RestaurantTarget {
  keyword: string;
  businessName: string;
}

export interface RestaurantPlanItem {
  keyword: string;
  businessName: string;
  manuscriptType: RestaurantManuscriptType;
}

export interface RestaurantAccountPlan {
  accountId: string;
  region: string;
  blogCharacter: string;
  items: RestaurantPlanItem[];
}

/**
 * 대윤기획 규칙: 블로그 하나는 한 권역만 담당함.
 * 키워드가 그 권역 밖 상권을 가리키면 등록 단계에서 막기 위한 토큰표임.
 */
export const REGION_AREA_TOKENS: Record<string, string[]> = {
  '인천/부천': ['인천', '부천', '송도', '청라'],
  '서울': ['서울', '강남', '홍대', '성수', '여의도', '종로', '잠실', '연남', '을지로', '압구정', '광화문', '신촌', '마포', '서촌', '이태원', '건대'],
  '일산/파주': ['일산', '파주', '고양', '킨텍스', '정발산', '화정', '원흥', '헤이리', '문산', '운정'],
  '수원/동탄/광교/용인/분당': ['수원', '동탄', '광교', '용인', '분당', '판교', '기흥', '수지', '정자', '행궁'],
  '대구/포항/경산/구미/경주': ['대구', '포항', '경산', '구미', '경주', '동성로', '수성', '들안길', '앞산', '영일대', '죽도', '영남대', '인동', '원평', '황리단길'],
};

export const normalizeBusinessName = (name: string): string =>
  name.trim().replace(/\s+/g, ' ').toLowerCase();

export const findRegionMismatches = (
  plans: RestaurantAccountPlan[],
): Array<{ accountId: string; region: string; keyword: string }> =>
  plans.flatMap((plan) => {
    const tokens = REGION_AREA_TOKENS[plan.region];
    if (!tokens) {
      return [{ accountId: plan.accountId, region: plan.region, keyword: '(권역 토큰표 없음)' }];
    }

    return plan.items
      .filter((item) => !tokens.some((token) => item.keyword.includes(token)))
      .map((item) => ({ accountId: plan.accountId, region: plan.region, keyword: item.keyword }));
  });

export const buildRestaurantPlanItems = (
  targets: RestaurantTarget[],
  startOffset = 0,
): RestaurantPlanItem[] =>
  targets.map((target, index) => ({
    keyword: target.keyword.trim(),
    businessName: target.businessName.trim(),
    manuscriptType: (startOffset + index) % 2 === 0 ? 'restaurant/v1' : 'restaurant/v2',
  }));

export const findDuplicateBusinessNames = (plans: RestaurantAccountPlan[]): string[] => {
  const firstSeen = new Map<string, string>();
  const duplicates = new Set<string>();

  plans.forEach((plan) => {
    plan.items.forEach((item) => {
      const key = normalizeBusinessName(item.businessName);
      if (key.length === 0) {
        return;
      }

      const existing = firstSeen.get(key);
      if (existing) {
        duplicates.add(existing);
        return;
      }

      firstSeen.set(key, item.businessName);
    });
  });

  return [...duplicates];
};

export const assertRestaurantPlan = (plans: RestaurantAccountPlan[]): void => {
  const duplicates = findDuplicateBusinessNames(plans);
  if (duplicates.length > 0) {
    throw new Error(`업체명 중복: ${duplicates.join(', ')}`);
  }

  const mismatches = findRegionMismatches(plans);
  if (mismatches.length > 0) {
    const detail = mismatches.map((m) => `${m.accountId}(${m.region})/${m.keyword}`).join(', ');
    throw new Error(`권역 밖 키워드: ${detail}`);
  }

  const missingBusiness = plans.flatMap((plan) =>
    plan.items
      .filter((item) => item.businessName.length === 0)
      .map((item) => `${plan.accountId}/${item.keyword}`),
  );
  if (missingBusiness.length > 0) {
    throw new Error(`업체명 미지정: ${missingBusiness.join(', ')}`);
  }

  const invalidCharacters = plans
    .filter((plan) => !RESTAURANT_BLOG_CHARACTERS.includes(plan.blogCharacter as RestaurantBlogCharacter))
    .map((plan) => `${plan.accountId}=${plan.blogCharacter}`);
  if (invalidCharacters.length > 0) {
    throw new Error(`맛집2 캐릭터명이 목록에 없음: ${invalidCharacters.join(', ')}`);
  }
};
