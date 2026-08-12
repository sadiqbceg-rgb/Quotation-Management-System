import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAction } from './client';
import { AppError } from './errors';

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function mockFetch(
  responder: () => { status?: number; body: string } | Promise<{ status?: number; body: string }>,
): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      captured.push({ url, init });
      const result = await responder();
      return {
        ok: (result.status ?? 200) < 400,
        status: result.status ?? 200,
        text: () => Promise.resolve(result.body),
      } as Response;
    }),
  );

  return { captured };
}

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport shape', () => {
  it('POSTs a text/plain body so no CORS preflight is triggered', async () => {
    // Apps Script cannot answer a preflight; application/json would break every
    // call. See IMPLEMENTATION_PLAN.md §15.2.
    const { captured } = mockFetch(() => ({
      body: JSON.stringify({ ok: true, requestId: 'r1', data: { status: 'ok' } }),
    }));

    await callAction('health', {});

    const request = captured[0];
    expect(request).toBeDefined();
    expect(request?.init.method).toBe('POST');
    expect((request?.init.headers as Record<string, string>)['Content-Type']).toBe(
      'text/plain;charset=utf-8',
    );
    expect(request?.init.redirect).toBe('follow');
  });

  it('sends the action, a requestId and the payload in the body', async () => {
    const { captured } = mockFetch(() => ({
      body: JSON.stringify({ ok: true, requestId: 'r1', data: {} }),
    }));

    await callAction('health', { probe: 1 });

    const body = parseBody(captured[0]!.init);
    expect(body['action']).toBe('health');
    expect(typeof body['requestId']).toBe('string');
    expect(body['payload']).toEqual({ probe: 1 });
  });

  it('carries the session token in the body, never in a header', async () => {
    // An Authorization header would trigger a preflight.
    const { captured } = mockFetch(() => ({
      body: JSON.stringify({ ok: true, requestId: 'r1', data: {} }),
    }));

    await callAction('auth.me', {}, { token: 'test-token' });

    const request = captured[0]!;
    expect(parseBody(request.init)['token']).toBe('test-token');
    expect(Object.keys(request.init.headers as Record<string, string>)).toEqual(['Content-Type']);
  });

  it('omits the token key entirely when there is no session', async () => {
    const { captured } = mockFetch(() => ({
      body: JSON.stringify({ ok: true, requestId: 'r1', data: {} }),
    }));

    await callAction('health', {});

    expect('token' in parseBody(captured[0]!.init)).toBe(false);
  });
});

describe('responses', () => {
  it('returns the data payload on success', async () => {
    mockFetch(() => ({
      body: JSON.stringify({ ok: true, requestId: 'r1', data: { status: 'ok', version: '0.1.0' } }),
    }));

    await expect(callAction('health', {})).resolves.toEqual({ status: 'ok', version: '0.1.0' });
  });

  it('throws a typed AppError carrying the code, fields and requestId', async () => {
    mockFetch(() => ({
      body: JSON.stringify({
        ok: false,
        requestId: 'req-42',
        error: {
          code: 'VALIDATION_FAILED',
          message: 'Invalid',
          fields: { 'client.clientName': 'Required' },
        },
      }),
    }));

    const error = await callAction('quotation.save', {}).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('VALIDATION_FAILED');
    expect((error as AppError).requestId).toBe('req-42');
    expect((error as AppError).fields).toEqual({ 'client.clientName': 'Required' });
  });

  it('maps an unrecognised error code to INTERNAL_ERROR rather than trusting it', async () => {
    mockFetch(() => ({
      body: JSON.stringify({
        ok: false,
        requestId: 'r1',
        error: { code: 'SOMETHING_NEW', message: 'x' },
      }),
    }));

    const error = (await callAction('health', {}).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe('INTERNAL_ERROR');
  });

  it('reports a non-JSON response as BAD_RESPONSE', async () => {
    // Google serves an HTML sign-in or error page in some failure modes.
    mockFetch(() => ({ body: '<!doctype html><html>Sign in</html>' }));

    const error = (await callAction('health', {}).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('reports an unrecognised envelope as BAD_RESPONSE', async () => {
    mockFetch(() => ({ body: JSON.stringify({ unexpected: true }) }));

    const error = (await callAction('health', {}).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe('BAD_RESPONSE');
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );

    const error = (await callAction('health', {}).catch((thrown: unknown) => thrown)) as AppError;
    expect(error.code).toBe('NETWORK_ERROR');
  });

  it('reports an aborted request as TIMEOUT', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => {
              reject(new DOMException('Aborted', 'AbortError'));
            }, 5);
          }),
      ),
    );

    const error = (await callAction('health', {}, { timeoutMs: 1 }).catch(
      (thrown: unknown) => thrown,
    )) as AppError;
    expect(error.code).toBe('TIMEOUT');
  });
});
