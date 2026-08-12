/**
 * Session tokens.
 *
 * See IMPLEMENTATION_PLAN.md §18.3.
 *
 * A compact JWT-shaped, HMAC-SHA256-signed token:
 *
 *     base64url(header) . base64url(payload) . base64url(signature)
 *
 * Signed with SESSION_HMAC_SECRET. Stateless apart from the revocation list in
 * session.ts, so verification costs one HMAC rather than a sheet read.
 *
 * Verification here checks structure, signature and expiry only. Revocation and
 * the user's `active` flag are checked by the caller (`resolveCaller`), because
 * both can change after the token was issued.
 */

import {
  base64UrlDecodeToText,
  base64UrlEncodeBytes,
  base64UrlEncodeText,
  textToBytes,
  timingSafeEqual,
} from './bytes';

export type Role = 'Admin' | 'User';

/** 8 hours (PRD §6 is a small internal team; §18.3 sets the TTL). */
export const TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** Renew silently when less than this remains, so a working session never dies mid-task. */
export const RENEW_WITHIN_SECONDS = 60 * 60;

/**
 * The fixed JWT header, encoded lazily and memoised.
 *
 * Computed on first use rather than at module load: a host call at import time
 * runs on every cold start and makes the module impossible to load without a
 * live Apps Script environment.
 */
let cachedHeader: string | null = null;

function header(): string {
  cachedHeader ??= base64UrlEncodeText(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  return cachedHeader;
}

export interface TokenPayload {
  /** Subject: the user's email. */
  sub: string;
  role: Role;
  /** Token id, used for revocation on logout. */
  jti: string;
  /** Issued at, epoch seconds. */
  iat: number;
  /** Expires at, epoch seconds. */
  exp: number;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function sign(signingInput: string, secret: string): string {
  return base64UrlEncodeBytes(
    Utilities.computeHmacSha256Signature(textToBytes(signingInput), textToBytes(secret)),
  );
}

export function issueToken(
  email: string,
  role: Role,
  secret: string,
  issuedAt: number = nowSeconds(),
): string {
  const payload: TokenPayload = {
    sub: email,
    role,
    jti: Utilities.getUuid(),
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };

  const body = base64UrlEncodeText(JSON.stringify(payload));
  const signingInput = `${header()}.${body}`;
  return `${signingInput}.${sign(signingInput, secret)}`;
}

function isRole(value: unknown): value is Role {
  return value === 'Admin' || value === 'User';
}

function parsePayload(value: unknown): TokenPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;

  const sub = candidate['sub'];
  const role = candidate['role'];
  const jti = candidate['jti'];
  const iat = candidate['iat'];
  const exp = candidate['exp'];

  if (typeof sub !== 'string' || sub.length === 0) return null;
  if (!isRole(role)) return null;
  if (typeof jti !== 'string' || jti.length === 0) return null;
  if (typeof iat !== 'number' || !Number.isFinite(iat)) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;

  return { sub, role, jti, iat, exp };
}

export type TokenFailure = 'malformed' | 'bad-signature' | 'expired';

export type TokenResult = { ok: true; payload: TokenPayload } | { ok: false; reason: TokenFailure };

/**
 * Verify structure, signature and expiry.
 *
 * The failure reason is for the audit log only. The client always receives one
 * generic message, so a probing attacker learns nothing from the difference.
 */
export function verifyToken(
  raw: string | undefined,
  secret: string,
  now: number = nowSeconds(),
): TokenResult {
  if (typeof raw !== 'string' || raw.length === 0) {
    return { ok: false, reason: 'malformed' };
  }

  const parts = raw.split('.');
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed' };
  }

  const [rawHeader, body, signature] = parts;
  if (rawHeader === undefined || body === undefined || signature === undefined) {
    return { ok: false, reason: 'malformed' };
  }
  if (rawHeader !== header()) {
    // Pins the algorithm: an "alg": "none" token can never be accepted.
    return { ok: false, reason: 'malformed' };
  }

  if (!timingSafeEqual(sign(`${rawHeader}.${body}`, secret), signature)) {
    return { ok: false, reason: 'bad-signature' };
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(base64UrlDecodeToText(body));
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const payload = parsePayload(decoded);
  if (payload === null) {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.exp <= now) {
    return { ok: false, reason: 'expired' };
  }

  return { ok: true, payload };
}

/** True when the token is close enough to expiry to be worth reissuing. */
export function shouldRenew(expiresAt: number, now: number = nowSeconds()): boolean {
  return expiresAt - now < RENEW_WITHIN_SECONDS;
}
