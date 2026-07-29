import './tds-schema-normalization.js';
import './tds-nested-schema-normalization.js';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  WEB_URL: z.string().url().default('http://localhost:3000'),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
  DEEPSEEK_MODEL: z.string().default('deepseek-chat'),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
  MAX_BUNDLE_FILES: z.coerce.number().int().min(1).max(250).default(100),
  OCR_MAX_PAGES: z.coerce.number().int().min(1).max(100).default(25),
  OCR_DPI: z.coerce.number().int().min(120).max(400).default(200)
});

export const env = envSchema.parse(process.env);
