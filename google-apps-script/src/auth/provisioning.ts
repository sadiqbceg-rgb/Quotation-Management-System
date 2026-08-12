/**
 * First-run account provisioning.
 *
 * There is no self-registration and no default account (PRD §6, §33, §34), so
 * the very first Admin has to be created out of band. An operator runs
 * `provisionFirstAdmin` once from the Apps Script editor.
 *
 * Nothing here is reachable through the web app — these functions are not in
 * the action table.
 *
 * Procedure (also in google-apps-script/README.md):
 *
 *   1. Set SESSION_HMAC_SECRET and PASSWORD_PEPPER in Script Properties.
 *   2. In the Apps Script editor, edit the two constants in `runProvisioning`
 *      below, run it once, and confirm the log line.
 *   3. IMMEDIATELY clear the password out of the editor and save.
 *   4. Deliver the password to the person out of band. Never email it
 *      alongside the application URL.
 *
 * The password is typed into the editor rather than passed over HTTP because
 * the endpoint is public: an unauthenticated "create the first admin" action
 * would be a takeover primitive for whoever calls it first.
 */

import { requireProperty } from '../config/properties';
import { writeAudit } from '../audit/audit-log';
import { createPasswordRecord } from './password';
import * as users from '../sheets/users-repository';

export interface ProvisionResult {
  created: boolean;
  message: string;
}

/**
 * Create the first Admin.
 *
 * Refuses to run when any account already exists, so it cannot be used to
 * quietly add a second Admin later — that goes through `admin.createUser`.
 */
export function provisionFirstAdmin(email: string, password: string): ProvisionResult {
  if (!users.isEmpty()) {
    return {
      created: false,
      message: 'Accounts already exist. Use the admin.createUser action instead.',
    };
  }

  if (password.length < 12) {
    return { created: false, message: 'Choose a password of at least 12 characters.' };
  }

  const material = createPasswordRecord(password, requireProperty('PASSWORD_PEPPER'));
  const normalised = users.normaliseEmail(email);

  users.createUser({
    email: normalised,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role: 'Admin',
  });

  writeAudit({
    actor: 'system',
    action: 'auth.provisionFirstAdmin',
    target: normalised,
    outcome: 'success',
    requestId: 'provisioning',
  });

  return { created: true, message: `Admin account created for ${normalised}.` };
}

/**
 * Operator entry point. Fill in the two constants, run once, then clear them.
 *
 * Left empty on purpose: committing a real address or password here would put
 * a credential in version control.
 */
export function runProvisioning(): void {
  const email = '';
  const password = '';

  if (email.length === 0 || password.length === 0) {
    console.log('Set the email and password constants in runProvisioning() before running it.');
    return;
  }

  console.log(provisionFirstAdmin(email, password).message);
}
