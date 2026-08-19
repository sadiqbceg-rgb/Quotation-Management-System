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

/* -------------------------------------------------------------------------- */
/* User administration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * How long to wait for the user lock.
 *
 * Apps Script caps this at 30 s, and the critical section is a handful of sheet
 * operations, so a caller that cannot get in is told to retry rather than being
 * queued behind something evidently stuck. Mirrors `reserve.ts`.
 */
export const USER_LOCK_TIMEOUT_MS = 30_000;

/** Injectable so tests can drive the lock and assert the critical section. */
export interface UserLock {
  tryLock: (timeoutMs: number) => boolean;
  releaseLock: () => void;
}

function defaultUserLock(): UserLock {
  // getScriptLock, not getUserLock: two DIFFERENT admins deactivating the last
  // two Admin accounts concurrently is precisely the race being prevented.
  return LockService.getScriptLock();
}

let lockOverride: UserLock | null = null;

/** Tests only. Lets a test observe the critical section without a live host. */
export function TEST_ONLY_setUserLock(lock: UserLock | null): void {
  lockOverride = lock;
}

/**
 * Run a read-check-write against the Users sheet under mutual exclusion.
 *
 * The last-active-Admin guard is a count followed by a write. Without a lock,
 * two requests can each read "two active Admins", each conclude their own
 * change is safe, and between them leave the deployment with none — locking
 * every administrator out of a system whose only recovery path is the Apps
 * Script editor. `flush` forces the write to be durable before the lock is
 * released, so the next holder cannot read a stale count.
 */
function withUserLock<T>(operation: () => T): T {
  const lock = lockOverride ?? defaultUserLock();

  if (!lock.tryLock(USER_LOCK_TIMEOUT_MS)) {
    throw new ApiError(
      'RATE_LIMITED',
      'The system is busy updating accounts. Please try again.',
    );
  }

  try {
    const result = operation();
    SpreadsheetApp.flush();
    return result;
  } finally {
    // Always released, including on every validation and guard error path.
    lock.releaseLock();
  }
}

/**
 * What an account looks like to an Admin looking at the user list.
 *
 * The hash, the salt and the iteration count are deliberately absent. This type
 * is the boundary: `admin.listUsers` cannot return password material because
 * there is no field to put it in, and `security-review.test.ts` asserts it.
 */
export interface ManagedUser {
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string;
}

function toManagedUser(record: users.UserRecord): ManagedUser {
  return {
    email: record.email,
    role: record.role,
    active: record.active,
    createdAt: record.createdAt,
    lastLoginAt: record.lastLoginAt,
  };
}

/** Every account. Admin only — declared in the ACTIONS table, not checked here. */
export function listUsers(_payload: unknown, _context: HandlerContext): ManagedUser[] {
  return users.listAll().map(toManagedUser);
}

/**
 * Resolve the target account for an administrative action.
 *
 * Deliberately NOT the generic message the login path uses: an Admin is already
 * trusted with the account list, so naming a missing account discloses nothing
 * they cannot read directly.
 */
function requireTarget(body: Record<string, unknown>): users.UserRecord {
  const email = users.normaliseEmail(readString(body, 'email'));

  if (email.length === 0 || !PATTERNS.email.test(email)) {
    throw new ApiError('VALIDATION_FAILED', 'A valid email address is required.', {
      email: 'Enter a valid email address.',
    });
  }

  const record = users.findByEmail(email);
  if (record === null) {
    throw new ApiError('VALIDATION_FAILED', 'That account could not be found.', {
      email: 'That account could not be found.',
    });
  }

  return record;
}

function readBoolean(body: Record<string, unknown>, key: string): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.');
  }
  return value;
}

/**
 * Replace an account's sign-in credential.
 *
 * Named `resetUserCredential`, not `resetPassword`: the action name is written
 * into the audit sheet's Action column, and `FORBIDDEN_IN_AUDIT` in
 * `security/audit.ts` rejects any audit value matching /password/i. The word is
 * banned from that column precisely so a real one can never hide there.
 *
 * The new credential is hashed by `createPasswordRecord` — the same function
 * login verifies against — at the CURRENT default cost, so a reset also
 * upgrades an account still stored at an older iteration count. The plaintext
 * exists only as a local argument: it is never stored, returned, or logged.
 */
