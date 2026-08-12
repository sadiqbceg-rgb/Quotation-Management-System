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
import { isValidSaudiVatNumber } from '@shared/validation-rules';

/**
 * The company's VAT registration number.
 *
 * Configuration, not content: it is declared here so that changing it is a
 * deployment change, and so that no component, no module under `shared/` and no
 * term template ever contains the literal. `VITE_COMPANY_VAT_NUMBER` overrides
 * it per environment.
 *
 * The backend holds the same value as the `COMPANY_VAT_NUMBER` Script Property
 * and is authoritative for generated documents; this copy exists so the term
 * preview can resolve `{{company.vatNumber}}` without a round trip.
 * `config.test.ts` asserts the two never drift apart.
 */
const DEFAULT_COMPANY_VAT_NUMBER = '313098686600003';

const envSchema = z.object({
  VITE_GAS_ENDPOINT: z
    .string()
    .url('VITE_GAS_ENDPOINT must be a full https URL')
    .refine((value) => value.startsWith('https://'), 'VITE_GAS_ENDPOINT must use HTTPS'),
  VITE_APP_ENV: z.enum(['development', 'production']).default('development'),
  VITE_COMPANY_VAT_NUMBER: z
    .string()
    .trim()
    .refine(isValidSaudiVatNumber, 'VITE_COMPANY_VAT_NUMBER must be 15 digits, starting and ending with 3')
    .default(DEFAULT_COMPANY_VAT_NUMBER),
});

export interface AppEnv {
  gasEndpoint: string;
  appEnv: 'development' | 'production';
  isProduction: boolean;
  /** Printed on the quotation and resolves `{{company.vatNumber}}`. */
  companyVatNumber: string;
}

export class EnvironmentError extends Error {
  public override readonly name = 'EnvironmentError';
}

function readEnv(): AppEnv {
  // import.meta.env is typed loosely; treat it as unknown and let Zod narrow it.
  const raw = import.meta.env as Record<string, unknown>;

  const configuredVat = raw['VITE_COMPANY_VAT_NUMBER'];

  const parsed = envSchema.safeParse({
    VITE_GAS_ENDPOINT: raw['VITE_GAS_ENDPOINT'],
    VITE_APP_ENV: raw['VITE_APP_ENV'],
    // An unset variable arrives as `undefined` or as the empty string depending
    // on how the build was invoked; both mean "use the default".
    VITE_COMPANY_VAT_NUMBER:
      typeof configuredVat === 'string' && configuredVat.trim().length > 0
        ? configuredVat
        : undefined,
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
    companyVatNumber: parsed.data.VITE_COMPANY_VAT_NUMBER,
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
