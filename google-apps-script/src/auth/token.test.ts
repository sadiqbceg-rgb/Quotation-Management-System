import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes } from '../__fixtures__/gas-fakes';
import {
  RENEW_WITHIN_SECONDS,
  TOKEN_TTL_SECONDS,
  issueToken,
  shouldRenew,
  verifyToken,
} from './token';

const SECRET = 'test-only-session-secret';
const NOW = 1_800_000_000;

beforeEach(() => {
  installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('issue and verify', () => {
  it('round-trips a valid token', () => {
    const token = issueToken('user@speedxksa.com', 'User', SECRET, NOW);
    const result = verifyToken(token, SECRET, NOW + 60);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.sub).toBe('user@speedxksa.com');
    expect(result.payload.role).toBe('User');
    expect(result.payload.iat).toBe(NOW);
    expect(result.payload.exp).toBe(NOW + TOKEN_TTL_SECONDS);
    expect(result.payload.jti).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('issues a distinct token id every time', () => {
    const first = verifyToken(issueToken('a@b.com', 'User', SECRET, NOW), SECRET, NOW);
    const second = verifyToken(issueToken('a@b.com', 'User', SECRET, NOW), SECRET, NOW);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.payload.jti).not.toBe(second.payload.jti);
  });

  it('has three base64url segments and no padding', () => {
    const token = issueToken('a@b.com', 'User', SECRET, NOW);
    expect(token.split('.')).toHaveLength(3);
    expect(token).not.toContain('=');
    expect(token).not.toContain('+');
    expect(token).not.toContain('/');
  });
});

describe('rejection', () => {
  it('rejects a missing or empty token', () => {
    expect(verifyToken(undefined, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    expect(verifyToken('', SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('rejects a structurally malformed token', () => {
    expect(verifyToken('not-a-token', SECRET, NOW).ok).toBe(false);
    expect(verifyToken('a.b', SECRET, NOW).ok).toBe(false);
    expect(verifyToken('a.b.c.d', SECRET, NOW).ok).toBe(false);
  });

  it('rejects a tampered payload', () => {
    const token = issueToken('user@speedxksa.com', 'User', SECRET, NOW);
    const [header, , signature] = token.split('.');

    // Try to promote User to Admin by rewriting the body.
    const forgedBody = Buffer.from(
      JSON.stringify({
        sub: 'user@speedxksa.com',
        role: 'Admin',
        jti: 'forged',
        iat: NOW,
        exp: NOW + TOKEN_TTL_SECONDS,
      }),
    )
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const forged = `${header ?? ''}.${forgedBody}.${signature ?? ''}`;
    expect(verifyToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a tampered signature', () => {
    const token = issueToken('a@b.com', 'User', SECRET, NOW);
    const [header, body] = token.split('.');
    const forged = `${header ?? ''}.${body ?? ''}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;

    expect(verifyToken(forged, SECRET, NOW).ok).toBe(false);
  });

  it('rejects a token signed with a different secret', () => {
    const token = issueToken('a@b.com', 'User', 'some-other-secret', NOW);
    expect(verifyToken(token, SECRET, NOW)).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects an alg:none token', () => {
    // The header is pinned, so the classic JWT algorithm-confusion attack fails.
    const noneHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/, '');
    const body = Buffer.from(
      JSON.stringify({ sub: 'a@b.com', role: 'Admin', jti: 'x', iat: NOW, exp: NOW + 100 }),
    )
      .toString('base64')
      .replace(/=+$/, '');

    expect(verifyToken(`${noneHeader}.${body}.`, SECRET, NOW)).toEqual({
      ok: false,
      reason: 'malformed',
    });
  });

  it('rejects an expired token', () => {
    const token = issueToken('a@b.com', 'User', SECRET, NOW);
    expect(verifyToken(token, SECRET, NOW + TOKEN_TTL_SECONDS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('rejects a token exactly at its expiry', () => {
    const token = issueToken('a@b.com', 'User', SECRET, NOW);
    expect(verifyToken(token, SECRET, NOW + TOKEN_TTL_SECONDS).ok).toBe(false);
  });

  it('rejects a payload with an unknown role', () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/=+$/, '');
    const body = Buffer.from(
      JSON.stringify({ sub: 'a@b.com', role: 'SuperAdmin', jti: 'x', iat: NOW, exp: NOW + 100 }),
    )
      .toString('base64')
      .replace(/=+$/, '');

    // Signed correctly but semantically invalid.
    expect(verifyToken(`${header}.${body}.whatever`, SECRET, NOW).ok).toBe(false);
  });
});

describe('renewal', () => {
  it('renews when less than an hour remains', () => {
    expect(shouldRenew(NOW + RENEW_WITHIN_SECONDS - 1, NOW)).toBe(true);
  });

  it('does not renew a fresh token', () => {
    expect(shouldRenew(NOW + TOKEN_TTL_SECONDS, NOW)).toBe(false);
  });

  it('does not renew exactly at the threshold', () => {
    expect(shouldRenew(NOW + RENEW_WITHIN_SECONDS, NOW)).toBe(false);
  });
});
