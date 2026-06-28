/**
 * Centralised, validated environment loader.
 *
 * Per AGENTS.md, all env values are read through one typed loader so
 * nothing else in the codebase calls process.env directly. This avoids
 * the common "missing env var crashes at request time" bug.
 *
 * If a required env value is missing or malformed the process exits
 * immediately - this is a startup-time failure, never a request-time
 * one, so the crash loop in the k8s pod is a clear "fix your secrets"
 * signal.
 */

import { z } from 'zod';
import path from 'path';
import dotenv from 'dotenv';

// Load `.env.local` first (developer overrides), then fall back to `.env`.
const cwd = process.cwd();
dotenv.config({ path: path.resolve(cwd, '.env.local') });
dotenv.config({ path: path.resolve(cwd, '.env') });

const envSchema = z.object({
  // --- Server ---
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),

  // --- Database ---
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB_NAME: z.string().min(1).default('linkedin-ai'),

  // --- AI services ---
  // Gemini is the only REQUIRED AI key. The DO Inference token is
  // optional - if missing we fall back to Gemini for message generation.
  GEMINI_API_KEY: z
    .string()
    .min(1, 'GEMINI_API_KEY is required (get one at https://aistudio.google.com/app/apikey)'),
  GEMINI_MODEL: z.string().min(1).default('gemini-3.1-pro'),

  DO_INFERENCE_TOKEN: z.string().optional().default(''),
  DO_INFERENCE_BASE_URL: z
    .string()
    .url()
    .default('https://inference.digitalocean.com/v1'),
  DO_INFERENCE_MODEL: z.string().min(1).default('gpt-oss-20b'),

  // --- CORS ---
  ALLOWED_ORIGINS: z
    .string()
    .default('*')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    ),

  // --- Rate limiting ---
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
});

function loadEnv(): z.infer<typeof envSchema> {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error(
      '[backend] Invalid environment configuration:\n' +
        parsed.error.errors
          .map((e) => `  - ${e.path.join('.') || '(root)'}: ${e.message}`)
          .join('\n'),
    );
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();

/** Convenience flag - is the DO Inference token configured? */
export const hasDoInference = (): boolean => env.DO_INFERENCE_TOKEN.length > 0;
