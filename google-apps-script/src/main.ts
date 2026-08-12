/**
 * Google Apps Script Web App entry point.
 *
 * ---------------------------------------------------------------------------
 * TRANSPORT
 * ---------------------------------------------------------------------------
 * Apps Script Web Apps cannot answer a CORS preflight and cannot set
 * `Access-Control-Allow-*` headers. Every call from the browser must therefore
 * be a CORS *simple request*: a POST with `Content-Type: text/plain;charset=utf-8`
 * carrying a JSON string. One endpoint, one `action` discriminator. The session
 * token travels in the body, because an `Authorization` header would trigger a
 * preflight. See IMPLEMENTATION_PLAN.md §15.2.
 *
 * ---------------------------------------------------------------------------
 * SECURITY
 * ---------------------------------------------------------------------------
 * This Web App is deployed with "Who has access: Anyone", so the URL is
 * PUBLICLY REACHABLE. The URL is not a secret and is not a security boundary.
 * The boundary is the session token plus the per-action access check performed
 * here, before any handler runs and before any Drive or Sheets access. See
 * §15.1 and §19.1.
 *
 * Authorization is declared in ONE place — the ACTIONS table — and enforced in
 * ONE place, `handlePost`. A handler must never authorise itself.
 */

import * as auth from './auth/handlers';
import { isTokenRevoked } from './auth/session';
import { nowSeconds, shouldRenew, issueToken, verifyToken } from './auth/token';
import { isFullyConfigured, missingProperties, requireProperty } from './config/properties';
import * as quotation from './quotation/handlers';
import { ApiError, type Caller, type ErrorCode, type HandlerContext } from './errors';
import * as users from './sheets/users-repository';

export const API_VERSION = '0.3.0';

/* -------------------------------------------------------------------------- */
/* Envelope                                                                   */
/* -------------------------------------------------------------------------- */

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
  /** Present when the session was silently renewed; the client swaps it in. */
  renewedToken?: string;
}

/* -------------------------------------------------------------------------- */
/* Access levels and the action table                                         */
/* -------------------------------------------------------------------------- */

/**
 * `public`        — no session required. Only health and login may be public.
 * `authenticated` — any signed-in, active user.
 * `Admin`         — Admin role only.
 */
export type AccessLevel = 'public' | 'authenticated' | 'Admin';

export type Handler = (payload: unknown, context: HandlerContext) => unknown;

export interface ActionDefinition {
  access: AccessLevel;
  handler: Handler;
}

/** The single source of truth for authorization (§19.2). */
export const ACTIONS: Record<string, ActionDefinition> = {
  health: {
    access: 'public',
    handler: () => healthPayload(),
  },

  'auth.login': {
    access: 'public',
    handler: auth.login,
  },
  'auth.logout': {
    access: 'authenticated',
    handler: auth.logout,
  },
  'auth.me': {
    access: 'authenticated',
    handler: auth.me,
  },
  'admin.createUser': {
    access: 'Admin',
    handler: auth.createUser,
  },

  'quotation.reserveNumber': {
    access: 'authenticated',
    handler: quotation.reserveNumber,
  },
  'quotation.save': {
    access: 'authenticated',
    handler: quotation.save,
  },
  'quotation.get': {
    access: 'authenticated',
    handler: quotation.get,
  },
  'quotation.list': {
    access: 'authenticated',
    handler: quotation.list,
  },
  'quotation.updateStatus': {
    access: 'authenticated',
    handler: quotation.updateStatus,
  },
};

function healthPayload(): Record<string, unknown> {
  return {
    status: 'ok',
    configured: isFullyConfigured(),
    // Names only — never values (§19.7).
    missing: missingProperties(),
    version: API_VERSION,
    serverTime: new Date().toISOString(),
  };
}

/* -------------------------------------------------------------------------- */
/* Caller resolution                                                          */
/* -------------------------------------------------------------------------- */

export type CallerFailure = 'missing' | 'invalid' | 'expired';

export type CallerResult = { ok: true; caller: Caller } | { ok: false; reason: CallerFailure };

/**
 * Resolve the caller from the request token.
 *
 * Four independent checks, all required. Signature and expiry come from the
 * token itself; revocation and the account's current state must be looked up,
 * because both can change after a token was issued — a signed-out or
 * deactivated user's existing token has to stop working immediately (§18.3).
 */
export function resolveCaller(rawToken: string | undefined): CallerResult {
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return { ok: false, reason: 'missing' };
  }

  const now = nowSeconds();
  const verified = verifyToken(rawToken, requireProperty('SESSION_HMAC_SECRET'), now);

  if (!verified.ok) {
    return { ok: false, reason: verified.reason === 'expired' ? 'expired' : 'invalid' };
  }

  const payload = verified.payload;

  if (isTokenRevoked(payload.jti, now)) {
    return { ok: false, reason: 'expired' };
  }

  const record = users.findByEmail(payload.sub);
  if (record === null || !record.active) {
    return { ok: false, reason: 'invalid' };
  }

  return {
    ok: true,
    // The role comes from the SHEET, not from the token: a role changed after
    // issue must take effect at once, and a forged claim must never be trusted.
    caller: { email: record.email, role: record.role, jti: payload.jti, exp: payload.exp },
  };
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
  return jsonOutput({
    ok: false,
    requestId,
    error:
      error.fields === undefined
        ? { code: error.code, message: error.message }
        : { code: error.code, message: error.message, fields: error.fields },
  });
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
  // Every ApiRequest field is optional and `unknown`; each is validated below.
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
    let renewedToken: string | undefined;

    if (definition.access !== 'public') {
      const resolved = resolveCaller(asString(request.token));

      if (!resolved.ok) {
        throw new ApiError(
          resolved.reason === 'missing'
            ? 'AUTH_REQUIRED'
            : resolved.reason === 'expired'
              ? 'AUTH_EXPIRED'
              : 'AUTH_INVALID',
          'Authentication is required.',
        );
      }

      caller = resolved.caller;

      if (definition.access === 'Admin' && caller.role !== 'Admin') {
        throw new ApiError('FORBIDDEN', 'You do not have permission to perform this action.');
      }

      // Silent renewal, so an active session never expires mid-task (§18.3).
      if (shouldRenew(caller.exp)) {
        renewedToken = issueToken(
          caller.email,
          caller.role,
          requireProperty('SESSION_HMAC_SECRET'),
        );
      }
    }

    const data = definition.handler(request.payload, { requestId, caller });

    const body: ApiSuccessBody =
      renewedToken === undefined
        ? { ok: true, requestId, data }
        : { ok: true, requestId, data, renewedToken };

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
  return jsonOutput({ ok: true, requestId: 'health', data: healthPayload() });
}

/**
 * Operator-only entry points, exposed for the Apps Script editor.
 * They are NOT in the ACTIONS table and are unreachable over HTTP.
 */
export { provisionFirstAdmin, runProvisioning } from './auth/provisioning';
export { measurePasswordHashCost } from './auth/password';
