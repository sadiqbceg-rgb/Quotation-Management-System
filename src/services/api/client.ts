/**
 * The single HTTP path between the SPA and the Google Apps Script backend.
 *
 * No other module may call `fetch`. Feature services call `callAction`.
 *
 * ---------------------------------------------------------------------------
 * WHY `Content-Type: text/plain` AND WHY THE TOKEN IS IN THE BODY
 * ---------------------------------------------------------------------------
 * Google Apps Script Web Apps do not answer CORS preflight (OPTIONS) requests
 * and cannot set `Access-Control-Allow-*` headers. Every call from the browser
 * must therefore qualify as a CORS **simple request**:
 *
 *   - `application/json` would trigger a preflight  → the call fails.
 *   - An `Authorization` header would trigger a preflight → the call fails.
 *
 * So the body is a JSON *string* sent as `text/plain;charset=utf-8`, and the
 * session token travels inside that JSON rather than in a header.
 *
 * Do not "fix" this to `application/json`. It will break every request.
 * See IMPLEMENTATION_PLAN.md §15.2.
 * ---------------------------------------------------------------------------
 */

import { getEnv } from '@/config/env';
import { newRequestId } from '@/utils/uuid';
import type { ActionName } from './actions';
import { AppError, isErrorCode } from './errors';
import { isApiResponse, type ApiRequest } from './envelope';

/** Apps Script executions are capped at 6 minutes; we give up well before that. */
export const DEFAULT_TIMEOUT_MS = 60_000;

export interface CallOptions {
  token?: string | undefined;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Invoke a backend action.
 *
 * Resolves with the typed `data` payload, or throws an `AppError` carrying a
 * code from the shared taxonomy. Never throws a bare `Error`.
 */
export async function callAction<TPayload, TData>(
  action: ActionName,
  payload: TPayload,
  options: CallOptions = {},
): Promise<TData> {
  const requestId = newRequestId();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const endpoint = getEnv().gasEndpoint;

  const body: ApiRequest<TPayload> = {
    action,
    requestId,
    payload,
    ...(options.token === undefined ? {} : { token: options.token }),
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  if (options.signal !== undefined) {
    if (options.signal.aborted) controller.abort();
    else
      options.signal.addEventListener(
        'abort',
        () => {
          controller.abort();
        },
        { once: true },
      );
  }

  let raw: string;
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      // See the header comment. This MUST stay text/plain.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      // Apps Script 302-redirects to script.googleusercontent.com.
      redirect: 'follow',
      signal: controller.signal,
    });

    raw = await response.text();

    if (!response.ok && raw.trim().length === 0) {
      throw new AppError('NETWORK_ERROR', `Request failed with status ${response.status}`, {
        requestId,
      });
    }
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new AppError('TIMEOUT', `Action "${action}" timed out after ${timeoutMs}ms`, {
        requestId,
        cause,
      });
    }
    throw new AppError('NETWORK_ERROR', `Could not reach the backend for action "${action}"`, {
      requestId,
      cause,
    });
  } finally {
    clearTimeout(timeout);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    // A Google sign-in page or an Apps Script stack-trace page lands here.
    throw new AppError('BAD_RESPONSE', `Action "${action}" returned a non-JSON response`, {
      requestId,
      cause,
    });
  }

  if (!isApiResponse(parsed)) {
    throw new AppError('BAD_RESPONSE', `Action "${action}" returned an unrecognised envelope`, {
      requestId,
    });
  }

  if (parsed.ok) {
    return parsed.data as TData;
  }

  const code = isErrorCode(parsed.error.code) ? parsed.error.code : 'INTERNAL_ERROR';
  throw new AppError(code, parsed.error.message, {
    requestId: parsed.requestId,
    ...(parsed.error.fields === undefined ? {} : { fields: parsed.error.fields }),
  });
}
