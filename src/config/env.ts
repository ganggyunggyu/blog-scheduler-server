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

  /* 운영 UI 인증. 설정하면 API 전체가 Bearer 토큰을 요구한다. 없으면 인증이 꺼진다. */
  WEB_AUTH_SECRET: z.string().optional(),
  WEB_USERS: z.string().optional(),

  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
export const parseEnv = (input: NodeJS.ProcessEnv): Env => envSchema.parse(input);
export const env = parseEnv(process.env);

process.env.TZ = env.TZ;
