/**
 * ===========================================================================
 * TEMPORARY — DEVELOPMENT ADMIN PASSWORD RECOVERY. DELETE AFTER USE.
 * ===========================================================================
 *
 * WHY THIS FILE EXISTS
 * ---------------------------------------------------------------------------
 * `runProvisioning` creates the FIRST Admin and refuses once any account
 * exists, and `admin.createUser` needs an authenticated Admin session. So a
 * deployment whose only Admin password has been lost has no way back in: the
 * one action that could fix it requires the thing that is missing.
 *
 * The repository already has every piece needed to repair that — this file
 * only assembles them. It introduces no cryptography, no new storage, and no
 * new privilege.
 *
 * ---------------------------------------------------------------------------
 * WHAT MAKES THIS SAFE, STATED HONESTLY
 * ---------------------------------------------------------------------------
 * It is NOT safe because of a "development only" check — there is no reliable
 * dev/prod discriminator available at runtime, and a check that looks like
 * protection without being it is worse than none.
 *
 * It is safe because of two real properties:
 *
 *   1. It is NOT in the ACTIONS table, so it is unreachable over HTTP. No
 *      request to the Web App can invoke it, authenticated or not.
 *   2. It grants nobody any privilege they did not already hold. Running it
 *      requires opening the Apps Script project and writing Script Properties
 *      — and anyone who can do that can already read PASSWORD_PEPPER directly.
 *
 * Its temporariness is the third control, and it is the operator's to enforce:
 * DELETE THIS FILE once you have signed in. `RUNBOOK.md` §9.6 carries the
 * procedure and the removal step.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *   - It does not touch SESSION_HMAC_SECRET or PASSWORD_PEPPER. The pepper is
 *     READ so the new hash matches every other hash in the sheet; rotating it
 *     would invalidate every OTHER account's password.
 *   - It does not create, delete or deactivate a user. It rewrites three cells
 *     of one existing row.
 *   - It does not change the Users sheet schema, the login path, or any
 *     hashing parameter.
 *   - It never logs the plaintext password, and never writes it to the audit
 *     sheet.
 */

import { writeAudit } from '../audit/audit-log';
import { requireProperty } from '../config/properties';
import { createPasswordRecord } from './password';
import * as users from '../sheets/users-repository';

/**
 * Temporary Script Properties, read once and deleted immediately.
 *
 * Same shape as the bootstrap properties in `provisioning.ts`, for the same
 * three reasons: `Code.js` is generated so editing it loses the change on the
 * next push, a password typed into source risks being committed, and the
 * editor's Run button only calls zero-argument functions.
 */
export const RECOVERY_EMAIL_PROPERTY = 'RECOVERY_ADMIN_EMAIL';
export const RECOVERY_PASSWORD_PROPERTY = 'RECOVERY_ADMIN_PASSWORD';

/** Matches `provisionFirstAdmin`, so recovery cannot set a weaker password. */
const MINIMUM_PASSWORD_LENGTH = 12;

/**
 * Reset one existing account's password. Run from the Apps Script editor.
 *
 * Reads the target email and the new password from the two temporary Script
 * Properties above, DELETES both before doing any work, then rewrites only
 * that account's password material.
 */
export function runAdminPasswordRecovery(): void {
  const store = PropertiesService.getScriptProperties();

  const email = store.getProperty(RECOVERY_EMAIL_PROPERTY) ?? '';
  const password = store.getProperty(RECOVERY_PASSWORD_PROPERTY) ?? '';

  /*
   * Cleared FIRST, exactly as `runProvisioning` does.
   *
   * Every branch below can throw — a missing pepper, an unreachable sheet — and
   * a throw after this point must not leave the new password sitting in
   * Project Settings where the next person to open the project can read it.
   */
  store.deleteProperty(RECOVERY_EMAIL_PROPERTY);
  store.deleteProperty(RECOVERY_PASSWORD_PROPERTY);

  if (email.length === 0 || password.length === 0) {
    console.log(
      `Set Script Properties ${RECOVERY_EMAIL_PROPERTY} and ${RECOVERY_PASSWORD_PROPERTY}, ` +
        'then run this again. Both are deleted automatically once read.',
    );
    return;
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    // The length only — never the value, and never a fragment of it.
    console.log(
      `Refused: the new password must be at least ${String(MINIMUM_PASSWORD_LENGTH)} characters. ` +
        'Set both properties again with a longer one.',
    );
    return;
  }

  const normalised = users.normaliseEmail(email);
  const record = users.findByEmail(normalised);

  if (record === null) {
    // Naming the address is not a disclosure here: the caller already has
    // owner access to the project and can open the Users sheet themselves.
    console.log(
      `Refused: no account exists for ${normalised}. ` +
        'Check the exact address in the Users sheet and try again.',
    );
    return;
  }

  /*
   * The SAME pepper every other hash in the sheet was built with, read and not
   * written. A fresh salt and the current default iteration count come from
   * `createPasswordRecord`, so the stored material is indistinguishable from
   * one produced by any other path.
   */
  const material = createPasswordRecord(password, requireProperty('PASSWORD_PEPPER'));

  users.updatePasswordMaterial(record, material.hash, material.salt, material.iterations);

  /*
   * The action name carries no "password".
   *
   * `security-review.test.ts` scans EVERY column of every audit row through
   * `isSafeAuditValue`, and `FORBIDDEN_IN_AUDIT` rejects /password/i. The
   * existing `auth.provisionFirstAdmin` entry follows the same convention.
   */
  writeAudit({
    actor: 'operator',
    action: 'auth.devAdminRecovery',
    target: normalised,
    outcome: 'success',
    requestId: 'dev-recovery',
  });

  console.log(
    `Password reset for ${normalised} (role: ${record.role}). ` +
      'Both temporary properties have been deleted.',
  );
  console.log(
    'NOW: sign in, confirm it works, then DELETE google-apps-script/src/auth/TEMP-dev-recovery.ts, ' +
      'remove its two references in main.ts and esbuild.config.mjs, and run `npm run gas:push`.',
  );
}
