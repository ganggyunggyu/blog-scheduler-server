import 'dotenv/config';
import type { ManuscriptType } from '../../src/services/manuscript.service';

/* ── 계정 ── */
export const TEST_ACCOUNT = {
  id: process.env.TEST_ID!,
  pw: process.env.TEST_PW!,
} as const;

/* ── 키워드 & 카테고리 매핑 ── */
export interface KeywordFixture {
  keyword: string;
  category: string;
  manuscriptType: ManuscriptType;
}

export const KEYWORDS = {
  스마일라식: { keyword: '스마일라식', category: '안과', manuscriptType: 'grok' as ManuscriptType },
  뱅갈고양이: { keyword: '뱅갈고양이', category: '애견', manuscriptType: 'pet' as ManuscriptType },
  한려담원: { keyword: '한려담원', category: '한려담원', manuscriptType: 'hanryeodamwon' as ManuscriptType },
  강아지산책: { keyword: '강아지 산책', category: '', manuscriptType: 'default' as ManuscriptType },
  일본어인사: { keyword: '일본어 인사', category: '', manuscriptType: 'keigo' as ManuscriptType },
} as const satisfies Record<string, KeywordFixture>;

/* ── 카테고리 테스트 케이스 ── */
export const CATEGORY_CASES: { keyword: string; expected: string }[] = [
  { keyword: KEYWORDS.스마일라식.keyword, expected: KEYWORDS.스마일라식.category },
  { keyword: KEYWORDS.뱅갈고양이.keyword, expected: KEYWORDS.뱅갈고양이.category },
  { keyword: KEYWORDS.한려담원.keyword, expected: KEYWORDS.한려담원.category },
];

/* ── 원고 테스트 케이스 ── */
export const MANUSCRIPT_CASES: { type: ManuscriptType; keyword: string; category?: string }[] = [
  { type: 'default', keyword: KEYWORDS.강아지산책.keyword },
  { type: 'pet', keyword: KEYWORDS.뱅갈고양이.keyword },
  { type: 'grok', keyword: KEYWORDS.스마일라식.keyword, category: KEYWORDS.스마일라식.category },
  { type: 'keigo', keyword: KEYWORDS.일본어인사.keyword },
  { type: 'hanryeodamwon', keyword: KEYWORDS.한려담원.keyword },
];

/* ── E2E 파이프라인 설정 ── */
export interface PipelineConfig {
  keyword: string;
  manuscriptType: ManuscriptType;
  blogId?: string;
  keywordCategoryOverride?: string;
}

export const PIPELINE_CASES: Record<string, PipelineConfig> = {
  안과: {
    keyword: KEYWORDS.스마일라식.keyword,
    manuscriptType: KEYWORDS.스마일라식.manuscriptType,
    keywordCategoryOverride: KEYWORDS.스마일라식.category,
  },
  애견: {
    keyword: KEYWORDS.뱅갈고양이.keyword,
    manuscriptType: KEYWORDS.뱅갈고양이.manuscriptType,
    keywordCategoryOverride: KEYWORDS.뱅갈고양이.category,
  },
  한려담원: {
    keyword: KEYWORDS.한려담원.keyword,
    manuscriptType: KEYWORDS.한려담원.manuscriptType,
    keywordCategoryOverride: KEYWORDS.한려담원.category,
  },
};

/* ── 상품 이미지 테스트 키워드 ── */
export const PRODUCT_IMAGE_KEYWORDS = {
  pet: KEYWORDS.뱅갈고양이.keyword,
  eye: '라식',
  hanryeodamwon: KEYWORDS.한려담원.keyword,
  unknown: '존재하지않는상품xyz',
} as const;

/* ── 잘못된 계정 (에러 테스트용) ── */
export const INVALID_ACCOUNT = {
  id: 'invalid_account_xyz',
  pw: 'wrong_password',
} as const;
