/**
 * Router, authorization and the end-to-end auth flow, against the fake host.
 *
 * These are the tests that protect the security boundary: the Apps Script
 * endpoint is publicly reachable, so "every non-public action refuses an
 * unauthenticated caller" has to be verified, not assumed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from './__fixtures__/gas-fakes';
import { ACTIONS, dailyBackup, doGet, handlePost } from './main';
import {
  BOOTSTRAP_EMAIL_PROPERTY,
  BOOTSTRAP_PASSWORD_PROPERTY,
  provisionFirstAdmin,
  runProvisioning,
} from './auth/provisioning';
import { createUser } from './sheets/users-repository';
import { createPasswordRecord } from './auth/password';
import { issueToken } from './auth/token';
import { AUDIT_SHEET_NAME } from './audit/audit-log';
import { USERS_SHEET_NAME } from './sheets/users-repository';

const SECRET = 'test-only-session-secret-not-a-real-key';
const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

interface Envelope {
  ok: boolean;
  requestId: string;
  data?: unknown;
  renewedToken?: string;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;

function post(body: unknown): Envelope {
  const output = handlePost(JSON.stringify(body)) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}, token?: string): Envelope {
  return post({
    action,
    requestId: 'test-request',
    payload,
    ...(token === undefined ? {} : { token }),
  });
}

function seedUser(email: string, role: 'Admin' | 'User', active = true): void {
  const material = createPasswordRecord(PASSWORD, PEPPER, 1_000);
  createUser({
    email,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role,
  });
  if (!active) {
    const sheet = env.spreadsheet.sheets.get(USERS_SHEET_NAME);
    const row = sheet?.rows[sheet.rows.length - 1];
    if (row !== undefined) row[5] = false;
  }
}

function loginAs(email: string): string {
  const response = call('auth.login', { email, password: PASSWORD });
  expect(response.ok).toBe(true);
  return (response.data as { token: string }).token;
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('envelope', () => {
  it('rejects an empty body', () => {
    expect(handlePost(undefined)).toBeDefined();
    const response = JSON.parse(
      (handlePost(undefined) as unknown as { getContent: () => string }).getContent(),
    ) as Envelope;
    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects non-JSON and non-object bodies', () => {
    const raw = handlePost('not json') as unknown as { getContent: () => string };
    expect((JSON.parse(raw.getContent()) as Envelope).error?.code).toBe('VALIDATION_FAILED');

    const array = handlePost('[1,2,3]') as unknown as { getContent: () => string };
    expect((JSON.parse(array.getContent()) as Envelope).error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an unknown action without echoing it back', () => {
    const response = call('does.not.exist');
    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response)).not.toContain('does.not.exist');
  });

  it('echoes the requestId so a user can quote it', () => {
    expect(call('health').requestId).toBe('test-request');
  });
});

describe('health', () => {
  it('is public and reports configuration by name only', () => {
    const response = call('health');
    expect(response.ok).toBe(true);

    const data = response.data as { configured: boolean; missing: string[] };
    expect(data.configured).toBe(true);
    expect(data.missing).toEqual([]);
    // Never a value.
    expect(JSON.stringify(response)).not.toContain(SECRET);
    expect(JSON.stringify(response)).not.toContain(PEPPER);
  });

  it('names missing configuration without disclosing any value', () => {
    env.properties.values.delete('SESSION_HMAC_SECRET');
    const data = call('health').data as { configured: boolean; missing: string[] };
    expect(data.configured).toBe(false);
    expect(data.missing).toContain('SESSION_HMAC_SECRET');
  });

  it('runs no Drive or Sheets probe for an anonymous caller', () => {
    /*
     * `health` is reachable by anyone who has the URL. Each probe is a real
     * Drive or Sheets round trip, so a public endpoint that performs them on
     * demand is a free way to spend the deployment's daily quota.
     */
    expect((call('health').data as { probes?: unknown }).probes).toBeUndefined();
  });
});

