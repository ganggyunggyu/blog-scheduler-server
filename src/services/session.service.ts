import { redis } from '../config/redis';
import { env } from '../config/env';

const SESSION_PREFIX = 'session:';
const RATE_PREFIX = 'rate:login:';

interface CachedSession {
  cookies: unknown[];
  createdAt: number;
  lastUsed: number;
}

export const getSession = async (accountId: string): Promise<unknown[] | null> => {
  const key = `${SESSION_PREFIX}${accountId}`;
  const cached = await redis.get(key);

  if (!cached) return null;

  const session = JSON.parse(cached) as CachedSession;
  const ttlMs = env.SESSION_TTL_SECONDS * 1000;

  if (Date.now() - session.createdAt >= ttlMs) {
    return null;
  }

  session.lastUsed = Date.now();
  await redis.setex(key, env.SESSION_TTL_SECONDS, JSON.stringify(session));

  return session.cookies;
}

export const saveSession = async (accountId: string, cookies: unknown[]): Promise<void> => {
  const key = `${SESSION_PREFIX}${accountId}`;
  const session: CachedSession = {
    cookies,
    createdAt: Date.now(),
    lastUsed: Date.now(),
  };

  await redis.setex(key, env.SESSION_TTL_SECONDS, JSON.stringify(session));
}

export const invalidateSession = async (accountId: string): Promise<void> => {
  await redis.del(`${SESSION_PREFIX}${accountId}`);
}

export const checkRateLimit = async (accountId: string): Promise<boolean> => {
  const key = `${RATE_PREFIX}${accountId}`;
  const count = await redis.incr(key);

  if (count === 1) {
    await redis.expire(key, env.LOGIN_RATE_WINDOW_SECONDS);
  }

  return count <= env.LOGIN_RATE_LIMIT;
}
