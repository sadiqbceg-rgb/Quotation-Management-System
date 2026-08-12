/**
 * Authentication actions: login, logout, me, and Admin user provisioning.
 *
 * See IMPLEMENTATION_PLAN.md §18.
 *
 * Role enforcement is NOT done here — it is declared in the action table in
 * main.ts and applied by the router before any handler runs (§19.2). A handler
 * that authorises itself is how one forgotten check becomes an escalation.
 */

import { PATTERNS, TEXT_LIMITS, isWithinLength } from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { requireProperty } from '../config/properties';
import { ApiError, type HandlerContext } from '../errors';
import * as rateLimit from './rate-limit';
import {
  DEFAULT_PBKDF2_ITERATIONS,
  createPasswordRecord,
  hashPassword,
  performDummyHash,
  verifyPassword,
} from './password';
import { revokeToken } from './session';
import { issueToken, nowSeconds, type Role } from './token';
import * as users from '../sheets/users-repository';

export interface PublicUser {
  email: string;
  role: Role;
}

export interface LoginResult {
  token: string;
  user: PublicUser;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid request payload.');
  }
  return payload as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? value : '';
}

/**
 * Sign in.
 *
 * Every failure path returns the same generic message and does the same amount
 * of hashing work, so neither the wording nor the timing reveals whether an
 * account exists (§19.2).
 */
export function login(payload: unknown, context: HandlerContext): LoginResult {
  const body = asRecord(payload);
  const email = users.normaliseEmail(readString(body, 'email'));
  const password = readString(body, 'password');
  const pepper = requireProperty('PASSWORD_PEPPER');
  const secret = requireProperty('SESSION_HMAC_SECRET');
  const now = nowSeconds();

  if (email.length === 0 || password.length === 0 || !PATTERNS.email.test(email)) {
    throw new ApiError('AUTH_INVALID', 'Invalid email or password.');
  }

  const lock = rateLimit.checkLock(email, now);
  if (lock.locked) {
    writeAudit({
      actor: email,
      action: 'auth.login',
      outcome: 'denied',
      target: 'rate-limited',
      requestId: context.requestId,
    });
    throw new ApiError('RATE_LIMITED', 'Too many attempts. Please wait and try again.');
  }

  const record = users.findByEmail(email);

  if (record === null) {
    // Burn the same time a real verification would, then fail identically.
    performDummyHash(pepper);
    registerFailure(email, now, context, 'unknown-account');
    throw new ApiError('AUTH_INVALID', 'Invalid email or password.');
  }

  const passwordMatches = verifyPassword(
    password,
    { hash: record.passwordHash, salt: record.salt, iterations: record.iterations },
    pepper,
  );

  if (!passwordMatches) {
    registerFailure(email, now, context, 'bad-password');
    throw new ApiError('AUTH_INVALID', 'Invalid email or password.');
  }

  if (!record.active) {
    // Deliberately the same message: a deactivated account must not be
    // distinguishable from a wrong password.
    registerFailure(email, now, context, 'inactive');
    throw new ApiError('AUTH_INVALID', 'Invalid email or password.');
  }

  rateLimit.clearFailures(email);
  users.recordLogin(record);

  // Opportunistically upgrade a hash stored at an older, cheaper cost.
  if (record.iterations < DEFAULT_PBKDF2_ITERATIONS) {
    const upgraded = createPasswordRecord(password, pepper, DEFAULT_PBKDF2_ITERATIONS);
    users.updatePasswordMaterial(record, upgraded.hash, upgraded.salt, upgraded.iterations);
  }

  writeAudit({
    actor: email,
    action: 'auth.login',
    outcome: 'success',
    requestId: context.requestId,
  });

  return {
    token: issueToken(record.email, record.role, secret, now),
    user: { email: record.email, role: record.role },
  };
}

function registerFailure(
  email: string,
  now: number,
  context: HandlerContext,
  reason: string,
): void {
  const status = rateLimit.recordFailure(email, now);
  writeAudit({
    actor: email,
    action: 'auth.login',
    outcome: status.locked ? 'denied' : 'failure',
    target: status.locked ? `locked:${reason}` : reason,
    requestId: context.requestId,
  });
}

/** Sign out: revoke this token id for the remainder of its lifetime. */
export function logout(_payload: unknown, context: HandlerContext): { ok: true } {
  const caller = context.caller;
  if (caller !== null) {
    revokeToken(caller.jti, caller.exp, nowSeconds());
    writeAudit({
      actor: caller.email,
      action: 'auth.logout',
      outcome: 'success',
      requestId: context.requestId,
    });
  }
  return { ok: true };
}

/** The current session's user. Used to validate a rehydrated token on startup. */
export function me(_payload: unknown, context: HandlerContext): PublicUser {
  const caller = context.caller;
  if (caller === null) {
    throw new ApiError('AUTH_REQUIRED', 'Authentication is required.');
  }
  return { email: caller.email, role: caller.role };
}

/**
 * Create an account. Admin only — there is no self-registration (PRD §6).
 *
 * The first Admin is created by an operator running `provisionFirstAdmin` from
 * the Apps Script editor; see provisioning.ts.
 */
export function createUser(payload: unknown, context: HandlerContext): PublicUser {
  const body = asRecord(payload);
  const email = users.normaliseEmail(readString(body, 'email'));
  const password = readString(body, 'password');
  const roleValue = readString(body, 'role');

  const fields: Record<string, string> = {};

  if (!PATTERNS.email.test(email) || !isWithinLength(email, TEXT_LIMITS.email)) {
    fields['email'] = 'Enter a valid email address.';
  }
  if (!isWithinLength(password, TEXT_LIMITS.password)) {
    fields['password'] =
      `Password must be ${String(TEXT_LIMITS.password.min)}-${String(TEXT_LIMITS.password.max)} characters.`;
  }
  if (roleValue !== 'Admin' && roleValue !== 'User') {
    fields['role'] = 'Role must be Admin or User.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  if (users.emailExists(email)) {
    // An Admin is already trusted with the account list, so this is not a
    // disclosure — unlike the login path, where it would be.
    throw new ApiError('VALIDATION_FAILED', 'An account with that email already exists.', {
      email: 'An account with that email already exists.',
    });
  }

  const pepper = requireProperty('PASSWORD_PEPPER');
  const material = createPasswordRecord(password, pepper);
  const role: Role = roleValue === 'Admin' ? 'Admin' : 'User';

  users.createUser({
    email,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role,
  });

  writeAudit({
    actor: context.caller?.email ?? 'system',
    action: 'admin.createUser',
    target: email,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { email, role };
}

/** Exposed for the provisioning script so it hashes exactly as login expects. */
export { hashPassword };
