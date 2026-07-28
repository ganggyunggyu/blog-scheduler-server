import { createHmac, timingSafeEqual } from 'node:crypto';

/*
  운영 UI 전용 인증.
  배포해서 공개 URL 을 열 때만 필요해서, WEB_AUTH_SECRET 이 있을 때만 켜진다.
  로컬에서 curl 로 직접 부르던 기존 스킬 흐름은 secret 없이 그대로 동작한다.
*/

export interface WebUser {
  username: string;
  password: string;
  label?: string;
  role?: 'admin' | 'operator';
}

export interface WebAuthPayload {
  username: string;
  label: string;
  role: 'admin' | 'operator';
  exp: number;
}

const TOKEN_TTL_SECONDS = 60 * 60 * 12;

const base64UrlEncode = (input: Buffer | string): string =>
  Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const base64UrlDecode = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

export const getAuthSecret = (): string => process.env.WEB_AUTH_SECRET ?? '';

export const isWebAuthEnabled = (): boolean => Boolean(getAuthSecret());

export const listWebUsers = (): WebUser[] => {
  const raw = process.env.WEB_USERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as WebUser[]) : [];
  } catch {
    return [];
  }
};

const sign = (data: string, secret: string): string =>
  base64UrlEncode(createHmac('sha256', secret).update(data).digest());

export const issueToken = (user: WebUser): string => {
  const secret = getAuthSecret();
  const payload: WebAuthPayload = {
    username: user.username,
    label: user.label ?? user.username,
    role: user.role ?? 'operator',
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS,
  };

  const body = base64UrlEncode(JSON.stringify(payload));
  return `${body}.${sign(body, secret)}`;
};

export const verifyToken = (token: string): WebAuthPayload | null => {
  const secret = getAuthSecret();
  if (!secret || !token) return null;

  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  if (expectedBuffer.length !== actualBuffer.length) return null;
  if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(body).toString('utf-8')) as WebAuthPayload;
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
};

export const authenticate = (username: string, password: string): WebUser | null => {
  const matched = listWebUsers().find((user) => user.username === username);
  if (!matched) return null;

  const expected = Buffer.from(matched.password);
  const actual = Buffer.from(password);
  if (expected.length !== actual.length) return null;
  if (!timingSafeEqual(expected, actual)) return null;

  return matched;
};
