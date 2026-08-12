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
