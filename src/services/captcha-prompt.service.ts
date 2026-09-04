/**
 * 캡차 종류별 프롬프트. 바이로와 스케쥴러가 각자 들고 있던 것을 여기로 모은다.
 *
 * 세 종류는 푸는 방식이 다르다. 로그인은 영수증 이미지를 읽고 질문에 답하는 추론이고,
 * 카페 가입/생성은 왜곡된 글자를 그대로 옮겨 적는 OCR 이다. 그래서 후처리도 다르다.
 */

export const CAPTCHA_KINDS = ['login', 'cafe-join', 'cafe-create'] as const;

export type CaptchaKind = (typeof CAPTCHA_KINDS)[number];

export const isCaptchaKind = (value: unknown): value is CaptchaKind =>
  CAPTCHA_KINDS.includes(value as CaptchaKind);

const LOGIN_PROMPT = (question: string): string =>
  `이 이미지는 네이버 로그인 캡차로 나오는 가상 영수증(receipt)이다.
영수증에는 상호명, 주소, 전화번호, 품목명, 단가, 수량, 합계 등이 표 형식으로 적혀있다.

단계:
1. 영수증의 모든 텍스트를 머릿속으로 정확히 OCR 한다.
2. 질문을 분해한다. (예: "전화번호의 뒤에서 2번째 숫자" -> 전화번호 찾기 -> 끝에서 2번째 자릿수 추출)
3. 정답을 결정한다.

질문: "${question}"

- 숫자면 숫자만 (콤마, 원, 개 등 단위 제외).
- 도로명/품목명이면 그 단어만.
- 정확히 답을 모르면 가장 가능성 높은 추측 한 가지만.`;

const CAFE_JOIN_PROMPT = [
  '이미지에 보이는 네이버 카페 가입 보안문자만 정확히 읽어라.',
  '문자는 흰색 또는 밝은색으로 보이고, 배경 무늬는 무시한다.',
  '정답은 영문 알파벳 A-Z와 숫자 0-9 조합이다.',
  '왼쪽에서 오른쪽 순서대로 읽는다.',
  'I와 1, O와 0, B와 8, S와 5, Z와 2를 특히 조심해서 구분한다.',
  '출력은 한 줄로, 설명 없이 문자만 쓴다.',
  '공백, 따옴표, 문장부호는 쓰지 않는다.',
  '대소문자가 애매하면 이미지에 가까운 형태로 쓴다.',
].join('\n');

const CAFE_CREATE_PROMPT = [
  '이미지에 보이는 네이버 카페 만들기 보안문자(그림문자)를 정확히 읽어라.',
  '문자는 배경 사진 위에 겹쳐진 왜곡된 영문/숫자다.',
  'I와 1, O와 0, B와 8, S와 5, Z와 2를 조심해서 구분한다.',
  '출력은 한 줄, 설명 없이 문자만.',
  '공백, 따옴표, 문장부호는 쓰지 않는다.',
].join('\n');

export const buildCaptchaPrompt = (kind: CaptchaKind, question = ''): string => {
  if (kind === 'cafe-join') return CAFE_JOIN_PROMPT;
  if (kind === 'cafe-create') return CAFE_CREATE_PROMPT;
  return LOGIN_PROMPT(question);
};

/**
 * 카페 보안문자는 영숫자만 남긴다. 모델이 따옴표나 마침표를 붙여 오면 그대로
 * 입력해서 틀리기 때문이다. 로그인 답은 도로명처럼 한글이 정답일 수 있어 손대지 않는다.
 */
export const normalizeCaptchaAnswer = (kind: CaptchaKind, raw: string): string =>
  kind === 'login' ? raw.trim() : raw.replace(/[^0-9A-Za-z]/g, '').trim();

/** 로그인 캡차만 질문이 있어야 풀 수 있다. */
export const requiresQuestion = (kind: CaptchaKind): boolean => kind === 'login';
