import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getEnv, resetEnvCache } from './env';
import { isValidSaudiVatNumber } from '@shared/validation-rules';
import { emptyTokenContext, resolveTermTokens } from '@shared/term-tokens';

/**
 * The company VAT number is CONFIGURATION.
 *
 * It is configured twice — a build-time variable here, a `COMPANY_VAT_NUMBER`
 * Script Property on the backend — because the two run in different places and
 * `shared/` deliberately carries no company values. That split is only safe if
 * the two cannot drift, so the drift is asserted below rather than trusted to a
 * comment.
 */

const FRONTEND_CONFIG = 'src/config/env.ts';
const BACKEND_CONFIG = 'google-apps-script/src/config/properties.ts';

/** The two configuration modules are the only places the literal may appear. */
const CONFIG_FILES = [FRONTEND_CONFIG, BACKEND_CONFIG];

function sourceFiles(): string[] {
  const roots = ['src', 'shared', 'google-apps-script/src'];
  const found: string[] = [];

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue;
        walk(path);
        continue;
      }
      if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) found.push(path);
    }
  }

  for (const root of roots) walk(root);
  return found;
}

beforeEach(() => {
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

/* -------------------------------------------------------------------------- */

describe('the endpoint', () => {
  it('is read from the environment', () => {
    expect(getEnv().gasEndpoint).toMatch(/^https:\/\//);
  });

  it('refuses a non-HTTPS endpoint', () => {
    vi.stubEnv('VITE_GAS_ENDPOINT', 'http://example.invalid/exec');
    resetEnvCache();

    expect(() => getEnv()).toThrowError(/VITE_GAS_ENDPOINT/);
  });
});

describe('the company VAT number', () => {
  it('is configured and well formed', () => {
    expect(isValidSaudiVatNumber(getEnv().companyVatNumber)).toBe(true);
  });

  it('accepts a valid override from the environment', () => {
    vi.stubEnv('VITE_COMPANY_VAT_NUMBER', '300000000000003');
    resetEnvCache();

    expect(getEnv().companyVatNumber).toBe('300000000000003');
  });

  it('treats a blank variable as "use the configured value"', () => {
    const configured = getEnv().companyVatNumber;

    vi.stubEnv('VITE_COMPANY_VAT_NUMBER', '   ');
    resetEnvCache();

    expect(getEnv().companyVatNumber).toBe(configured);
  });

  it('refuses a malformed override rather than printing it on a quotation', () => {
    vi.stubEnv('VITE_COMPANY_VAT_NUMBER', '12345');
    resetEnvCache();

    expect(() => getEnv()).toThrowError(/VITE_COMPANY_VAT_NUMBER/);
  });
});

describe('where the number is allowed to live', () => {
  it('matches the value the backend is configured with', () => {
    const configured = getEnv().companyVatNumber;
    const backend = readFileSync(BACKEND_CONFIG, 'utf8');

    // Both sides must carry the same number; the backend is authoritative for
    // generated documents, this copy only feeds the on-screen preview.
    expect(backend).toContain(configured);
  });

  it('appears in no component, no shared module and no term template', () => {
    const configured = getEnv().companyVatNumber;

    const offenders = sourceFiles().filter(
      (file) =>
        !CONFIG_FILES.includes(file.split('\\').join('/')) &&
        readFileSync(file, 'utf8').includes(configured),
    );

    expect(offenders).toEqual([]);
  });
});

describe('{{company.vatNumber}} resolution', () => {
  it('resolves to the configured number', () => {
    const configured = getEnv().companyVatNumber;

    const result = resolveTermTokens('VAT Registration No. {{company.vatNumber}}', {
      ...emptyTokenContext(),
      companyVatNumber: configured,
    });

    expect(result.text).toBe(`VAT Registration No. ${configured}`);
    expect(result.unknownTokens).toEqual([]);
  });

  it('is no longer reported as an unfilled token', () => {
    const result = resolveTermTokens('{{company.vatNumber}}', {
      ...emptyTokenContext(),
      companyVatNumber: getEnv().companyVatNumber,
    });

    expect(result.emptyTokens).toEqual([]);
  });
});