describe('admin.diagnostics', () => {
  beforeEach(() => {
    seedUser('user@speedxksa.com', 'User');
    seedUser('admin@speedxksa.com', 'Admin');
  });

  it('is refused to a signed-in User', () => {
    // It reports the whole configuration surface. Signed in is not sufficient.
    expect(call('admin.diagnostics', {}, loginAs('user@speedxksa.com')).error?.code).toBe(
      'FORBIDDEN',
    );
  });

  it('gives an Admin the configuration by name, and the probes', () => {
    const response = call('admin.diagnostics', {}, loginAs('admin@speedxksa.com'));
    expect(response.ok).toBe(true);

    const data = response.data as {
      probes?: { drive: string; sheets: string };
      configuration: { required: Array<{ name: string; set: boolean }> };
    };

    // Probes ARE run here — the caller is authenticated, so the quota spend is
    // attributable and bounded by the rate limiter.
    expect(data.probes).toEqual({ drive: 'ok', sheets: 'ok' });
    expect(data.configuration.required.map((entry) => entry.name)).toContain('SESSION_HMAC_SECRET');
    expect(data.configuration.required.every((entry) => entry.set)).toBe(true);
  });

  it('discloses no property value, to anyone, ever', () => {
    const serialised = JSON.stringify(
      call('admin.diagnostics', {}, loginAs('admin@speedxksa.com')),
    );

    for (const value of env.properties.values.values()) {
      if (value.trim().length === 0) continue;
      expect(serialised.includes(value), `leaked "${value}"`).toBe(false);
    }
  });

  it('is not reachable as a GET, which is the liveness probe only', () => {
    // `doGet` answers with the anonymous health payload and nothing more. A
    // diagnostics report served over GET would be readable from a browser
    // address bar by anyone with the URL.
    const body = JSON.parse(doGet().getContent()) as { data: { configuration?: unknown } };
    expect(body.data.configuration).toBeUndefined();
  });
});

describe('the daily backup entry point', () => {
  it('logs a failure rather than throwing into the trigger', () => {
    /*
     * A trigger that throws emails the project owner and disables itself. That
     * is the right response to something an operator must act on, and the wrong
     * one for a Drive hiccup at 02:00 — so the outcome is logged and read in
     * the weekly review instead.
     */
    env.properties.values.delete('TRACKING_SPREADSHEET_ID');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(() => {
      dailyBackup();
    }).not.toThrow();
    expect(logged.mock.calls.map(String).join('\n')).toContain('FAILED');

    logged.mockRestore();
  });

  it('logs the outcome of a successful run', () => {
    /*
     * The backup copies a real Drive FILE, so the tracking spreadsheet has to
     * exist in the fake Drive rather than merely being named by a property —
     * which is also true of the live deployment, and is the difference between
     * `copied` and `failed`.
     */
    const root = env.drive.service as { getFolderById: (id: string) => unknown };
    const file = (
      root.getFolderById('test-only-drive-root') as {
        createFile: (blob: unknown) => { getId: () => string };
      }
    ).createFile({
      getBytes: () => [1, 2, 3],
      getName: () => 'Quotation Tracking',
      getContentType: () => 'application/vnd.google-apps.spreadsheet',
    });
    env.properties.values.set('TRACKING_SPREADSHEET_ID', file.getId());

    const logged = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    dailyBackup();

    expect(logged.mock.calls.map(String).join('\n')).toContain('copied');
    logged.mockRestore();
  });
});

/* -------------------------------------------------------------------------- */

