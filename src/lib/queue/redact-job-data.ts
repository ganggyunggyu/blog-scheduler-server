/**
 * Bull Board 화면에 뿌릴 잡 데이터에서 비밀번호를 지운다.
 *
 * 워커가 네이버에 직접 로그인해야 해서 잡 페이로드의 평문 비밀번호는 없앨 수 없다.
 * 그런데 /admin/queues 는 인증 훅의 공개 목록에 있어 누구나 열 수 있다.
 * 저장을 바꾸는 대신 화면에 나가는 사본에서만 가린다.
 */

const SECRET_KEYS = new Set(['password', 'accountPassword', 'pw']);
const MASK = '***';

export const redactJobData = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(redactJobData);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    if (SECRET_KEYS.has(key) && typeof item === 'string' && item.length > 0) {
      return [key, MASK] as const;
    }
    return [key, redactJobData(item)] as const;
  });

  return Object.fromEntries(entries);
};
