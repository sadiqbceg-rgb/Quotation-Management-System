/**
 * User administration (§18.4 "Manage users": Admin only).
 *
 * Everything here goes through `handlePost`, not through the handlers directly.
 * That is deliberate: the authorization these actions rely on lives in the
 * ACTIONS table and is applied by the router, so a test that called
 * `setUserRole()` directly would prove nothing about whether a User can reach
 * it. Calling the router is the only way to test the control that actually
 * exists.
 *
 * Runs entirely against the in-memory fakes. Nothing touches a real spreadsheet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { handlePost } from '../main';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createUser, findByEmail, USERS_SHEET_NAME } from '../sheets/users-repository';
import { DEFAULT_PBKDF2_ITERATIONS, createPasswordRecord } from './password';
import { TEST_ONLY_setUserLock, type UserLock } from './handlers';

const PEPPER = 'test-only-pepper-not-a-real-key';
const ADMIN_SECRET = 'TEST_ONLY_admin-horse-battery';
const SECOND_ADMIN_SECRET = 'TEST_ONLY_second-admin-battery';
const USER_SECRET = 'TEST_ONLY_correct-horse-battery';
const NEW_SECRET = 'TEST_ONLY_replacement-horse-battery';

const ADMIN = 'admin@speedxksa.com';
const SECOND_ADMIN = 'admin2@speedxksa.com';
const STAFF = 'staff@speedxksa.com';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let adminToken: string;
let userToken: string;

function call(action: string, payload: unknown = {}, token?: string): Envelope {
  const output = handlePost(
    JSON.stringify({
      action,
      requestId: 'test-request',
      payload,
      ...(token === undefined ? {} : { token }),
    }),
  ) as unknown as { getContent: () => string };

  return JSON.parse(output.getContent()) as Envelope;
}

/** Sign in and return the token, or null when the credentials were refused. */
function login(email: string, secret: string): string | null {
  const response = call('auth.login', { email, password: secret });
  if (!response.ok) return null;
  return (response.data as { token: string }).token;
}

function seed(email: string, secret: string, role: 'Admin' | 'User'): void {
  // 1,000 is MIN_PBKDF2_ITERATIONS — the cheapest the system accepts, so the
  // suite is not paying the production cost on every seeded account.
  const material = createPasswordRecord(secret, PEPPER, 1_000);
  createUser({
    email,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role,
  });
}

function auditRows(): unknown[][] {
  return env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
}

function listUsers(token: string): Array<Record<string, unknown>> {
  const response = call('admin.listUsers', {}, token);
  expect(response.ok).toBe(true);
  return response.data as Array<Record<string, unknown>>;
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
  TEST_ONLY_resetBootstrapState();

  seed(ADMIN, ADMIN_SECRET, 'Admin');
  seed(STAFF, USER_SECRET, 'User');

  adminToken = login(ADMIN, ADMIN_SECRET) ?? '';
  userToken = login(STAFF, USER_SECRET) ?? '';
  expect(adminToken.length).toBeGreaterThan(0);
  expect(userToken.length).toBeGreaterThan(0);
});

