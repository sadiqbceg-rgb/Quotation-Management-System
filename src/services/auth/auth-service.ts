/**
 * Auth actions, over the shared API client.
 *
 * This module never touches storage or React state — that is AuthContext's job.
 * It only speaks to the backend.
 */

import { callAction } from '@/services/api/client';
import type { UserRole } from '@shared/types';

export interface AuthenticatedUser {
  email: string;
  role: UserRole;
}

export interface LoginResult {
  token: string;
  user: AuthenticatedUser;
}

export async function login(email: string, password: string): Promise<LoginResult> {
  return callAction<{ email: string; password: string }, LoginResult>('auth.login', {
    email,
    password,
  });
}

export async function logout(token: string): Promise<void> {
  await callAction<Record<string, never>, { ok: true }>('auth.logout', {}, { token });
}

/** Validate a rehydrated token and read back the authoritative role. */
export async function fetchCurrentUser(token: string): Promise<AuthenticatedUser> {
  return callAction<Record<string, never>, AuthenticatedUser>('auth.me', {}, { token });
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: UserRole;
}

/** Admin only — enforced by the backend, not by this function. */
export async function createUser(
  input: CreateUserInput,
  token: string,
): Promise<AuthenticatedUser> {
  return callAction<CreateUserInput, AuthenticatedUser>('admin.createUser', input, { token });
}

/* -------------------------------------------------------------------------- */
/* User administration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * An account as the user-management screen sees it.
 *
 * There is no hash, salt or iteration field, and that is deliberate: the server
 * strips them, and this type is the client-side statement of the same contract.
 */
export interface ManagedUser {
  email: string;
  role: UserRole;
  active: boolean;
  /** ISO string. Empty when the sheet has no value. */
  createdAt: string;
  /** ISO string. Empty until the account has signed in at least once. */
  lastLoginAt: string;
}

/**
 * Every account.
 *
 * Admin only — like every function below, the check that matters happens in
 * Apps Script. These wrappers add no authorization of their own.
 */
export async function listUsers(token: string): Promise<ManagedUser[]> {
  return callAction<Record<string, never>, ManagedUser[]>('admin.listUsers', {}, { token });
}

/**
 * Replace an account's sign-in credential.
 *
 * `newSecret`, not `newPassword`: the backend action is named to keep the word
 * out of the audit sheet, and the payload key matches so the two read the same.
 * The value is sent once over HTTPS and is never stored anywhere on the client.
 */
export async function resetUserCredential(
  email: string,
  newSecret: string,
  token: string,
): Promise<ManagedUser> {
  return callAction<{ email: string; newSecret: string }, ManagedUser>(
    'admin.resetUserCredential',
    { email, newSecret },
    { token },
  );
}

export async function setUserActive(
  email: string,
  active: boolean,
  token: string,
): Promise<ManagedUser> {
  return callAction<{ email: string; active: boolean }, ManagedUser>(
    'admin.setUserActive',
    { email, active },
    { token },
  );
}

export async function setUserRole(
  email: string,
  role: UserRole,
  token: string,
): Promise<ManagedUser> {
  return callAction<{ email: string; role: UserRole }, ManagedUser>(
    'admin.setUserRole',
    { email, role },
    { token },
  );
}
