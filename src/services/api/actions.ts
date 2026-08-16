/**
 * The action catalogue spoken to the Google Apps Script backend.
 *
 * See IMPLEMENTATION_PLAN.md §15.5. The backend declares the required role for
 * each of these in a single central table and enforces it in the router, before
 * any Drive or Sheets access.
 *
 * Only `health` is wired in Phase 01. Later phases implement the rest; the names
 * live here from the start so the frontend and backend cannot drift apart on
 * spelling.
 */

export const ACTION_NAMES = [
  'health',

  // Phase 02
  'auth.login',
  'auth.logout',
  'auth.me',
  'admin.createUser',

  // Phase 14 — Admin-only deployment diagnostics: configuration completeness
  // plus Drive and Sheets reachability. Names and booleans only.
  'admin.diagnostics',

  // Phase 03
  'quotation.reserveNumber',
  'quotation.save',
  'quotation.discardDraft',
  'quotation.get',
  'quotation.list',
  'quotation.updateStatus',

  // Phase 10 — carries the generated PDF and DOCX as base64 in the body.
  'quotation.uploadToDrive',

  // Phase 11 — writes the tracking row when the Drive save succeeded but the
  // register write did not. Sends only the draft id; no documents.
  'quotation.recordTracking',

  // Phase 04
  'items.list',
  'items.create',
  'items.update',
  'items.deactivate',

  // Phase 05
  'terms.list',
  'terms.create',
  'terms.update',
  'terms.deactivate',
  'terms.reorder',
  'admin.importReferenceTerms',

  // Phase 06
  'persons.list',
  'persons.create',
  'persons.update',
  'persons.deactivate',
  'persons.uploadSignature',
  // Authenticated, and the ONLY route out of Drive for a signature image.
  // There is no public URL for one anywhere in the system.
  'persons.getSignature',

  // Clients library
  'clients.list',
  'clients.create',
  'clients.update',

  // Settings
  'settings.get',
  'settings.update',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export interface HealthResponse {
  status: 'ok';
  /** Whether every required Script Property is present. Never reveals values. */
  configured: boolean;
  /** Names of missing configuration keys, so an operator can fix a deployment. */
  missing: string[];
  version: string;
  serverTime: string;
}
