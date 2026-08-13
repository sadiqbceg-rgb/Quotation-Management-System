/**
 * TEST ONLY — the real Apps Script backend, served to a real browser.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A DEVELOPMENT DEPLOYMENT
 * ---------------------------------------------------------------------------
 * The phase brief allows either a development deployment or a fully mocked
 * backend, and is explicit that E2E must never need production credentials. A
 * deployment would need a real Google account, a real spreadsheet and a real
 * Drive folder — none of which CI has, and none of which should be created to
 * run a test suite.
 *
 * So the browser is real, the application is real, and the backend is the real
 * `handlePost` router running in the Playwright process against the same
 * in-memory Google fakes the unit suites use. Only the network hop is faked:
 * `page.route` intercepts the endpoint and hands the request body straight to
 * the router.
 *
 * What that means for these specs: a response the backend cannot actually
 * produce cannot appear in them, and a field the frontend reads but the backend
 * never sends fails here rather than in production.
 */

import type { Page, Route } from '@playwright/test';

import {
  installGasFakes,
  type GasEnvironment,
} from '../../google-apps-script/src/__fixtures__/gas-fakes';
import { handlePost } from '../../google-apps-script/src/main';
import {
  createPasswordRecord,
  MIN_PBKDF2_ITERATIONS,
} from '../../google-apps-script/src/auth/password';
import { createUser } from '../../google-apps-script/src/sheets/users-repository';
import {
  createPerson,
  setSignatureFileId,
} from '../../google-apps-script/src/sheets/persons-sheet';
import { createTerm } from '../../google-apps-script/src/sheets/terms-sheet';
import { storeSignature } from '../../google-apps-script/src/drive/signature-storage';
import { TEST_ONLY_buildPng } from '../../google-apps-script/src/__fixtures__/png-fixtures';

/**
 * The endpoint the app is built against for E2E.
 *
 * Not a real deployment: `TEST_ONLY-e2e-deployment` is not a script id, and
 * every request to it is intercepted before it leaves the browser. It is set on
 * the dev server by `playwright.config.ts`.
 */
export const E2E_ENDPOINT = 'https://script.google.com/macros/s/TEST_ONLY-e2e-deployment/exec';

export const E2E_EMAIL = 'staff@speedxksa.com';
export const E2E_ADMIN_EMAIL = 'admin@speedxksa.com';

/**
 * Not a credential.
 *
 * A literal used to seed an in-memory user sheet that lives for the length of
 * one test. It unlocks nothing, and there is nothing outside this process for
 * it to unlock. No test credential is ever read from the environment, so CI
 * needs no secret to run these (Phase 13, Security Requirements).
 */
export const E2E_PASSWORD = 'TEST_ONLY_correct-horse-battery';

const PEPPER = 'test-only-pepper-not-a-real-key';

/**
 * PBKDF2 iterations for the accounts this seeds: the lowest the module accepts.
 * See `test/fakes/backend.ts` — the floor is a real control, so it is imported
 * rather than copied.
 */
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;

/** The password material, derived once per worker. See `test/fakes/backend.ts`. */
let material: ReturnType<typeof createPasswordRecord> | null = null;

function passwordMaterial(): ReturnType<typeof createPasswordRecord> {
  material ??= createPasswordRecord(E2E_PASSWORD, PEPPER, TEST_ITERATIONS);
  return material;
}

export interface MockBackend {
  /** The fake Google host, for asserting on Drive folders and register rows. */
  env: GasEnvironment;
  /** Every action the browser invoked, in order. */
  actions: string[];
  /** The id of the seeded authorized person. */
  signatoryId: string;
  /** Make the next Drive file creation fail, to drive the retry path. */
  failNextDriveWrite: (message?: string) => void;
}

function stubGlobal(name: string, value: unknown): void {
  (globalThis as Record<string, unknown>)[name] = value;
}

export interface MockBackendOptions {
  /** Seed an Admin as well, for the Admin-only routes. */
  withAdmin?: boolean;
  /** Seed the Terms & Conditions library. */
  terms?: Array<{ title: string; body: string }>;
}

/**
 * Install the fake Google host and route the app's endpoint into the router.
 *
 * Call from `beforeEach`. The fakes are reinstalled per test, so no state
 * survives from one to the next.
 */
export async function useMockBackend(
  page: Page,
  options: MockBackendOptions = {},
): Promise<MockBackend> {
  const env = installGasFakes(stubGlobal);
  const actions: string[] = [];
  let pendingDriveFailure: string | null = null;

  /* ---- accounts ---------------------------------------------------------- */

  function seedUser(email: string, role: 'Admin' | 'User'): void {
    const seeded = passwordMaterial();
    createUser({
      email,
      passwordHash: seeded.hash,
      salt: seeded.salt,
      iterations: seeded.iterations,
      role,
    });
  }

  seedUser(E2E_EMAIL, 'User');
  if (options.withAdmin === true) seedUser(E2E_ADMIN_EMAIL, 'Admin');

  /* ---- the person who signs ---------------------------------------------- */

  const person = createPerson({
    id: 'TEST_ONLY-person-1',
    name: 'TEST_ONLY_Signatory',
    designation: 'TEST_ONLY Designation',
    companyName: 'TEST_ONLY Company',
    country: 'TEST_ONLY Country',
    email: 'test-only.signatory@example.invalid',
    phone: '+966 50 000 0000',
  });

  /*
   * A signature that actually loads.
   *
   * Stored through `storeSignature`, so the file really exists in the fake
   * Drive and `persons.getSignature` really reads it back. Pointing the record
   * at an id with no file behind it left every quotation refusing to be issued
   * — correctly, since PRD §36 requires a signature — which is not the thing
   * these journeys are meant to be testing.
   *
   * It is NOT a signature: a flat PNG, per PRD §34. No real signature file
   * exists in this repository and none may be invented.
   */
  const stored = storeSignature(
    person.id,
    TEST_ONLY_buildPng({ width: 640, height: 120 }),
    'TEST_ONLY-signature.png',
  );
  setSignatureFileId(person, stored.fileId);

  /* ---- the terms library -------------------------------------------------- */

  (options.terms ?? []).forEach((term, index) => {
    createTerm({
      id: `TEST_ONLY-term-${String(index + 1)}`,
      title: term.title,
      bodyTemplate: term.body,
      category: 'General',
      sortOrder: index + 1,
      updatedBy: E2E_EMAIL,
    });
  });

  /* ---- the transport ------------------------------------------------------ */

  await page.route(`${E2E_ENDPOINT}**`, async (route: Route) => {
    const body = route.request().postData() ?? '';

    try {
      const parsed = JSON.parse(body) as { action?: unknown };
      actions.push(typeof parsed.action === 'string' ? parsed.action : '(no action)');
    } catch {
      actions.push('(unparseable)');
    }

    if (pendingDriveFailure !== null) {
      env.drive.failNextCreate(pendingDriveFailure);
      pendingDriveFailure = null;
    }

    const output = handlePost(body) as unknown as { getContent: () => string };

    await route.fulfill({
      status: 200,
      contentType: 'text/plain;charset=utf-8',
      // The response of a CORS simple request still needs this header for the
      // browser to expose the body — the same one a real deployment sends.
      headers: { 'access-control-allow-origin': '*' },
      body: output.getContent(),
    });
  });

  return {
    env,
    actions,
    signatoryId: person.id,
    failNextDriveWrite(message = 'An unexpected error occurred.') {
      pendingDriveFailure = message;
    },
  };
}
