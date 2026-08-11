/**
 * 원고 텍스트에서 "소제목" 줄을 판별한다.
 * 신규 발행 시 typeContentWithImages 가 이 패턴으로 이미지 위치를 정하고,
 * 이미 발행된 글의 이미지 백필도 같은 패턴으로 라이브 DOM에서 소제목을 찾는다.
 */
const SUBHEADING_PATTERNS = [/^\d+\.(?:\s|[가-힣a-zA-Z])/, /^【\d+】/, /^\[\d+\]/, /^▶\s*\d+/];

export const isSubheading = (line: string): boolean => {
  const trimmed = line.trim();
  return SUBHEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
};
