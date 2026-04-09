import type { BrowserContext } from 'playwright';

type SessionCookies = Parameters<BrowserContext['addCookies']>[0];
type SessionCookie = SessionCookies[number];
type SessionCookieSameSite = SessionCookie extends { sameSite?: infer T } ? T : never;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isSameSite = (value: unknown): value is NonNullable<SessionCookieSameSite> =>
  value === 'Lax' || value === 'None' || value === 'Strict';

const normalizeSessionCookie = (cookie: unknown, index: number): SessionCookie => {
  const cookieLabel = `cookies[${index}]`;

  if (!isRecord(cookie)) {
    throw new TypeError(`${cookieLabel} must be an object`);
  }

  const {
    name,
    value,
    url,
    domain,
    path,
    expires,
    httpOnly,
    secure,
    sameSite,
  } = cookie;

  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError(`${cookieLabel}.name must be a non-empty string`);
  }

  if (typeof value !== 'string') {
    throw new TypeError(`${cookieLabel}.value must be a string`);
  }

  const optionalFields = {
    ...(typeof expires === 'number' ? { expires } : {}),
    ...(typeof httpOnly === 'boolean' ? { httpOnly } : {}),
    ...(typeof secure === 'boolean' ? { secure } : {}),
    ...(isSameSite(sameSite) ? { sameSite } : {}),
  };

  if (typeof url === 'string' && url.length > 0) {
    return {
      name,
      value,
      url,
      ...optionalFields,
    } satisfies SessionCookie;
  }

  if (typeof domain === 'string' && domain.length > 0 && typeof path === 'string' && path.length > 0) {
    return {
      name,
      value,
      domain,
      path,
      ...optionalFields,
    } satisfies SessionCookie;
  }

  throw new TypeError(`${cookieLabel} must include url or both domain and path`);
};

export const normalizeSessionCookies = (cookies: unknown[]): SessionCookies =>
  cookies.map((cookie, index) => normalizeSessionCookie(cookie, index));
