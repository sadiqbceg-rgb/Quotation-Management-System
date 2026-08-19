/**
 * The `Users` sheet.
 *
 * See IMPLEMENTATION_PLAN.md §17.3 and §18.
 *
 * Login accounts only. An *authorized person* (Phase 06) is a signatory record
 * and is deliberately a separate concept in a separate sheet — a signatory must
 * never gain the ability to sign in by existing.
 *
 * This sheet holds password material. It is a protected, hidden range in the
 * production spreadsheet, and nothing here is ever returned to a client.
 */

import type { Role } from '../auth/token';
import {
  appendRow,
  asBoolean,
  asInteger,
  asText,
  findRow,
  getOrCreateSheet,
  readRows,
  setCell,
} from './sheet-access';

export const USERS_SHEET_NAME = 'Users';

export const USERS_HEADERS = [
  'Email',
  'Password Hash',
  'Salt',
  'Iterations',
  'Role',
  'Active',
  'Created At',
  'Last Login At',
] as const;

const COLUMN = {
  email: 0,
  passwordHash: 1,
  salt: 2,
  iterations: 3,
  role: 4,
  active: 5,
  createdAt: 6,
  lastLoginAt: 7,
} as const;

export interface UserRecord {
  email: string;
  passwordHash: string;
  salt: string;
  iterations: number;
  role: Role;
  active: boolean;
  createdAt: string;
  lastLoginAt: string;
  /** 1-based sheet row, for in-place updates. */
  rowNumber: number;
}

/** Emails are stored and compared lower-cased so casing cannot fork an account. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(USERS_SHEET_NAME, USERS_HEADERS);
}

function toRecord(values: unknown[], rowNumber: number): UserRecord {
  const role = asText(values[COLUMN.role]) === 'Admin' ? 'Admin' : 'User';
  return {
    email: asText(values[COLUMN.email]),
    passwordHash: asText(values[COLUMN.passwordHash]),
    salt: asText(values[COLUMN.salt]),
    iterations: asInteger(values[COLUMN.iterations], 0),
    role,
    active: asBoolean(values[COLUMN.active]),
    createdAt: asText(values[COLUMN.createdAt]),
    lastLoginAt: asText(values[COLUMN.lastLoginAt]),
    rowNumber,
  };
}

export function findByEmail(email: string): UserRecord | null {
  const found = findRow(sheet(), COLUMN.email, normaliseEmail(email));
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

export function emailExists(email: string): boolean {
  return findByEmail(email) !== null;
}

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  salt: string;
  iterations: number;
  role: Role;
}

export function createUser(input: CreateUserInput): UserRecord {
  const email = normaliseEmail(input.email);
  const createdAt = new Date().toISOString();

  appendRow(sheet(), [
    email,
    input.passwordHash,
    input.salt,
    input.iterations,
    input.role,
    true,
    createdAt,
    '',
  ]);

  return {
    email,
    passwordHash: input.passwordHash,
    salt: input.salt,
    iterations: input.iterations,
    role: input.role,
    active: true,
    createdAt,
    lastLoginAt: '',
    rowNumber: sheet().getLastRow(),
  };
}

export function recordLogin(user: UserRecord, at: string = new Date().toISOString()): void {
  setCell(sheet(), user.rowNumber, COLUMN.lastLoginAt + 1, at);
}

/** Rewrite a user's password material, e.g. after raising the iteration count. */
export function updatePasswordMaterial(
  user: UserRecord,
  passwordHash: string,
  salt: string,
  iterations: number,
): void {
  const target = sheet();
  setCell(target, user.rowNumber, COLUMN.passwordHash + 1, passwordHash);
  setCell(target, user.rowNumber, COLUMN.salt + 1, salt);
  setCell(target, user.rowNumber, COLUMN.iterations + 1, iterations);
}

export function setActive(user: UserRecord, active: boolean): void {
  setCell(sheet(), user.rowNumber, COLUMN.active + 1, active);
}

export function setRole(user: UserRecord, role: Role): void {
  setCell(sheet(), user.rowNumber, COLUMN.role + 1, role);
}

/**
 * Every account, in sheet order.
 *
 * Rows with no email are skipped rather than returned as a blank user: a
 * trailing formatted-but-empty row is a normal thing to find in a spreadsheet
 * somebody has opened, and it is not an account.
 *
 * This returns the FULL record, password material included, because it is the
 * repository's job to read the sheet and not its job to decide what a client
 * may see. `toPublicUser` in auth/handlers.ts is the single place that strips
 * it, and a test asserts no hash or salt survives that boundary.
 */
export function listAll(): UserRecord[] {
  const rows = readRows(sheet());
  const records: UserRecord[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.email]).length === 0) continue;
    records.push(toRecord(row, index + 2));
  }

  return records;
}

/**
 * How many accounts are both `Admin` and `active`.
 *
 * The last-Admin guard is built on this. It counts from a single read so the
 * answer is consistent within one pass; callers run it inside the script lock
 * (see `withUserLock` in auth/handlers.ts), because on its own a count is a
 * snapshot that two concurrent requests could each act on.
 */
export function countActiveAdmins(): number {
  let count = 0;
  for (const record of listAll()) {
    if (record.role === 'Admin' && record.active) count++;
  }
  return count;
}

/** True when the sheet holds no accounts — used to gate first-run provisioning. */
export function isEmpty(): boolean {
  return readRows(sheet()).length === 0;
}
