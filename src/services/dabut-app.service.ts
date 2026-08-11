import { createHmac, timingSafeEqual } from 'node:crypto';
import mongoose, { type Connection } from 'mongoose';
import { env } from '../config/env.js';
import { decryptStoredSecret } from '../lib/crypto/fernet.js';
import { logger } from '../lib/logging/logger.js';

const log = logger.child({ scope: 'DabutApp' });

/*
  dabut-backend 의 앱 DB(users / naver_accounts)를 그대로 읽는다.
  로그인·회원가입 자체는 dabut API 로 넘기고, 여기서는 토큰 검증과 계정 조회만 한다.
  발행 워커가 평문 비밀번호를 필요로 해서 password_enc 는 여기서 복호화한다.
*/

export interface DabutUser {
  id: string;
  username: string;
  label: string;
  isActive: boolean;
}

export interface DabutBlogAccount {
  id: string;
  name: string;
  loginId: string;
  blogId: string;
  category: string;
  group: string;
  memo: string;
  /** 계정에 묶인 인증 전화번호. 로그인 확인용으로 화면에서 복사해 쓴다. */
  mvpn: string;
  order: number;
  isActive: boolean;
  hasPassword: boolean;
}

export interface DabutJwtPayload {
  sub: string;
  username: string;
  exp: number;
}

/* 스케쥴러 본체는 별도 Mongo 를 쓰므로 dabut 앱 DB 는 두 번째 커넥션으로 붙인다. */
let connection: Connection | null = null;

const getConnection = async (): Promise<Connection> => {
  if (!env.DABUT_APP_MONGO_URI) {
    throw new Error('DABUT_APP_MONGO_URI 가 설정되지 않았습니다.');
  }
  if (!connection) {
    connection = mongoose.createConnection(env.DABUT_APP_MONGO_URI, {
      dbName: env.DABUT_APP_DB_NAME,
    });
    await connection.asPromise();
    log.info('mongo.connected', { db: env.DABUT_APP_DB_NAME });
  }
  return connection;
};

const usersCollection = async () => (await getConnection()).collection('users');

const naverAccountsCollection = async () => (await getConnection()).collection('naver_accounts');

export const isDabutAuthEnabled = (): boolean =>
  Boolean(env.JWT_SECRET && env.DABUT_APP_MONGO_URI);

const base64UrlDecode = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const base64UrlEncode = (value: Buffer): string =>
  value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * dabut 이 발급한 HS256 JWT 를 검증한다.
 * 라이브러리를 더 붙이지 않으려고 node:crypto 로 서명만 확인한다.
 */
export const verifyDabutToken = (token: string): DabutJwtPayload | null => {
  const secret = env.JWT_SECRET;
  if (!secret || !token) return null;

  const [headerPart, payloadPart, signaturePart] = token.split('.');
  if (!headerPart || !payloadPart || !signaturePart) return null;

  try {
    const header = JSON.parse(base64UrlDecode(headerPart).toString('utf-8'));
    if (header.alg !== 'HS256') return null;

    const expected = base64UrlEncode(
      createHmac('sha256', secret).update(`${headerPart}.${payloadPart}`).digest(),
    );
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(signaturePart);
    if (expectedBuffer.length !== actualBuffer.length) return null;
    if (!timingSafeEqual(expectedBuffer, actualBuffer)) return null;

    const payload = JSON.parse(base64UrlDecode(payloadPart).toString('utf-8')) as DabutJwtPayload;
    if (!payload.sub) return null;
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;

    return payload;
  } catch {
    return null;
  }
};

/** 다붓 토큰 기본 수명. 원고 생성 한 건이 최대 5분이라 그보다 넉넉하게만 잡는다. */
const SERVICE_TOKEN_TTL_SECONDS = 15 * 60;

/**
 * 스케쥴러가 다붓 API 를 사용자 자격으로 부르기 위한 단명 토큰을 만든다.
 *
 * 예약 잡은 며칠 뒤에 실행되므로 로그인 시점의 토큰을 잡에 실어두면 만료돼 있다.
 * JWT_SECRET 을 다붓과 공유하고 있어서 실행 직전에 새로 발급하는 쪽이 맞다.
 * 수명을 짧게 두는 이유는 이 토큰이 잡 페이로드나 로그에 남더라도
 * 오래 살아 있지 않게 하려는 것이다.
 */
