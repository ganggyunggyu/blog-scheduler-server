import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  TZ: z.string().default('Asia/Seoul'),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),

  MONGO_URI: z.string(),

  MANUSCRIPT_API_URL: z.string().default('http://localhost:8000'),

  PLAYWRIGHT_HEADLESS: z.preprocess((value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (normalized === 'true') return true;
      if (normalized === 'false') return false;
    }
    return value;
  }, z.boolean()).default(false),
  PLAYWRIGHT_SLOW_MO: z.coerce.number().default(100),

  LEAD_TIME_MINUTES: z.coerce.number().default(30),
  SESSION_TTL_SECONDS: z.coerce.number().default(60 * 60 * 2),
  LOGIN_RATE_LIMIT: z.coerce.number().default(3),
  LOGIN_RATE_WINDOW_SECONDS: z.coerce.number().default(60),

  POSTS_PER_DAY: z.coerce.number().default(3),
});

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

process.env.TZ = env.TZ;