afterEach(() => {
  TEST_ONLY_setUserLock(null);
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Listing and authorization                                                  */
/* -------------------------------------------------------------------------- */

describe('listing accounts', () => {
  it('lets an Admin list every account', () => {
    const rows = listUsers(adminToken);

    expect(rows.map((row) => row['email']).sort()).toEqual([ADMIN, STAFF]);
  });

  it('reports role, status and timestamps', () => {
    const staff = listUsers(adminToken).find((row) => row['email'] === STAFF);

    expect(staff).toMatchObject({ role: 'User', active: true });
    expect(typeof staff?.['createdAt']).toBe('string');
    // Seeded accounts have signed in during setup, so this is populated.
    expect(typeof staff?.['lastLoginAt']).toBe('string');
  });

  it('refuses a normal User', () => {
    expect(call('admin.listUsers', {}, userToken).error?.code).toBe('FORBIDDEN');
  });

  it('refuses every administrative action for a normal User', () => {
    // The whole surface, not just the one a reviewer happened to think of.
    const forbidden = [
      ['admin.listUsers', {}],
      ['admin.createUser', { email: 'new@speedxksa.com', password: NEW_SECRET, role: 'User' }],
      ['admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }],
      ['admin.setUserActive', { email: STAFF, active: false }],
      ['admin.setUserRole', { email: STAFF, role: 'Admin' }],
    ] as const;

    for (const [action, payload] of forbidden) {
      expect(call(action, payload, userToken).error?.code, action).toBe('FORBIDDEN');
    }
  });

  it('refuses an administrative action with no token at all', () => {
    expect(call('admin.setUserRole', { email: STAFF, role: 'Admin' }).error?.code).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('leaves the account unchanged after a User is refused', () => {
    call('admin.setUserRole', { email: STAFF, role: 'Admin' }, userToken);

    expect(findByEmail(STAFF)?.role).toBe('User');
  });
});

/* -------------------------------------------------------------------------- */
/* Creating                                                                   */
/* -------------------------------------------------------------------------- */

describe('creating an account', () => {
  it('creates a User who can then sign in', () => {
    const created = call(
      'admin.createUser',
      { email: 'new@speedxksa.com', password: NEW_SECRET, role: 'User' },
      adminToken,
    );

    expect(created.ok).toBe(true);
    expect(login('new@speedxksa.com', NEW_SECRET)).not.toBeNull();
  });

  it('rejects a duplicate email', () => {
    const response = call(
      'admin.createUser',
      { email: STAFF, password: NEW_SECRET, role: 'User' },
      adminToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.fields?.['email']).toBeDefined();
  });

  it('rejects a duplicate email differing only in case', () => {
    // Emails are normalised on write and on lookup, so casing cannot fork an
    // account into two rows that both answer to the same sign-in.
    const response = call(
      'admin.createUser',
      { email: STAFF.toUpperCase(), password: NEW_SECRET, role: 'User' },
      adminToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a credential shorter than the existing policy allows', () => {
    const response = call(
      'admin.createUser',
      { email: 'short@speedxksa.com', password: 'short', role: 'User' },
      adminToken,
    );

    expect(response.error?.fields?.['password']).toBeDefined();
    expect(findByEmail('short@speedxksa.com')).toBeNull();
  });

  it('rejects a role outside the two the system has', () => {
    const response = call(
      'admin.createUser',
      { email: 'super@speedxksa.com', password: NEW_SECRET, role: 'SuperAdmin' },
      adminToken,
    );

    expect(response.error?.fields?.['role']).toBeDefined();
  });
});

/* -------------------------------------------------------------------------- */
/* Resetting a credential                                                     */
/* -------------------------------------------------------------------------- */

describe('resetting a credential', () => {
  it('replaces the credential: the old one stops working and the new one works', () => {
    expect(call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken).ok)
      .toBe(true);

    expect(login(STAFF, USER_SECRET)).toBeNull();
    expect(login(STAFF, NEW_SECRET)).not.toBeNull();
  });

  it('rehashes at the CURRENT default cost', () => {
    call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken);

    expect(findByEmail(STAFF)?.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
  });

  it('does not disturb the existing upgrade-on-login behaviour', () => {
    /*
     * Pinning behaviour this change must not alter: `login` already re-hashes an
     * account stored below the current default (auth/handlers.ts). The accounts
     * seeded here at the 1,000 minimum are therefore already at the default by
     * the time `beforeEach` finishes, because setup signs them in.
     *
     * It matters for the reset path: an account stored ABOVE the default is
     * deliberately left alone by login, and a reset is the only thing that
     * brings it down.
     */
    expect(findByEmail(STAFF)?.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);

    const expensive = createPasswordRecord(USER_SECRET, PEPPER, DEFAULT_PBKDF2_ITERATIONS * 4);
    createUser({
      email: 'expensive@speedxksa.com',
      passwordHash: expensive.hash,
      salt: expensive.salt,
      iterations: expensive.iterations,
      role: 'User',
    });

    // Signing in does NOT lower it: the upgrade is one-directional.
    login('expensive@speedxksa.com', USER_SECRET);
    expect(findByEmail('expensive@speedxksa.com')?.iterations).toBe(
      DEFAULT_PBKDF2_ITERATIONS * 4,
    );

    // A reset does.
    call(
      'admin.resetUserCredential',
      { email: 'expensive@speedxksa.com', newSecret: NEW_SECRET },
      adminToken,
    );
    expect(findByEmail('expensive@speedxksa.com')?.iterations).toBe(DEFAULT_PBKDF2_ITERATIONS);
  });

  it('gives the account a fresh salt, so two accounts never share hash material', () => {
    const before = findByEmail(STAFF)?.salt;
    call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken);

    expect(findByEmail(STAFF)?.salt).not.toBe(before);
  });

  it('rejects a credential shorter than the existing policy allows', () => {
    const response = call(
      'admin.resetUserCredential',
      { email: STAFF, newSecret: 'short' },
      adminToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    // The old credential still works: a rejected reset changes nothing.
    expect(login(STAFF, USER_SECRET)).not.toBeNull();
  });

  it('refuses an account that does not exist', () => {
    const response = call(
      'admin.resetUserCredential',
      { email: 'nobody@speedxksa.com', newSecret: NEW_SECRET },
      adminToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });
});

/* -------------------------------------------------------------------------- */
/* Activating and deactivating                                                */
/* -------------------------------------------------------------------------- */

describe('activation', () => {
  it('deactivates a User, who can then no longer sign in', () => {
    expect(call('admin.setUserActive', { email: STAFF, active: false }, adminToken).ok).toBe(true);

    expect(login(STAFF, USER_SECRET)).toBeNull();
  });

  it('reactivates the User, who can sign in again', () => {
    call('admin.setUserActive', { email: STAFF, active: false }, adminToken);
    call('admin.setUserActive', { email: STAFF, active: true }, adminToken);

    expect(login(STAFF, USER_SECRET)).not.toBeNull();
  });

  it('keeps the row rather than deleting it, so history stays resolvable', () => {
    call('admin.setUserActive', { email: STAFF, active: false }, adminToken);

    const record = findByEmail(STAFF);
    expect(record).not.toBeNull();
    expect(record?.active).toBe(false);
    expect(record?.createdAt.length).toBeGreaterThan(0);
  });

  it('tells a deactivated user nothing about why sign-in failed', () => {
    call('admin.setUserActive', { email: STAFF, active: false }, adminToken);

    const response = call('auth.login', { email: STAFF, password: USER_SECRET });

    // Identical to a wrong password: a disabled account must not be
    // distinguishable from a bad credential.
    expect(response.error?.code).toBe('AUTH_INVALID');
    expect(response.error?.message).toBe('Invalid email or password.');
  });
});

/* -------------------------------------------------------------------------- */
/* Roles                                                                      */
/* -------------------------------------------------------------------------- */

describe('roles', () => {
  it('promotes a User to Admin', () => {
    expect(call('admin.setUserRole', { email: STAFF, role: 'Admin' }, adminToken).ok).toBe(true);

    expect(findByEmail(STAFF)?.role).toBe('Admin');
  });

  it('grants the promoted account Admin actions on its NEXT sign-in', () => {
    call('admin.setUserRole', { email: STAFF, role: 'Admin' }, adminToken);

    // The role is carried in the signed token, so the existing session keeps the
    // role it was issued with. This is the safe direction and is worth pinning:
    // a demotion likewise does not take effect until the token is reissued.
    const reissued = login(STAFF, USER_SECRET) ?? '';
    expect(call('admin.listUsers', {}, reissued).ok).toBe(true);
  });

  it('demotes an Admin to User while another active Admin exists', () => {
    seed(SECOND_ADMIN, SECOND_ADMIN_SECRET, 'Admin');

    expect(call('admin.setUserRole', { email: SECOND_ADMIN, role: 'User' }, adminToken).ok).toBe(
      true,
    );
    expect(findByEmail(SECOND_ADMIN)?.role).toBe('User');
  });

  it('rejects a role outside the two the system has', () => {
    const response = call('admin.setUserRole', { email: STAFF, role: 'Owner' }, adminToken);

    expect(response.error?.fields?.['role']).toBeDefined();
    expect(findByEmail(STAFF)?.role).toBe('User');
  });
});

/* -------------------------------------------------------------------------- */
/* The last-Admin guard                                                       */
/* -------------------------------------------------------------------------- */

describe('the last active Admin', () => {
  it('cannot be deactivated', () => {
    const response = call('admin.setUserActive', { email: ADMIN, active: false }, adminToken);

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(findByEmail(ADMIN)?.active).toBe(true);
  });

  it('cannot be demoted to User', () => {
    const response = call('admin.setUserRole', { email: ADMIN, role: 'User' }, adminToken);

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(findByEmail(ADMIN)?.role).toBe('Admin');
  });

  it('CAN be deactivated once a second active Admin exists', () => {
    seed(SECOND_ADMIN, SECOND_ADMIN_SECRET, 'Admin');

    expect(call('admin.setUserActive', { email: ADMIN, active: false }, adminToken).ok).toBe(true);
    expect(findByEmail(ADMIN)?.active).toBe(false);
  });

  it('counts only ACTIVE Admins, so a deactivated one does not satisfy the guard', () => {
    seed(SECOND_ADMIN, SECOND_ADMIN_SECRET, 'Admin');
    call('admin.setUserActive', { email: SECOND_ADMIN, active: false }, adminToken);

    // One Admin row remains active. Demoting it must still be refused.
    expect(call('admin.setUserRole', { email: ADMIN, role: 'User' }, adminToken).error?.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('is not fooled by an inactive Admin being promoted-in-place', () => {
    seed(SECOND_ADMIN, SECOND_ADMIN_SECRET, 'User');
    call('admin.setUserActive', { email: SECOND_ADMIN, active: false }, adminToken);
    call('admin.setUserRole', { email: SECOND_ADMIN, role: 'Admin' }, adminToken);

    // SECOND_ADMIN is Admin but inactive, so it cannot cover for ADMIN.
    expect(
      call('admin.setUserActive', { email: ADMIN, active: false }, adminToken).error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('reads the Users sheet for its check INSIDE the lock', () => {
    /*
     * JavaScript is single-threaded, so a test cannot literally run two requests
     * at once. What it CAN prove is that the count the guard depends on is read
     * inside the critical section — which is the actual invariant. A check that
     * ran before the lock would be a snapshot two requests could each act on,
     * and the system would end up with zero Admins.
     *
     * The router resolves the caller from the same sheet before the handler
     * runs, so this asserts that a read happens WHILE held rather than that
     * every read does.
     */
    let held = false;
    let usersReadsWhileHeld = 0;

    const lock: UserLock = {
      tryLock: () => {
        held = true;
        return true;
      },
      releaseLock: () => {
        held = false;
      },
    };
    TEST_ONLY_setUserLock(lock);

    env.spreadsheet.onRead((sheetName: string) => {
      if (sheetName === USERS_SHEET_NAME && held) usersReadsWhileHeld += 1;
    });

    call('admin.setUserRole', { email: ADMIN, role: 'User' }, adminToken);
    env.spreadsheet.onRead(null);

    expect(usersReadsWhileHeld).toBeGreaterThan(0);
    // And the guard still fired: this is the last active Admin.
    expect(findByEmail(ADMIN)?.role).toBe('Admin');
  });

  it('refuses the operation when the lock cannot be taken', () => {
    TEST_ONLY_setUserLock({
      tryLock: () => false,
      releaseLock: () => undefined,
    });

    const response = call('admin.setUserActive', { email: STAFF, active: false }, adminToken);

    expect(response.error?.code).toBe('RATE_LIMITED');
    // Refused, not silently applied.
    expect(findByEmail(STAFF)?.active).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing secret escapes                                                     */
/* -------------------------------------------------------------------------- */

describe('password material never leaves the server', () => {
  it('is absent from the account list', () => {
    const serialised = JSON.stringify(listUsers(adminToken));
    const stored = findByEmail(STAFF);

    expect(serialised).not.toContain(stored?.passwordHash ?? 'unreachable');
    expect(serialised).not.toContain(stored?.salt ?? 'unreachable');
    expect(serialised).not.toContain(USER_SECRET);
    expect(serialised.toLowerCase()).not.toContain('hash');
    expect(serialised.toLowerCase()).not.toContain('salt');
  });

  it('is absent from every administrative response', () => {
    const responses = [
      call('admin.createUser', { email: 'new@speedxksa.com', password: NEW_SECRET, role: 'User' }, adminToken),
      call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken),
      call('admin.setUserActive', { email: STAFF, active: false }, adminToken),
      call('admin.setUserRole', { email: STAFF, role: 'Admin' }, adminToken),
    ];

    for (const response of responses) {
      const serialised = JSON.stringify(response);
      expect(serialised).not.toContain(NEW_SECRET);
      expect(serialised).not.toContain(USER_SECRET);
      expect(serialised.toLowerCase()).not.toContain('salt');
    }
  });

  it('is absent from the audit log', () => {
    call('admin.createUser', { email: 'new@speedxksa.com', password: NEW_SECRET, role: 'User' }, adminToken);
    call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken);
    call('admin.setUserActive', { email: STAFF, active: false }, adminToken);
    call('admin.setUserRole', { email: STAFF, role: 'Admin' }, adminToken);

    const stored = findByEmail(STAFF);

    for (const row of auditRows()) {
      for (const value of row) {
        if (typeof value !== 'string') continue;
        expect(value).not.toContain(NEW_SECRET);
        expect(value).not.toContain(USER_SECRET);
        expect(value).not.toContain(ADMIN_SECRET);
        expect(value).not.toContain(adminToken);
        expect(value).not.toContain(stored?.passwordHash ?? 'unreachable');
        expect(value).not.toContain(stored?.salt ?? 'unreachable');
        // The word itself is banned from this sheet by FORBIDDEN_IN_AUDIT, which
        // is why the action is named `resetUserCredential`.
        expect(value.toLowerCase()).not.toContain('password');
      }
    }
  });

  it('records who did what, so the actions are still auditable', () => {
    call('admin.resetUserCredential', { email: STAFF, newSecret: NEW_SECRET }, adminToken);

    const actions = auditRows().map((row) => String(row[2]));
    const actors = auditRows().map((row) => String(row[1]));

    expect(actions).toContain('admin.resetUserCredential');
    expect(actors).toContain(ADMIN);
  });

  it('audits activation and role changes with the resulting state', () => {
    call('admin.setUserActive', { email: STAFF, active: false }, adminToken);
    call('admin.setUserRole', { email: STAFF, role: 'Admin' }, adminToken);

    const targets = auditRows().map((row) => String(row[3]));

    expect(targets).toContain(`${STAFF} inactive`);
    expect(targets).toContain(`${STAFF} Admin`);
  });
});

/* -------------------------------------------------------------------------- */
/* The existing sign-in path is untouched                                     */
/* -------------------------------------------------------------------------- */

describe('existing authentication still works', () => {
  it('accepts the correct credential', () => {
    expect(login(ADMIN, ADMIN_SECRET)).not.toBeNull();
  });

  it('still rejects a wrong credential with the generic message', () => {
    const response = call('auth.login', { email: ADMIN, password: 'wrong-credential-entirely' });

    expect(response.error?.code).toBe('AUTH_INVALID');
    expect(response.error?.message).toBe('Invalid email or password.');
  });

  it('still issues a token that resolves to the right user and role', () => {
    const me = call('auth.me', {}, adminToken);

    expect(me.data).toEqual({ email: ADMIN, role: 'Admin' });
  });
});
