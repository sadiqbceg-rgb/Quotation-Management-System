#!/usr/bin/env node
/**
 * Generate the two Script Property secrets for a new deployment.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A SCRIPT AND NOT A LINE IN THE RUNBOOK
 * ---------------------------------------------------------------------------
 * "Pick a long random string" is the instruction that produces
 * `SpeedFalcon2026!` in production. The two values below are the whole of the
 * system's cryptographic strength — one signs every session token, the other is
 * mixed into every password hash — and neither is ever typed by a human or
 * memorised by one, so there is no reason for them to be anything less than
 * full-entropy random.
 *
 * So the operator runs this, copies two values into the Script Properties UI,
 * and closes the terminal. No judgement is required and none is invited.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------------
 *   - It does not write a file. A secret on disk is a secret in a backup, in a
 *     `git add -A`, and in the next `tar` of the home directory. It prints to
 *     stdout and stops.
 *   - It does not touch `.env` anything. These are BACKEND properties; the
 *     frontend must never see them, and a script that offers to write them into
 *     an env file is a script that will one day write them into `.env.production`
 *     and ship them in the bundle.
 *   - It does not talk to Google. Setting the properties is a deliberate,
 *     authenticated act by the operator in a UI that shows them what changed.
 *
 * Usage:
 *   node scripts/generate-secrets.ts            # both secrets, human readable
 *   node scripts/generate-secrets.ts --json     # for piping into a password manager
 */

import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';

/**
 * 32 bytes = 256 bits.
 *
 * HMAC-SHA256 has a 256-bit output, so a key longer than that buys nothing; a
 * key shorter than that is the weakest link in the token signature. PBKDF2's
 * pepper is not length-bound in the same way, but there is no reason to give it
 * less.
 */
export const SECRET_BYTES = 32;

/** The Script Properties this generates. Nothing else here is a secret. */
export const GENERATED_PROPERTIES = ['SESSION_HMAC_SECRET', 'PASSWORD_PEPPER'] as const;

export type GeneratedProperty = (typeof GENERATED_PROPERTIES)[number];

/**
 * One secret.
 *
 * base64url, so it survives copy-paste through the Script Properties UI, a
 * password manager, and a terminal without a `+` or a `/` being mangled or a
 * trailing `=` being dropped by something helpful.
 */
export function generateSecret(bytes: number = SECRET_BYTES): string {
  if (!Number.isInteger(bytes) || bytes < SECRET_BYTES) {
    // A caller asking for fewer than 32 bytes is a caller weakening the system,
    // whatever their reason. There is no legitimate one.
    throw new Error(`A secret must be at least ${String(SECRET_BYTES)} random bytes.`);
  }

  return randomBytes(bytes).toString('base64url');
}

export function generateSecrets(): Record<GeneratedProperty, string> {
  return {
    SESSION_HMAC_SECRET: generateSecret(),
    PASSWORD_PEPPER: generateSecret(),
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation                                                               */
/* -------------------------------------------------------------------------- */

/** What each one is for, so an operator pasting them knows what they hold. */
const PURPOSE: Record<GeneratedProperty, string> = {
  SESSION_HMAC_SECRET: 'Signs every session token. Changing it signs every user out immediately.',
  PASSWORD_PEPPER:
    'Mixed into every password hash. Changing it invalidates EVERY existing password.',
};

export function renderHuman(secrets: Record<GeneratedProperty, string>): string {
  const lines: string[] = [
    '',
    'Two secrets for a new deployment. Paste each into',
    'Apps Script → Project Settings → Script Properties.',
    '',
  ];

  for (const name of GENERATED_PROPERTIES) {
    lines.push(`${name}`, `  ${secrets[name]}`, `  ${PURPOSE[name]}`, '');
  }

  lines.push(
    'Then:',
    '  1. Store both in the company password manager. They cannot be recovered',
    '     from the deployment, and losing PASSWORD_PEPPER means every user must',
    '     have their password reset by an Admin.',
    '  2. Close this terminal. Clear the scrollback if it is shared.',
    '  3. Do NOT commit these, put them in a .env file, or send them over chat.',
    '',
    'These are BACKEND properties. The frontend never sees them, and',
    '`npm run verify:build` fails the build if either name appears in it.',
    '',
  );

  return lines.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                */
/* -------------------------------------------------------------------------- */

function main(): void {
  const secrets = generateSecrets();

  if (process.argv.includes('--json')) {
    // For a password manager's import. Still stdout, still never a file.
    console.log(JSON.stringify(secrets, null, 2));
    return;
  }

  console.log(renderHuman(secrets));
}

// Run only when invoked directly, so the generator can be imported by a test.
if (process.argv[1] !== undefined && basename(process.argv[1]) === 'generate-secrets.ts') {
  main();
}
