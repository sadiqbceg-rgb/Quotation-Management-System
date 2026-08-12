/**
 * Authorized Persons actions, over the shared API client.
 *
 * There is no public signature URL in this system. `fetchSignature` is the only
 * way to obtain the image, it requires a session, and it returns base64 that
 * the caller holds in memory. Nothing here writes to `localStorage`,
 * `sessionStorage`, IndexedDB or a cache — a signature is a legal mark and must
 * not outlive the tab (IMPLEMENTATION_PLAN.md §11.2).
 */

import { callAction } from '@/services/api/client';
import { base64Png, type Base64Png } from '@shared/signature';

/** The library record. Distinct from the snapshot a quotation stores. */
export interface AuthorizedPerson {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  /** Whether a signature exists. The Drive file id never leaves the server. */
  hasSignature: boolean;
  /** Active AND has a signature — the rule for appearing in the selector. */
  selectable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonInput {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
}

export async function listPersons(
  token: string,
  includeInactive = false,
): Promise<AuthorizedPerson[]> {
  return callAction<{ includeInactive: boolean }, AuthorizedPerson[]>(
    'persons.list',
    { includeInactive },
    { token },
  );
}

export async function createPerson(
  input: PersonInput,
  token: string,
): Promise<AuthorizedPerson> {
  return callAction<PersonInput, AuthorizedPerson>('persons.create', input, { token });
}

export async function updatePerson(
  input: PersonInput & { id: string },
  token: string,
): Promise<AuthorizedPerson> {
  return callAction<typeof input, AuthorizedPerson>('persons.update', input, { token });
}

/** Soft delete / restore. Refused server-side while an unissued draft uses them. */
export async function setPersonActive(
  id: string,
  active: boolean,
  token: string,
): Promise<AuthorizedPerson> {
  return callAction<{ id: string; active: boolean }, AuthorizedPerson>(
    'persons.deactivate',
    { id, active },
    { token },
  );
}

export interface UploadSignatureResult {
  id: string;
  hasSignature: true;
  /** Non-fatal notes — a missing alpha channel, a low resolution. */
  warnings: string[];
  width: number;
  height: number;
}

export async function uploadSignature(
  input: { id: string; signature: string; filename: string },
  token: string,
): Promise<UploadSignatureResult> {
  return callAction<typeof input, UploadSignatureResult>('persons.uploadSignature', input, {
    token,
  });
}

/**
 * Fetch one signature image as base64.
 *
 * Branded on the way in, so the value cannot later be mistaken for a URL.
 */
export async function fetchSignature(id: string, token: string): Promise<Base64Png> {
  const response = await callAction<{ id: string }, { id: string; signature: string }>(
    'persons.getSignature',
    { id },
    { token },
  );

  return base64Png(response.signature);
}
