import { timingSafeEqual } from 'node:crypto';

/**
 * Bull Board(/admin/queues) 접근 판정.
 *
 * 이 경로는 브라우저로 여는 UI 라 Bearer 토큰을 못 싣고, 그래서 전역 인증 훅의
 * 공개 목록에 들어가 있다. 로컬에서만 쓸 때는 문제가 없었지만 배포하면 그대로
 * 공개된다. Bull Board 는 조회뿐 아니라 잡 삭제와 재시도도 되므로 막아야 한다.
 *
 * 비밀번호를 안 걸어두면 열어두지 않고 화면 자체를 닫는다.
 * 설정을 빠뜨린 채 배포했을 때 열린 채로 두는 쪽이 훨씬 위험하기 때문이다.
 */
export type AdminQueuesAccess = 'ok' | 'unauthorized' | 'disabled';

const BASIC_PREFIX = 'Basic ';

const isSameSecret = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

export const checkAdminQueuesAccess = (
  authorizationHeader: string | undefined,
  password: string | undefined,
): AdminQueuesAccess => {
  if (!password) return 'disabled';
  if (!authorizationHeader?.startsWith(BASIC_PREFIX)) return 'unauthorized';

  try {
    const decoded = Buffer.from(
      authorizationHeader.slice(BASIC_PREFIX.length),
      'base64',
    ).toString('utf-8');
    const supplied = decoded.slice(decoded.indexOf(':') + 1);
    return isSameSecret(supplied, password) ? 'ok' : 'unauthorized';
  } catch {
    return 'unauthorized';
  }
};
