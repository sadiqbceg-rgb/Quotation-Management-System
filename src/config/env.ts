/**
 * Frontend environment configuration.
 *
 * Everything here ships in the browser bundle and is therefore PUBLIC.
 * No secret may ever be read through this module — see IMPLEMENTATION_PLAN.md §22.1.
 *
 * Validated at module load so a misconfigured deployment fails immediately with
 * an actionable message, rather than producing `undefined` inside a fetch URL.
 */

import { z } from 'zod';

const envSchema = z.object({
  VITE_GAS_ENDPOINT: z
    .string()
    .url('VITE_GAS_ENDPOINT must be a full https URL')
    .refine((value) => value.startsWith('https://'), 'VITE_GAS_ENDPOINT must use HTTPS'),
  VITE_APP_ENV: z.enum(['development', 'production']).default('development'),
});

export interface AppEnv {
  gasEndpoint: string;
  appEnv: 'development' | 'production';
  isProduction: boolean;
}

export class EnvironmentError extends Error {
  public override readonly name = 'EnvironmentError';
}

function readEnv(): AppEnv {
  // import.meta.env is typed loosely; treat it as unknown and let Zod narrow it.
  const raw = import.meta.env as Record<string, unknown>;

  const parsed = envSchema.safeParse({
    VITE_GAS_ENDPOINT: raw['VITE_GAS_ENDPOINT'],
    VITE_APP_ENV: raw['VITE_APP_ENV'],
  });

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new EnvironmentError(
      `Invalid frontend environment configuration:\n${details}\n\n` +
        'Copy .env.example to .env.local and set the missing values. ' +
        'See IMPLEMENTATION_PLAN.md §22.',
    );
  }

  return {
    gasEndpoint: parsed.data.VITE_GAS_ENDPOINT,
    appEnv: parsed.data.VITE_APP_ENV,
    isProduction: parsed.data.VITE_APP_ENV === 'production',
  };
}

let cached: AppEnv | null = null;

/**
 * Read the validated environment.
 *
 * Lazy rather than eager so that unit tests and Storybook-style rendering can
 * exercise components without a configured endpoint, while any code path that
 * genuinely needs the backend fails loudly.
 */
export function getEnv(): AppEnv {
  cached ??= readEnv();
  return cached;
}

/** Test-only reset so a suite can exercise different environment shapes. */
export function resetEnvCache(): void {
  cached = null;
}
