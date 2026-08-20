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
import { runDailyBackup } from './backup/daily-backup';
import { nowSeconds, shouldRenew, issueToken, verifyToken } from './auth/token';
import { requireProperty } from './config/properties';
import { configurationReport, healthPayload, API_VERSION } from './monitoring/health';
import * as clients from './clients/handlers';
import * as items from './items/handlers';
import * as persons from './persons/handlers';
import * as quotation from './quotation/handlers';
import * as settings from './settings/handlers';
import * as terms from './terms/handlers';
import { ApiError, type Caller, type ErrorCode, type HandlerContext } from './errors';
import { checkRequestLimits, rateLimitError } from './security/rate-limiter';
import { parseRequestBody } from './security/sanitize';
import * as users from './sheets/users-repository';

/*
 * Re-exported so callers keep importing it from the router.
 *
 * It LIVES in `monitoring/health.ts`, which is the module that reports it —
 * one home for the number, rather than a constant here and a copy there that
 * drift apart the first time somebody bumps only one.
 */
export { API_VERSION };

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
  /*
   * User administration (§18.4 "Manage users": Admin only).
   *
   * `access: 'Admin'` here is the ONLY authorization these need. The router
   * applies it before the handler runs, so none of them re-checks the role —
   * a handler that authorises itself is how one forgotten check becomes an
   * escalation.
   *
   * `resetUserCredential` avoids the word "password" deliberately: the action
   * name is written into the audit sheet's Action column, and FORBIDDEN_IN_AUDIT
   * rejects /password/i so that a real one can never hide there.
   */
  'admin.listUsers': {
    access: 'Admin',
    handler: auth.listUsers,
  },
  'admin.resetUserCredential': {
    access: 'Admin',
    handler: auth.resetUserCredential,
  },
  'admin.setUserActive': {
    access: 'Admin',
    handler: auth.setUserActive,
  },
  'admin.setUserRole': {
    access: 'Admin',
    handler: auth.setUserRole,
  },

  /*
   * Deployment diagnostics — Admin only, and deliberately separate from
   * `health`.
   *
   * `health` is public, because a deployment too broken to issue a token still
   * has to be diagnosable remotely — so it must stay cheap. The reachability
   * probes cost a real Drive call and a real Sheets call each, and an anonymous
   * caller must not be able to make the deployment spend quota by asking
   * repeatedly. So they live here, behind the strongest access level.
   *
   * Used by RUNBOOK.md's setup verification and by the deployment checklist.
   */
  'admin.diagnostics': {
    access: 'Admin',
    handler: () => ({
      ...healthPayload({ includeProbes: true }),
      configuration: configurationReport(),
    }),
  },

  'quotation.reserveNumber': {
    access: 'authenticated',
    handler: quotation.reserveNumber,
  },
  'quotation.save': {
    access: 'authenticated',
    handler: quotation.save,
  },
  'quotation.discardDraft': {
    access: 'authenticated',
    handler: quotation.discardDraft,
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
  // Carries the generated PDF and DOCX as base64 in the body — the same
  // `text/plain` POST as everything else, because a second transport would
  // trigger a CORS preflight this Web App cannot answer (§15.2).
  'quotation.uploadToDrive': {
    access: 'authenticated',
    handler: quotation.uploadToDrive,
  },
  // The retry behind "tracking was not updated" (PRD §37). Separate from the
  // upload so fixing a spreadsheet row does not re-send two megabytes.
  'quotation.recordTracking': {
    access: 'authenticated',
    handler: quotation.recordTracking,
  },

  /*
   * Customer library (§40).
   *
   * `User` for read and write, matching `items.*` — the two are the same kind
   * of thing: a shared library that anyone producing a quotation maintains as
   * they work. Deactivation is Admin, because removing a customer from every
   * future picker is a decision about company data rather than about the
   * quotation someone happens to be writing.
   *
   * None of these touches a quotation. A quotation stores client VALUES, so
   * editing a customer here cannot reach one that already exists.
   */
  'clients.list': {
    access: 'authenticated',
    handler: clients.list,
  },
  'clients.create': {
    access: 'authenticated',
    handler: clients.create,
  },
  'clients.update': {
    access: 'authenticated',
    handler: clients.update,
  },
  'clients.deactivate': {
    access: 'Admin',
    handler: clients.deactivate,
  },

  /*
   * Company settings.
   *
   * `get` is `authenticated`: producing a quotation needs the VAT default, the
   * validity days and the closing paragraph, so a User must be able to read
   * them. `update` is Admin.
   *
   * These are DEFAULTS for the next quotation. Each quotation stores its own
   * rate and its own closing paragraph and is recomputed from those, so editing
   * a default here cannot change one that already exists.
   */
  'settings.get': {
    access: 'authenticated',
    handler: settings.get,
  },
  'settings.update': {
    access: 'Admin',
    handler: settings.update,
  },

  'items.list': {
    access: 'authenticated',
    handler: items.list,
  },
  'items.create': {
    access: 'authenticated',
    handler: items.create,
  },
  'items.update': {
    access: 'authenticated',
    handler: items.update,
  },
  'items.deactivate': {
    access: 'authenticated',
    handler: items.deactivate,
  },

  'terms.list': {
    access: 'authenticated',
    handler: terms.list,
  },
  'terms.create': {
    access: 'authenticated',
    handler: terms.create,
  },
  'terms.update': {
    access: 'authenticated',
    handler: terms.update,
  },
  'terms.deactivate': {
    access: 'authenticated',
    handler: terms.deactivate,
  },
  'terms.reorder': {
    access: 'authenticated',
    handler: terms.reorder,
  },
  // Admin only: it writes the company's real reference terms into the library.
  'admin.importReferenceTerms': {
    access: 'Admin',
    handler: terms.importReference,
  },

  /*
   * Authorized persons.
   *
   * Reading is `authenticated` — a User must be able to pick a signatory and
   * see the mark that will print on the quotation they are producing. Every
   * write, and the signature upload, is Admin only (§11.4).
   */
  'persons.list': {
    access: 'authenticated',
    handler: persons.list,
  },
  'persons.getSignature': {
    access: 'authenticated',
    handler: persons.getSignature,
  },
  'persons.create': {
    access: 'Admin',
    handler: persons.create,
  },
  'persons.update': {
    access: 'Admin',
    handler: persons.update,
  },
  'persons.deactivate': {
    access: 'Admin',
    handler: persons.deactivate,
  },
  'persons.uploadSignature': {
    access: 'Admin',
    handler: persons.uploadSignature,
  },
};

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

