/**
 * The health endpoint.
 *
 * ---------------------------------------------------------------------------
 * THE ASSERTION THAT MATTERS MOST
 * ---------------------------------------------------------------------------
 * "Reports names, never values." It is a public endpoint on a publicly
 * reachable deployment, so anything it leaks is leaked to anyone who finds the
 * URL. The last describe block asserts that over the WHOLE payload against
 * every configured secret, rather than field by field — a new field added later
 * is covered without anyone remembering to cover it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { configurationReport, healthPayload, API_VERSION } from './health';
import { REQUIRED_PROPERTIES } from '../config/properties';

let env: GasEnvironment;

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* A configured deployment                                                    */
/* -------------------------------------------------------------------------- */

describe('a fully configured deployment', () => {
  it('reports itself configured, with nothing missing', () => {
    const health = healthPayload();

    expect(health.status).toBe('ok');
    expect(health.configured).toBe(true);
    expect(health.missing).toEqual([]);
  });

  it('reports the API version, so a caller can tell which build answered', () => {
    expect(healthPayload().version).toBe(API_VERSION);
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reports the server time, which is how a clock skew is spotted', () => {
    const at = healthPayload().serverTime;

    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isNaN(Date.parse(at))).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* A misconfigured one                                                        */
/* -------------------------------------------------------------------------- */

describe('a misconfigured deployment', () => {
  it('names every missing property at once, not one per attempt', () => {
    // An operator fixing a deployment one error at a time is an operator
    // making four round trips through the Script Properties UI.
    env.properties.values.delete('DRIVE_ROOT_FOLDER_ID');
    env.properties.values.delete('TRACKING_SPREADSHEET_ID');

    const health = healthPayload();

    expect(health.configured).toBe(false);
    expect(health.missing.sort()).toEqual(['DRIVE_ROOT_FOLDER_ID', 'TRACKING_SPREADSHEET_ID']);
  });

  it('still answers rather than failing, because a broken deployment is what this is for', () => {
    for (const name of REQUIRED_PROPERTIES) env.properties.values.delete(name);

    expect(() => healthPayload()).not.toThrow();
    expect(healthPayload().status).toBe('ok');
    expect(healthPayload().missing.sort()).toEqual([...REQUIRED_PROPERTIES].sort());
  });

  it('treats a property set to whitespace as missing', () => {
    // "Set" in the Script Properties UI and actually empty is a real mistake,
    // and the failure it causes later is nowhere near the cause.
    env.properties.values.set('SESSION_HMAC_SECRET', '   ');

    expect(healthPayload().missing).toContain('SESSION_HMAC_SECRET');
  });
});

/* -------------------------------------------------------------------------- */
/* Optional properties                                                        */
/* -------------------------------------------------------------------------- */

describe('the optional properties', () => {
  it('reports which are overridden, by name', () => {
    env.properties.values.set('BRANCH_CODE', 'JUB');

    expect(healthPayload().overridden).toContain('BRANCH_CODE');
  });

  it('does not report one that is merely defaulted', () => {
    // A default is not an override, and an operator checking a deployment
    // needs to see which values this environment actually changed.
    expect(healthPayload().overridden).not.toContain('DOC_TYPE_CODE');
  });
});

/* -------------------------------------------------------------------------- */
/* The probes                                                                 */
/* -------------------------------------------------------------------------- */

describe('the reachability probes', () => {
  it('are absent unless asked for, so an anonymous caller cannot spend quota', () => {
    // `health` is public. Each probe is a real Drive or Sheets round trip, and
    // a public endpoint that does real work on demand is a free amplifier.
    expect(healthPayload().probes).toBeUndefined();
  });

  it('report ok when Drive and Sheets both answer', () => {
    const health = healthPayload({
      includeProbes: true,
      probeDrive: () => undefined,
      probeSheets: () => undefined,
    });

    expect(health.probes).toEqual({ drive: 'ok', sheets: 'ok' });
  });

  it('distinguishes unreachable from not-configured', () => {
    /*
     * These are different problems with different fixes: one is a Script
     * Property, the other is a permission or an outage. Reporting both as
     * "broken" sends an operator to the wrong place.
     */
    const unreachable = healthPayload({
      includeProbes: true,
      probeDrive: () => {
        throw new Error('TEST_ONLY Drive is unavailable.');
      },
      probeSheets: () => undefined,
    });
    expect(unreachable.probes?.drive).toBe('unreachable');

    env.properties.values.delete('DRIVE_ROOT_FOLDER_ID');
    const notConfigured = healthPayload({
      includeProbes: true,
      probeDrive: () => undefined,
      probeSheets: () => undefined,
    });
    expect(notConfigured.probes?.drive).toBe('not-configured');
  });

  it('reaches the real fakes when no probe is injected', () => {
    // Proves the default probes are wired to something real, rather than the
    // whole feature being exercised only through injected stubs.
    expect(healthPayload({ includeProbes: true }).probes).toEqual({
      drive: 'ok',
      sheets: 'ok',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* The configuration report                                                   */
/* -------------------------------------------------------------------------- */

describe('the configuration report', () => {
  it('lists every required property and whether it is set', () => {
    env.properties.values.delete('PASSWORD_PEPPER');

    const report = configurationReport();
    const names = report.required.map((entry) => entry.name);

    expect(names.sort()).toEqual([...REQUIRED_PROPERTIES].sort());
    expect(report.required.find((entry) => entry.name === 'PASSWORD_PEPPER')?.set).toBe(false);
    expect(report.required.find((entry) => entry.name === 'SESSION_HMAC_SECRET')?.set).toBe(true);
  });

  it('is generated from the code, so a runbook cannot drift from what is read', () => {
    // The point of exporting this: RUNBOOK.md's setup step works from the list
    // the deployment actually reads, not one copied into a document in 2026.
    expect(configurationReport().required).toHaveLength(REQUIRED_PROPERTIES.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing leaks                                                              */
/* -------------------------------------------------------------------------- */

describe('what the payload must never contain', () => {
  /** Every configured value, whatever it is. */
  function everyConfiguredValue(): string[] {
    return [...env.properties.values.values()].filter((value) => value.trim().length > 0);
  }

  it('carries no property VALUE anywhere in it, probes included', () => {
    env.properties.values.set('BRANCH_CODE', 'JUB');

    const serialised = JSON.stringify(
      healthPayload({
        includeProbes: true,
        probeDrive: () => undefined,
        probeSheets: () => undefined,
      }),
    );

    for (const value of everyConfiguredValue()) {
      expect(serialised.includes(value), `leaked "${value}"`).toBe(false);
    }
  });

  it('carries no property value in the configuration report either', () => {
    const serialised = JSON.stringify(configurationReport());

    for (const value of everyConfiguredValue()) {
      expect(serialised.includes(value), `leaked "${value}"`).toBe(false);
    }
  });

  it('names the missing properties without hinting at what a value looks like', () => {
    env.properties.values.delete('SESSION_HMAC_SECRET');
    const health = healthPayload();

    expect(health.missing).toEqual(['SESSION_HMAC_SECRET']);
    expect(JSON.stringify(health)).not.toMatch(/secret\s*[:=]\s*["'][A-Za-z0-9+/=_-]{8,}/i);
  });
});
