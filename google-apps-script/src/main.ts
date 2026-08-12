/**
 * Google Apps Script Web App entry point.
 *
 * ---------------------------------------------------------------------------
 * TRANSPORT
 * ---------------------------------------------------------------------------
 * Apps Script Web Apps cannot answer a CORS preflight and cannot set
 * `Access-Control-Allow-*` headers, so the browser must send a CORS *simple
 * request*: a POST with `Content-Type: text/plain;charset=utf-8` carrying a
 * JSON string. One endpoint, one `action` discriminator. The session token
 * travels in the body, because an `Authorization` header would trigger a
 * preflight. See IMPLEMENTATION_PLAN.md §15.2.
 *
 * ---------------------------------------------------------------------------
 * SECURITY
 * ---------------------------------------------------------------------------
 * This Web App is deployed with "Who has access: Anyone", so the URL is
 * PUBLICLY REACHABLE. The URL is not a secret and is not a security boundary.
 * The boundary is the session token plus the per-action role check performed
 * here, before any Drive or Sheets access. See §15.1 and §19.1.
 *
 * Phase 01 establishes the router, the envelope and the role table. Phase 02
 * fills in `resolveCaller` with real token verification. The table exists now
 * so that authorization is slotted into an existing check rather than being
 * retrofitted onto handlers later, where one omission becomes an escalation.
 */

import { isFullyConfigured, missingProperties } from './config/properties';

export const API_VERSION = '0.1.0';

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_INVALID'
  | 'AUTH_EXPIRED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'VALIDATION_FAILED'
  | 'CONFIG_MISSING'
  | 'INTERNAL_ERROR';

interface ApiRequest {
  action?: unknown;
  token?: unknown;
  requestId?: unknown;
  payload?: unknown;
}

interface ApiFailureBody {
  ok: false;
  requestId: string;
  error: { code: ErrorCode; message: string; fields?: Record<string, string> };
}

interface ApiSuccessBody {
  ok: true;
  requestId: string;
  data: unknown;
}

export class ApiError extends Error {
  public readonly code: ErrorCode;
  public readonly fields: Record<string, string> | undefined;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.code = code;
    this.fields = fields;
  }
}

/* -------------------------------------------------------------------------- */
/* Roles and the action table                                                 */
/* -------------------------------------------------------------------------- */

export type Role = 'Admin' | 'User';
/** `public` means no session is required. Only health and login may be public. */
export type AccessLevel = Role | 'public';

export interface Caller {
  email: string;
  role: Role;
}

export interface HandlerContext {
  requestId: string;
  caller: Caller | null;
}

export type Handler = (payload: unknown, context: HandlerContext) => unknown;

export interface ActionDefinition {
  access: AccessLevel;
  handler: Handler;
}

/**
 * The single source of truth for authorization.
 *
 * Role checks live here and only here. A handler must never authorise itself —
 * that is how one forgotten check becomes a privilege escalation (§19.2).
 */
export const ACTIONS: Record<string, ActionDefinition> = {
  health: {
    access: 'public',
    handler: () => ({
      status: 'ok',
      configured: isFullyConfigured(),
      // Names only — never values (§19.7).
      missing: missingProperties(),
      version: API_VERSION,
      serverTime: new Date().toISOString(),
    }),
  },
};

/* -------------------------------------------------------------------------- */
/* Authentication hook (Phase 02)                                             */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the caller from the request token.
 *
 * PHASE 02 INTEGRATION POINT. Until then no non-public action exists, so a
 * request for one is refused rather than allowed through. Failing closed is
 * the only acceptable default for an endpoint that anyone can reach.
 */
export function resolveCaller(_token: string | undefined): Caller | null {
  return null;
}

/* -------------------------------------------------------------------------- */
/* Router                                                                     */
/* -------------------------------------------------------------------------- */

function jsonOutput(body: ApiSuccessBody | ApiFailureBody): GoogleAppsScript.Content.TextOutput {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function failure(requestId: string, error: ApiError): GoogleAppsScript.Content.TextOutput {
  const body: ApiFailureBody = {
    ok: false,
    requestId,
    error:
      error.fields === undefined
        ? { code: error.code, message: error.message }
        : { code: error.code, message: error.message, fields: error.fields },
  };
  return jsonOutput(body);
}

function parseRequest(raw: string | undefined): ApiRequest {
  if (raw === undefined || raw.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'Request body is empty.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError('VALIDATION_FAILED', 'Request body is not valid JSON.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('VALIDATION_FAILED', 'Request body must be a JSON object.');
  }
  // Every ApiRequest field is optional and `unknown`; the narrowing above is
  // enough. Each field is validated individually before use.
  return parsed;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function handlePost(raw: string | undefined): GoogleAppsScript.Content.TextOutput {
  let requestId = 'unknown';

  try {
    const request = parseRequest(raw);

    requestId = asString(request.requestId) ?? Utilities.getUuid();

    const action = asString(request.action);
    if (action === undefined) {
      throw new ApiError('VALIDATION_FAILED', 'Missing action.');
    }

    const definition = Object.prototype.hasOwnProperty.call(ACTIONS, action)
      ? ACTIONS[action]
      : undefined;
    if (definition === undefined) {
      // Deliberately does not echo the action back, to avoid reflecting input.
      throw new ApiError('VALIDATION_FAILED', 'Unknown action.');
    }

    let caller: Caller | null = null;

    if (definition.access !== 'public') {
      caller = resolveCaller(asString(request.token));
      if (caller === null) {
        throw new ApiError('AUTH_REQUIRED', 'Authentication is required.');
      }
      if (definition.access === 'Admin' && caller.role !== 'Admin') {
        throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.');
      }
    }

    const data = definition.handler(request.payload, { requestId, caller });

    const body: ApiSuccessBody = { ok: true, requestId, data };
    return jsonOutput(body);
  } catch (thrown: unknown) {
    if (thrown instanceof ApiError) {
      return failure(requestId, thrown);
    }

    const message = thrown instanceof Error ? thrown.message : String(thrown);

    if (message.indexOf('CONFIG_MISSING:') === 0) {
      return failure(
        requestId,
        new ApiError('CONFIG_MISSING', 'The application is not fully configured.'),
      );
    }

    // Detail stays in Cloud Logging; the client gets a generic message (§19.9).
    console.error(`[${requestId}] Unhandled error: ${message}`);
    return failure(requestId, new ApiError('INTERNAL_ERROR', 'An unexpected error occurred.'));
  }
}

/* -------------------------------------------------------------------------- */
/* Apps Script entry points                                                   */
/* -------------------------------------------------------------------------- */

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  return handlePost(e.postData?.contents);
}

/** GET exists only as a liveness probe. All real work goes through POST. */
export function doGet(): GoogleAppsScript.Content.TextOutput {
  const body: ApiSuccessBody = {
    ok: true,
    requestId: 'health',
    data: {
      status: 'ok',
      configured: isFullyConfigured(),
      missing: missingProperties(),
      version: API_VERSION,
      serverTime: new Date().toISOString(),
    },
  };
  return jsonOutput(body);
}
