import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/crm'),
  REDIS_URL: z.string().optional(),
  JWT_SECRET: z.string().min(16).default('dev-only-secret-change-me'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().default(30),
  BCRYPT_ROUNDS: z.coerce.number().default(12),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().default(10),
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().default('NimbusCRM <no-reply@localhost>'),
  RATE_LIMIT_MAX: z.coerce.number().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().default(20),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
});

export type Config = z.infer<typeof Env>;

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const cfg = Env.parse(process.env);
  if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET === 'dev-only-secret-change-me') {
    throw new Error('JWT_SECRET must be set in production');
  }
  return { ...cfg, ...overrides };
}
