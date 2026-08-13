/**
 * The health endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHO ASKS, AND WHY IT IS PUBLIC
 * ---------------------------------------------------------------------------
 * This is the one action besides `auth.login` that needs no session, because it
 * is what an operator calls to find out whether a deployment is alive and
 * configured — and if it required a token, a deployment too broken to issue one
 * could not be diagnosed at all.
 *
 * ---------------------------------------------------------------------------
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * ---------------------------------------------------------------------------
 * It reports **names and booleans, never values**. A missing property is named
 * so an operator can fix it in one pass; a present one is reported only as
 * present. Nothing here may ever return a secret, a Drive id, a spreadsheet id,
 * an email address or a quotation number, and a test asserts that over the
 * whole payload (§19.7).
 *
 * The reachability probes are opt-in for the same reason they are useful: each
 * one costs a real Drive or Sheets round trip, so an unauthenticated caller
 * must not be able to make the deployment do that work by asking repeatedly.
 * Only a signed-in caller gets them.
 */

import {
  OPTIONAL_PROPERTIES,
  REQUIRED_PROPERTIES,
  isFullyConfigured,
  missingProperties,
  requireProperty,
} from '../config/properties';

/** Bumped when the request or response envelope changes shape. */
export const API_VERSION = '1.0.0';

export type ProbeState = 'ok' | 'unreachable' | 'not-configured';

export interface HealthPayload {
  status: 'ok';
  /** True when every REQUIRED property is set. */
  configured: boolean;
  /** Names of the missing required properties. Never a value. */
  missing: string[];
  /** Which optional properties are overridden, by NAME only. */
  overridden: string[];
  version: string;
  serverTime: string;
  /** Present only for a signed-in caller — see the note above. */
  probes?: {
    drive: ProbeState;
    sheets: ProbeState;
  };
}

export interface HealthOptions {
  /**
   * Run the Drive and Sheets reachability probes.
   *
   * The router passes `true` only when the caller is authenticated, so an
   * anonymous request cannot make the deployment spend quota.
   */
  includeProbes?: boolean;
  /** Injected so a test can exercise a probe without a Google service. */
  probeDrive?: () => void;
  probeSheets?: () => void;
}

/** Optional properties that have been set, by name. Never their values. */
function overriddenOptionalProperties(): string[] {
  const store = PropertiesService.getScriptProperties().getProperties();

  return OPTIONAL_PROPERTIES.filter((name) => {
    const value = store[name];
    return value !== undefined && value.trim().length > 0;
  });
}

function probe(run: () => void, configuredProperty: () => string): ProbeState {
  try {
    configuredProperty();
  } catch {
    // Not configured is a different answer from unreachable, and an operator
    // needs to tell them apart: one is a Script Property, the other is a
    // permission or an outage.
    return 'not-configured';
  }

  try {
    run();
    return 'ok';
  } catch {
    return 'unreachable';
  }
}

function defaultDriveProbe(): void {
  // The cheapest call that proves the identity can actually reach the archive.
  DriveApp.getFolderById(requireProperty('DRIVE_ROOT_FOLDER_ID')).getName();
}

function defaultSheetsProbe(): void {
  SpreadsheetApp.openById(requireProperty('TRACKING_SPREADSHEET_ID')).getName();
}

/**
 * The health payload.
 *
 * Never throws: a deployment that is too broken to answer this is a deployment
 * an operator cannot diagnose remotely.
 */
export function healthPayload(options: HealthOptions = {}): HealthPayload {
  const payload: HealthPayload = {
    status: 'ok',
    configured: isFullyConfigured(),
    missing: missingProperties(),
    overridden: overriddenOptionalProperties(),
    version: API_VERSION,
    serverTime: new Date().toISOString(),
  };

  if (options.includeProbes !== true) return payload;

  payload.probes = {
    drive: probe(options.probeDrive ?? defaultDriveProbe, () =>
      requireProperty('DRIVE_ROOT_FOLDER_ID'),
    ),
    sheets: probe(options.probeSheets ?? defaultSheetsProbe, () =>
      requireProperty('TRACKING_SPREADSHEET_ID'),
    ),
  };

  return payload;
}

/**
 * Every property name the deployment knows about, required first.
 *
 * Used by `RUNBOOK.md`'s setup step and by the deployment checklist, so the
 * list an operator works from is the list the code actually reads rather than
 * one copied into a document and left to rot.
 */
export function configurationReport(): {
  required: Array<{ name: string; set: boolean }>;
  optional: Array<{ name: string; overridden: boolean }>;
} {
  const missing = missingProperties();
  const overridden = overriddenOptionalProperties();

  return {
    required: REQUIRED_PROPERTIES.map((name) => ({ name, set: !missing.includes(name) })),
    optional: OPTIONAL_PROPERTIES.map((name) => ({
      name,
      overridden: overridden.includes(name),
    })),
  };
}
