import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  TZ: z.string().default('Asia/Seoul'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_DB: z.coerce.number().default(0),
  REDIS_PASSWORD: z.string().optional(),

  MONGO_URI: z.string(),

  MANUSCRIPT_API_URL: z.string().default('http://localhost:8000'),
  IMAGE_API_URL: z.string().default('http://localhost:3939'),

  PLAYWRIGHT_HEADLESS: z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return value;
  }, z.boolean()).default(true),
  PLAYWRIGHT_SLOW_MO: z.coerce.number().default(100),
  PLAYWRIGHT_ACTION_TIMEOUT_MS: z.coerce.number().default(120000),
  PLAYWRIGHT_NAVIGATION_TIMEOUT_MS: z.coerce.number().default(120000),

  LEAD_TIME_MINUTES: z.coerce.number().default(60),
  SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 2),
  LOGIN_RATE_LIMIT: z.coerce.number().default(3),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().default(60),

  POSTS_PER_DAY: z.coerce.number().default(3),

  /*
    운영 UI 인증. dabut-backend 의 앱 계정(users)을 그대로 쓴다.
    JWT_SECRET 과 DABUT_APP_MONGO_URI 가 둘 다 있어야 인증이 켜진다.
    로그인·회원가입은 DABUT_API_URL 로 넘기고, 토큰 검증은 여기서 HS256 으로 한다.
  */
  JWT_SECRET: z.string().optional(),
  API_KEY_ENC_SECRET: z.string().optional(),
  DABUT_APP_MONGO_URI: z.string().optional(),
  DABUT_APP_DB_NAME: z.string().default('dabut_app'),
  DABUT_API_URL: z.string().default('http://localhost:8000'),

  /**
   * Bull Board(/admin/queues) 를 여는 Basic 인증 비밀번호.
   * 이 경로는 브라우저 UI 라 Bearer 를 못 싣어 전역 인증 훅에서 빠져 있다.
   * 안 넣으면 화면을 아예 닫는다. 배포된 채로 열려 있으면 잡을 지울 수 있다.
   */
  ADMIN_QUEUES_PASSWORD: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
export const parseEnv = (input: NodeJS.ProcessEnv): Env => envSchema.parse(input);
export const env = parseEnv(process.env);

process.env.TZ = env.TZ;