export function resetUserCredential(payload: unknown, context: HandlerContext): ManagedUser {
  const body = asRecord(payload);
  const record = requireTarget(body);
  const secret = readString(body, 'newSecret');

  if (!isWithinLength(secret, TEXT_LIMITS.password)) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', {
      newSecret: `Must be ${String(TEXT_LIMITS.password.min)}-${String(TEXT_LIMITS.password.max)} characters.`,
    });
  }

  const pepper = requireProperty('PASSWORD_PEPPER');
  const material = createPasswordRecord(secret, pepper);

  users.updatePasswordMaterial(record, material.hash, material.salt, material.iterations);

  writeAudit({
    actor: context.caller?.email ?? 'system',
    action: 'admin.resetUserCredential',
    // The email only. Never the secret, never the hash, never the salt (§19.9).
    target: record.email,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toManagedUser({ ...record, iterations: material.iterations });
}

/**
 * Activate or deactivate an account.
 *
 * Deactivation is not deletion: the row stays, so the audit trail and the
 * `createdBy` on every quotation that account issued remain resolvable.
 * Login already refuses an inactive account (see `login` above), and does so
 * with the same generic message as a wrong password, so this needs no change
 * to the sign-in path.
 */
export function setUserActive(payload: unknown, context: HandlerContext): ManagedUser {
  const body = asRecord(payload);
  const active = readBoolean(body, 'active');

  return withUserLock(() => {
    const record = requireTarget(body);

    if (!active && record.role === 'Admin' && record.active) {
      assertNotLastAdmin(
        'Deactivating this account would leave the system with no active administrator.',
      );
    }

    if (record.active !== active) {
      users.setActive(record, active);
    }

    writeAudit({
      actor: context.caller?.email ?? 'system',
      action: 'admin.setUserActive',
      target: `${record.email} ${active ? 'active' : 'inactive'}`,
      outcome: 'success',
      requestId: context.requestId,
    });

    return toManagedUser({ ...record, active });
  });
}

/** Move an account between the two roles the system has (§18.4). */
export function setUserRole(payload: unknown, context: HandlerContext): ManagedUser {
  const body = asRecord(payload);
  const roleValue = readString(body, 'role');

  if (roleValue !== 'Admin' && roleValue !== 'User') {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', {
      role: 'Role must be Admin or User.',
    });
  }
  const role: Role = roleValue === 'Admin' ? 'Admin' : 'User';

  return withUserLock(() => {
    const record = requireTarget(body);

    if (role === 'User' && record.role === 'Admin' && record.active) {
      assertNotLastAdmin(
        'Changing this account to User would leave the system with no active administrator.',
      );
    }

    if (record.role !== role) {
      users.setRole(record, role);
    }

    writeAudit({
      actor: context.caller?.email ?? 'system',
      action: 'admin.setUserRole',
      target: `${record.email} ${role}`,
      outcome: 'success',
      requestId: context.requestId,
    });

    return toManagedUser({ ...record, role });
  });
}

/**
 * Refuse a change that would remove the system's last active administrator.
 *
 * Called only from inside `withUserLock`, and only when the target is itself an
 * active Admin — so a count of exactly one can only be the target.
 *
 * There is no override. An Admin who genuinely wants to hand over creates the
 * replacement first, which is one extra step and is the whole point: the
 * recovery path from zero Admins is an operator running `provisionFirstAdmin`
 * from the Apps Script editor, and that is not a thing to leave a business
 * relying on.
 */
function assertNotLastAdmin(message: string): void {
  if (users.countActiveAdmins() <= 1) {
    /*
     * VALIDATION_FAILED, not FORBIDDEN.
     *
     * The caller IS authorized — they are an Admin, and the router already let
     * them through. What is wrong is the REQUEST, and the reason is a business
     * sentence the screen cannot reconstruct. FORBIDDEN would collapse to "You
     * do not have permission to perform this action", which is both untrue and
     * useless: it tells an Admin they lack a permission they have, and hides
     * the one thing they need to know, which is to create a replacement first.
     *
     * `businessMessageOf` on the client surfaces VALIDATION_FAILED messages
     * verbatim for exactly this reason.
     */
    throw new ApiError('VALIDATION_FAILED', message);
  }
}

/** Exposed for the provisioning script so it hashes exactly as login expects. */
export { hashPassword };
