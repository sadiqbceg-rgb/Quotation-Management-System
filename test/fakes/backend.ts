/**
 * TEST ONLY — the REAL Apps Script backend, reachable over a faked `fetch`.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * The frontend suites stub `fetch` with hand-written response bodies. That
 * proves the browser handles a given shape, and nothing at all about whether
 * the backend ever produces that shape. The backend suites drive `handlePost`
 * directly, which proves the reverse. The gap between them is the envelope
 * itself — the contract both sides believe in and neither one checks.
 *
 * So this wires the two together: `fetch` is replaced with a function that
 * hands the request body to the real `handlePost`, running against the same
 * in-memory Google fakes, and returns its real response. Nothing leaves the
 * machine, nothing touches a Google service, and the only thing faked is the
 * network.
 *
 * What that buys: a field the backend renames, a code the frontend does not map,
 * a payload key that differs by a letter — all become failures here rather than
 * in production.
 *
 * Node-only, and importable from `*.test.ts` only.
 */

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

/** The pepper the fake environment is installed with. */
const TEST_PEPPER = 'test-only-pepper-not-a-real-key';

/**
 * PBKDF2 iterations for the accounts this seeds: the lowest the module accepts.
 *
 * `hashPassword` refuses anything below `MIN_PBKDF2_ITERATIONS`, and that floor
 * is a real control, so the tests take the floor rather than a convenient
 * literal — and import it, so lowering it in production cannot silently lower
 * it here. Production tunes the cost far higher (SECURITY.md).
 *
 * The relative cost is unchanged either way, so the timing-parity test in
 * `auth-flow.test.tsx` still measures what it is meant to: an unknown account
 * burns the same work as a known one, whatever that work is.
 */
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;

/**
 * The password material, derived ONCE per worker.
 *
 * Every test builds a fresh backend and therefore re-seeds its accounts, and
 * PBKDF2 at the module's minimum cost is genuinely expensive — deriving it per
 * account doubled the work for a value that never changes. The sign-in that
 * follows still runs a real verification hash.
 */
let material: ReturnType<typeof createPasswordRecord> | null = null;

function passwordMaterial(): ReturnType<typeof createPasswordRecord> {
  material ??= createPasswordRecord(TEST_ONLY_PASSWORD, TEST_PEPPER, TEST_ITERATIONS);
  return material;
}

/**
 * Not a credential.
 *
 * A literal used to seed a fake in-memory user sheet that exists for the length
 * of one test. It is not a password to anything, and nothing it unlocks exists
 * outside the process (Phase 13, Security Requirements).
 */
export const TEST_ONLY_PASSWORD = 'TEST_ONLY_correct-horse-battery';

export interface FakeBackend {
  /** The fake Google host, for asserting on Drive folders and sheet rows. */
  env: GasEnvironment;
  /** Every request the browser sent, in order, as the backend received it. */
  requests: Array<{ action: string; payload: unknown }>;
  /** Seed an account and return a signed-in token. */
  signIn: (email: string, role?: 'Admin' | 'User') => string;
  /** Seed an authorized person with a signature, and return their id. */
  seedSignatory: (name?: string) => string;
  /** Make the NEXT request fail at the transport, as a dropped connection does. */
  failNextRequest: (message?: string) => void;
  /** Stop routing and restore the globals. */
  teardown: () => void;
}

interface FetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/**
 * Install the fake host and route `fetch` into the real router.
 *
 * `stub` is Vitest's `vi.stubGlobal`, passed in so this module stays free of a
 * test-framework import, exactly as `installGasFakes` does.
 */
export function createFakeBackend(
  stub: (name: string, value: unknown) => void,
  properties: Record<string, string> = {},
): FakeBackend {
  const env = installGasFakes(stub, properties);
  const requests: Array<{ action: string; payload: unknown }> = [];

  let transportFailure: string | null = null;
  let personCounter = 0;

  function route(_input: unknown, init?: { body?: unknown }): Promise<FetchResponse> {
    if (transportFailure !== null) {
      const message = transportFailure;
      transportFailure = null;
      return Promise.reject(new TypeError(message));
    }

    const body = typeof init?.body === 'string' ? init.body : '';

    try {
      const parsed = JSON.parse(body) as { action?: unknown; payload?: unknown };
      requests.push({
        action: typeof parsed.action === 'string' ? parsed.action : '(no action)',
        payload: parsed.payload,
      });
    } catch {
      // An unparseable body is a valid thing to send the router; it answers with
      // a typed error, and that path deserves to be reachable from here too.
      requests.push({ action: '(unparseable)', payload: body });
    }

    const output = handlePost(body) as unknown as { getContent: () => string };
    const content = output.getContent();

    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(content),
    });
  }

  stub('fetch', route);

  return {
    env,
    requests,

    signIn(email: string, role: 'Admin' | 'User' = 'User'): string {
      const seeded = passwordMaterial();
      createUser({
        email,
        passwordHash: seeded.hash,
        salt: seeded.salt,
        iterations: seeded.iterations,
        role,
      });

      const output = handlePost(
        JSON.stringify({
          action: 'auth.login',
          requestId: 'test-sign-in',
          payload: { email, password: TEST_ONLY_PASSWORD },
        }),
      ) as unknown as { getContent: () => string };

      const response = JSON.parse(output.getContent()) as {
        ok: boolean;
        data?: { token?: string };
        error?: { code: string; message: string };
      };

      if (!response.ok || response.data?.token === undefined) {
        // Loudly, with the reason: a helper that returns `undefined` here would
        // surface as "AUTH_REQUIRED" ten assertions later.
        throw new Error(
          `createFakeBackend.signIn("${email}") failed: ${response.error?.code ?? 'no token'}`,
        );
      }
      return response.data.token;
    },

    seedSignatory(name = 'TEST_ONLY_Signatory'): string {
      personCounter += 1;
      const person = createPerson({
        id: `TEST_ONLY-person-${String(personCounter)}`,
        name,
        designation: 'TEST_ONLY Designation',
        companyName: 'TEST_ONLY Company',
        country: 'TEST_ONLY Country',
        email: `test-only.person-${String(personCounter)}@example.invalid`,
        phone: '+966 50 000 0000',
      });
      // A person with no signature cannot be finalized against (PRD §36).
      setSignatureFileId(person, `TEST_ONLY-signature-${String(personCounter)}`);
      return person.id;
    },

    failNextRequest(message = 'TEST_ONLY simulated network failure'): void {
      transportFailure = message;
    },

    teardown(): void {
      transportFailure = null;
    },
  };
}