export const signDabutServiceToken = (
  ownerId: string,
  ttlSeconds: number = SERVICE_TOKEN_TTL_SECONDS,
): string => {
  const secret = env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET 이 없어 다붓 토큰을 발급할 수 없습니다.');
  }
  if (!ownerId) {
    throw new Error('ownerId 가 없어 다붓 토큰을 발급할 수 없습니다.');
  }

  const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = base64UrlEncode(
    Buffer.from(
      JSON.stringify({
        sub: ownerId,
        exp: Math.floor(Date.now() / 1000) + ttlSeconds,
      }),
    ),
  );
  const signature = base64UrlEncode(
    createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
  );

  return `${header}.${payload}.${signature}`;
};

const toObjectId = (value: string): mongoose.Types.ObjectId | null => {
  try {
    return new mongoose.Types.ObjectId(value);
  } catch {
    return null;
  }
};

export const findDabutUser = async (userId: string): Promise<DabutUser | null> => {
  const objectId = toObjectId(userId);
  if (!objectId) return null;

  const doc = await (await usersCollection()).findOne({ _id: objectId });
  if (!doc) return null;

  return {
    id: String(doc._id),
    username: String(doc.username ?? ''),
    label: String(doc.label ?? ''),
    isActive: doc.is_active !== false,
  };
};

const toBlogAccount = (doc: Record<string, unknown>): DabutBlogAccount => ({
  id: String(doc._id),
  name: String(doc.name ?? ''),
  loginId: String(doc.login_id ?? ''),
  blogId: String(doc.blog_id ?? ''),
  category: String(doc.category ?? ''),
  group: String(doc.group ?? ''),
  memo: String(doc.memo ?? ''),
  mvpn: String(doc.mvpn ?? ''),
  order: Number(doc.order ?? 0),
  isActive: doc.is_active !== false,
  hasPassword: Boolean(doc.password_enc),
});

/** 로그인한 계정이 소유한 블로그 목록. 비밀번호는 담지 않는다. */
export const listDabutBlogAccounts = async (ownerId: string): Promise<DabutBlogAccount[]> => {
  const docs = await (await naverAccountsCollection())
    .find({ owner_id: ownerId })
    .sort({ order: 1, created_at: 1 })
    .toArray();

  return docs.map((doc) => toBlogAccount(doc as Record<string, unknown>));
};

/** 발행에 쓸 평문 크리덴셜. 소유자가 일치할 때만 내보낸다. */
export const resolveDabutBlogCredential = async (params: {
  ownerId: string;
  accountId: string;
}): Promise<{ loginId: string; password: string; blogId: string } | null> => {
  const objectId = toObjectId(params.accountId);
  if (!objectId) return null;

  const doc = await (await naverAccountsCollection()).findOne({
    _id: objectId,
    owner_id: params.ownerId,
  });
  if (!doc) return null;

  const stored = String(doc.password_enc ?? '');
  const password = decryptStoredSecret(stored, env.API_KEY_ENC_SECRET ?? '');
  if (!password) {
    log.warn('credential.decrypt.failed', { accountId: params.accountId });
    return null;
  }

  return {
    loginId: String(doc.login_id ?? ''),
    password,
    blogId: String(doc.blog_id ?? ''),
  };
};

/**
 * 다붓 계정이 등록해둔 provider API 키를 복호화해서 돌려준다.
 * `users.api_keys.{provider}` 는 dabut 이 Fernet(enc:v1:) 으로 암호화해서 저장한다.
 */
export const resolveOwnerApiKey = async (
  ownerId: string,
  provider: string,
): Promise<string | null> => {
  const objectId = toObjectId(ownerId);
  if (!objectId) return null;

  const doc = await (await usersCollection()).findOne({ _id: objectId });
  if (!doc) return null;

  const apiKeys = (doc.api_keys ?? {}) as Record<string, unknown>;
  const stored = apiKeys[provider];
  if (typeof stored !== 'string' || !stored) return null;

  const plain = decryptStoredSecret(stored, env.API_KEY_ENC_SECRET ?? '');
  if (!plain) {
    log.warn('owner.apikey.decrypt.failed', { ownerId, provider });
    return null;
  }

  return plain;
};

export const closeDabutApp = async (): Promise<void> => {
  if (connection) {
    await connection.close();
    connection = null;
  }
};
