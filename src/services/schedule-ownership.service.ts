/**
 * 스케쥴은 owner_id 를 들고 있지 않고 accountId(네이버 로그인 아이디)만 들고 있다.
 * 그래서 소유권은 "로그인한 계정이 dabut 에 등록해둔 네이버 계정의 loginId 집합"으로 판단한다.
 * dabut 연동이 꺼져 있으면 테넌트 개념 자체가 없으므로 스코프를 걸지 않는다.
 */

/** 네이버 로그인 아이디는 대소문자를 가리지 않아서 비교 전에 소문자로 맞춘다. */
export const normalizeAccountId = (value?: string | null): string =>
  (value ?? '').trim().toLowerCase();

export const buildOwnedAccountIds = (accounts: Array<{ loginId?: string | null }>): string[] => [
  ...new Set(accounts.map(({ loginId }) => normalizeAccountId(loginId)).filter(Boolean)),
];

export const isOwnedAccountId = (ownedAccountIds: string[], accountId?: string | null): boolean => {
  const normalized = normalizeAccountId(accountId);
  if (!normalized) return false;
  return ownedAccountIds.includes(normalized);
};

/** null 은 "스코프 없음"이다. 스코프가 없으면 예전처럼 전부 보여준다. */
export const isVisibleSchedule = (
  ownedAccountIds: string[] | null,
  accountId?: string | null,
): boolean => ownedAccountIds === null || isOwnedAccountId(ownedAccountIds, accountId);

/** 목록 조회에 쓸 accountId 후보. 요청이 특정 계정을 찍어도 소유한 것만 남긴다. */
export const resolveQueryAccountIds = (
  ownedAccountIds: string[],
  requestedAccountId?: string,
): string[] => {
  if (!requestedAccountId) return ownedAccountIds;

  const requested = normalizeAccountId(requestedAccountId);
  return ownedAccountIds.filter((accountId) => accountId === requested);
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 저장된 accountId 의 대소문자가 dabut 쪽과 달라도 걸리도록 정규식으로 넘긴다. */
export const toAccountIdMatchers = (accountIds: string[]): RegExp[] =>
  accountIds.map((accountId) => new RegExp(`^${escapeRegExp(accountId)}$`, 'i'));

export const resolveOwnedAccountScope = async (params: {
  authEnabled: boolean;
  ownerId: string;
  listAccounts: (ownerId: string) => Promise<Array<{ loginId?: string | null }>>;
}): Promise<string[] | null> => {
  const { authEnabled, ownerId, listAccounts } = params;

  if (!authEnabled) return null;
  if (!ownerId) return [];

  return buildOwnedAccountIds(await listAccounts(ownerId));
};