/**
 * The one place a request string becomes an object.
 *
 * Structural safety — prototype-pollution keys, nesting depth, payload size —
 * is enforced by `parseRequestBody` for EVERY action, before any handler runs.
 * A per-handler check is one the next handler will not have (§19.3).
 */
function parseRequest(raw: string | undefined): ApiRequest {
  if (raw === undefined || raw.length === 0) {
    throw new ApiError('VALIDATION_FAILED', 'Request body is empty.');
  }

  const parsed = parseRequestBody(raw);

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

    /*
     * Throttling, before authentication.
     *
     * Deliberate: verifying a token costs an HMAC and a sheet read, so a client
     * in a retry loop would spend the deployment's daily quota on rejecting its
     * own requests. The global window counts every action; the per-action
     * window needs a token and is applied to the expensive ones (§19.8).
     */
    const limit = checkRequestLimits(action, asString(request.token), nowSeconds());
    if (!limit.allowed) {
      throw rateLimitError(limit);
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
      /*
       * A typed error is an EXPECTED outcome, so it is not logged as an
       * incident — except when it carries a `detail`, which only the Drive
       * layer sets and which holds the reason Google gave. Without this the
       * client got "saving to Google Drive failed" and the server kept no
       * record of why.
       *
       * `detail` is never serialised: `failure()` builds the body from code,
       * message and fields only.
       */
      if (thrown.detail !== undefined) {
        console.error(`[${requestId}] ${thrown.code}: ${thrown.detail}`);
      }
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
export { installDailyBackupTrigger, removeDailyBackupTrigger } from './backup/daily-backup';

/**
 * The daily backup, called by the time-driven trigger.
 *
 * Deliberately swallows nothing and throws nothing: `runDailyBackup` returns a
 * typed result and this logs it. A trigger that throws emails the owner and
 * disables itself, which is the wrong response to a Drive hiccup at 02:00.
 * `RUNBOOK.md` §"Weekly review" says where to read this back.
 */
export function dailyBackup(): void {
  const result = runDailyBackup();

  if (result.outcome === 'failed') {
    console.error(`[backup] ${result.folderName}: FAILED — ${result.message ?? 'no detail'}`);
    return;
  }

  console.info(
    `[backup] ${result.folderName}: ${result.outcome}` +
      (result.pruned.length > 0 ? `, pruned ${result.pruned.join(', ')}` : ''),
  );
}