describe('authorization', () => {
  beforeEach(() => {
    seedUser('user@speedxksa.com', 'User');
    seedUser('admin@speedxksa.com', 'Admin');
  });

  it('refuses every non-public action without a token', () => {
    for (const [action, definition] of Object.entries(ACTIONS)) {
      if (definition.access === 'public') continue;
      expect(call(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });

  it('declares only health and login as public', () => {
    const publicActions = Object.entries(ACTIONS)
      .filter(([, definition]) => definition.access === 'public')
      .map(([action]) => action)
      .sort();

    expect(publicActions).toEqual(['auth.login', 'health']);
  });

  it('refuses an Admin action to a User', () => {
    const token = loginAs('user@speedxksa.com');
    const response = call(
      'admin.createUser',
      { email: 'new@speedxksa.com', password: 'a-long-enough-password', role: 'User' },
      token,
    );
    expect(response.error?.code).toBe('FORBIDDEN');
  });

  it('allows an Admin action to an Admin', () => {
    const token = loginAs('admin@speedxksa.com');
    const response = call(
      'admin.createUser',
      { email: 'new@speedxksa.com', password: 'a-long-enough-password', role: 'User' },
      token,
    );
    expect(response.ok).toBe(true);
    expect(response.data).toEqual({ email: 'new@speedxksa.com', role: 'User' });
  });

  it('rejects a forged token', () => {
    const forged = issueToken('admin@speedxksa.com', 'Admin', 'the-wrong-secret');
    expect(call('auth.me', {}, forged).error?.code).toBe('AUTH_INVALID');
  });

  it('rejects an expired token', () => {
    const expired = issueToken(
      'user@speedxksa.com',
      'User',
      SECRET,
      Math.floor(Date.now() / 1000) - 100_000,
    );
    expect(call('auth.me', {}, expired).error?.code).toBe('AUTH_EXPIRED');
  });

  it('takes the role from the sheet, not from the token claim', () => {
    // A token claiming Admin for an account that is only a User must not escalate.
    const claimedAdmin = issueToken('user@speedxksa.com', 'Admin', SECRET);
    const response = call('auth.me', {}, claimedAdmin);

    expect(response.ok).toBe(true);
    expect((response.data as { role: string }).role).toBe('User');
  });

  it('rejects a token for an account that no longer exists', () => {
    const ghost = issueToken('ghost@speedxksa.com', 'Admin', SECRET);
    expect(call('auth.me', {}, ghost).error?.code).toBe('AUTH_INVALID');
  });
});

/* -------------------------------------------------------------------------- */

describe('login', () => {
  beforeEach(() => {
    seedUser('user@speedxksa.com', 'User');
  });

  it('returns a token and the public user on success', () => {
    const response = call('auth.login', { email: 'user@speedxksa.com', password: PASSWORD });
    expect(response.ok).toBe(true);

    const data = response.data as { token: string; user: { email: string; role: string } };
    expect(data.user).toEqual({ email: 'user@speedxksa.com', role: 'User' });
    expect(data.token.split('.')).toHaveLength(3);
  });

  it('never returns password material', () => {
    const response = call('auth.login', { email: 'user@speedxksa.com', password: PASSWORD });
    const serialised = JSON.stringify(response);

    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain('passwordHash');
    expect(serialised).not.toContain('salt');
  });

  it('accepts any casing of the email', () => {
    expect(call('auth.login', { email: 'USER@SpeedXKSA.com', password: PASSWORD }).ok).toBe(true);
  });

  it('gives the same generic error for a wrong password and an unknown account', () => {
    const wrongPassword = call('auth.login', {
      email: 'user@speedxksa.com',
      password: 'wrong-password',
    });
    const unknownAccount = call('auth.login', {
      email: 'nobody@speedxksa.com',
      password: 'wrong-password',
    });

    expect(wrongPassword.error?.code).toBe('AUTH_INVALID');
    expect(unknownAccount.error?.code).toBe('AUTH_INVALID');
    expect(wrongPassword.error?.message).toBe(unknownAccount.error?.message);
  });

  it('gives the same generic error for a deactivated account', () => {
    seedUser('inactive@speedxksa.com', 'User', false);
    const response = call('auth.login', { email: 'inactive@speedxksa.com', password: PASSWORD });

    expect(response.error?.code).toBe('AUTH_INVALID');
    expect(response.error?.message).toBe('Invalid email or password.');
  });

  it('rejects a malformed email without touching the user sheet', () => {
    expect(call('auth.login', { email: 'not-an-email', password: PASSWORD }).error?.code).toBe(
      'AUTH_INVALID',
    );
  });

  it('locks the account after five failures and then refuses even the right password', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      call('auth.login', { email: 'user@speedxksa.com', password: 'wrong' });
    }

    const response = call('auth.login', { email: 'user@speedxksa.com', password: PASSWORD });
    expect(response.error?.code).toBe('RATE_LIMITED');
  });

  it('records the last login time', () => {
    call('auth.login', { email: 'user@speedxksa.com', password: PASSWORD });
    const row = env.spreadsheet.dataRows(USERS_SHEET_NAME)[0];
    expect(typeof row?.[7]).toBe('string');
    expect(row?.[7]).not.toBe('');
  });
});

/* -------------------------------------------------------------------------- */

describe('session lifecycle', () => {
  beforeEach(() => {
    seedUser('user@speedxksa.com', 'User');
  });

  it('auth.me returns the signed-in user', () => {
    const token = loginAs('user@speedxksa.com');
    expect(call('auth.me', {}, token).data).toEqual({
      email: 'user@speedxksa.com',
      role: 'User',
    });
  });

  it('logout revokes the token immediately', () => {
    const token = loginAs('user@speedxksa.com');

    expect(call('auth.logout', {}, token).ok).toBe(true);
    expect(call('auth.me', {}, token).error?.code).toBe('AUTH_EXPIRED');
  });

  it('logging out one session does not affect another', () => {
    const first = loginAs('user@speedxksa.com');
    const second = loginAs('user@speedxksa.com');

    call('auth.logout', {}, first);

    expect(call('auth.me', {}, first).ok).toBe(false);
    expect(call('auth.me', {}, second).ok).toBe(true);
  });

  it('renews a token that is close to expiry', () => {
    const almostExpired = issueToken(
      'user@speedxksa.com',
      'User',
      SECRET,
      Math.floor(Date.now() / 1000) - (8 * 60 * 60 - 600),
    );

    const response = call('auth.me', {}, almostExpired);
    expect(response.ok).toBe(true);
    expect(response.renewedToken).toBeDefined();
    expect(response.renewedToken).not.toBe(almostExpired);
  });

  it('does not renew a fresh token', () => {
    const token = loginAs('user@speedxksa.com');
    expect(call('auth.me', {}, token).renewedToken).toBeUndefined();
  });

  it('stops a deactivated user immediately, even with a valid token', () => {
    const token = loginAs('user@speedxksa.com');
    expect(call('auth.me', {}, token).ok).toBe(true);

    const sheet = env.spreadsheet.sheets.get(USERS_SHEET_NAME);
    const row = sheet?.rows[1];
    if (row !== undefined) row[5] = false;

    expect(call('auth.me', {}, token).error?.code).toBe('AUTH_INVALID');
  });
});

/* -------------------------------------------------------------------------- */

describe('admin.createUser', () => {
  beforeEach(() => {
    seedUser('admin@speedxksa.com', 'Admin');
  });

  it('validates email, password length and role', () => {
    const token = loginAs('admin@speedxksa.com');
    const response = call(
      'admin.createUser',
      { email: 'bad', password: 'short', role: 'Wizard' },
      token,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.error?.fields ?? {}).sort()).toEqual(['email', 'password', 'role']);
  });

  it('refuses a duplicate email', () => {
    const token = loginAs('admin@speedxksa.com');
    const response = call(
      'admin.createUser',
      { email: 'admin@speedxksa.com', password: 'a-long-enough-password', role: 'User' },
      token,
    );
    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('creates an account that can then sign in', () => {
    const token = loginAs('admin@speedxksa.com');
    call(
      'admin.createUser',
      { email: 'new@speedxksa.com', password: 'a-long-enough-password', role: 'User' },
      token,
    );

    expect(
      call('auth.login', { email: 'new@speedxksa.com', password: 'a-long-enough-password' }).ok,
    ).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe('first-admin provisioning', () => {
  it('creates the first Admin only while no account exists', () => {
    const first = provisionFirstAdmin('owner@speedxksa.com', 'a-long-enough-password');
    expect(first.created).toBe(true);

    const second = provisionFirstAdmin('other@speedxksa.com', 'a-long-enough-password');
    expect(second.created).toBe(false);
  });

  it('refuses a short password', () => {
    expect(provisionFirstAdmin('owner@speedxksa.com', 'short').created).toBe(false);
  });

  it('is not reachable through the action table', () => {
    expect(Object.keys(ACTIONS)).not.toContain('auth.provisionFirstAdmin');
    expect(Object.keys(ACTIONS)).not.toContain('provisionFirstAdmin');
  });

  it('creates the account from the bootstrap Script Properties', () => {
    env.properties.values.set(BOOTSTRAP_EMAIL_PROPERTY, 'owner@speedxksa.com');
    env.properties.values.set(BOOTSTRAP_PASSWORD_PROPERTY, 'a-long-enough-password');

    runProvisioning();

    expect(
      call('auth.login', { email: 'owner@speedxksa.com', password: 'a-long-enough-password' }).ok,
    ).toBe(true);
  });

  it('deletes the bootstrap properties so the password does not linger', () => {
    env.properties.values.set(BOOTSTRAP_EMAIL_PROPERTY, 'owner@speedxksa.com');
    env.properties.values.set(BOOTSTRAP_PASSWORD_PROPERTY, 'a-long-enough-password');

    runProvisioning();

    expect(env.properties.values.has(BOOTSTRAP_EMAIL_PROPERTY)).toBe(false);
    expect(env.properties.values.has(BOOTSTRAP_PASSWORD_PROPERTY)).toBe(false);
  });

  it('clears the bootstrap properties even when provisioning is refused', () => {
    // An account already exists, so provisioning declines — the password must
    // still not be left sitting in project settings.
    seedUser('existing@speedxksa.com', 'Admin');
    env.properties.values.set(BOOTSTRAP_EMAIL_PROPERTY, 'owner@speedxksa.com');
    env.properties.values.set(BOOTSTRAP_PASSWORD_PROPERTY, 'a-long-enough-password');

    runProvisioning();

    expect(env.properties.values.has(BOOTSTRAP_PASSWORD_PROPERTY)).toBe(false);
  });

  it('does nothing useful when the bootstrap properties are absent', () => {
    runProvisioning();
    expect(call('auth.login', { email: 'owner@speedxksa.com', password: 'x' }).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe('audit log', () => {
  beforeEach(() => {
    seedUser('user@speedxksa.com', 'User');
  });

  function auditRows(): unknown[][] {
    return env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
  }

  it('records a successful sign-in', () => {
    call('auth.login', { email: 'user@speedxksa.com', password: PASSWORD });

    const entry = auditRows().find((row) => row[2] === 'auth.login');
    expect(entry?.[1]).toBe('user@speedxksa.com');
    expect(entry?.[4]).toBe('success');
    expect(entry?.[5]).toBe('test-request');
  });

  it('records a failed sign-in and a lockout', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      call('auth.login', { email: 'user@speedxksa.com', password: 'wrong' });
    }

    const outcomes = auditRows().map((row) => row[4]);
    expect(outcomes).toContain('failure');
    expect(outcomes).toContain('denied');
  });

  it('records a sign-out', () => {
    const token = loginAs('user@speedxksa.com');
    call('auth.logout', {}, token);

    expect(auditRows().some((row) => row[2] === 'auth.logout')).toBe(true);
  });

  it('never writes a password or a token into the log', () => {
    const token = loginAs('user@speedxksa.com');
    call('auth.logout', {}, token);
    call('auth.login', { email: 'user@speedxksa.com', password: 'wrong' });

    const serialised = JSON.stringify(auditRows());
    expect(serialised).not.toContain(PASSWORD);
    expect(serialised).not.toContain(token);
    expect(serialised).not.toContain('wrong');
  });
});
