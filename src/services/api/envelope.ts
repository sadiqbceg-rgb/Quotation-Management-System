/**
 * The request/response envelope spoken between the SPA and Google Apps Script.
 *
 * See IMPLEMENTATION_PLAN.md §15.4.
 *
 * A single POST endpoint with an `action` discriminator replaces REST verbs and
 * paths, because an Apps Script Web App exposes exactly one URL and cannot
 * answer a CORS preflight. See `client.ts` for the transport constraints.
 */

import type { ErrorCode } from './errors.js';
import type { ActionName } from './actions.js';

export interface ApiRequest<TPayload> {
  action: ActionName;
  /** Session token. Travels in the BODY, not a header — see client.ts. */
  token?: string;
  /** Correlates a client request with its audit-log entry. */
  requestId: string;
  payload: TPayload;
}

export interface ApiSuccess<TData> {
  ok: true;
  requestId: string;
  data: TData;
  /**
   * Present when the backend silently renewed a session that was close to
   * expiry (IMPLEMENTATION_PLAN.md §18.3). The client swaps it in so an active
   * session never dies mid-task.
   */
  renewedToken?: string;
}

export interface ApiFailure {
  ok: false;
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    /** Field-level messages, keyed by dotted field path. */
    fields?: Record<string, string>;
  };
}

export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

/**
 * Narrow an unknown parsed body into an ApiResponse.
 *
 * The endpoint is public and can also return Google's own HTML error pages, so
 * nothing coming back over the wire is trusted enough to cast.
 */
export function isApiResponse(value: unknown): value is ApiResponse<unknown> {
  if (typeof value !== 'object' || value === null) return false;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate['ok'] !== 'boolean') return false;
  if (typeof candidate['requestId'] !== 'string') return false;

  if (candidate['ok'] === true) {
    return 'data' in candidate;
  }

  const error = candidate['error'];
  if (typeof error !== 'object' || error === null) return false;
  const errorRecord = error as Record<string, unknown>;
  return typeof errorRecord['code'] === 'string' && typeof errorRecord['message'] === 'string';
}
