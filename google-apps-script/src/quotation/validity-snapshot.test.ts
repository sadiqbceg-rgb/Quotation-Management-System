/**
 * The quotation validity period, as a SNAPSHOT (R-4).
 *
 * ---------------------------------------------------------------------------
 * WHAT WENT WRONG
 * ---------------------------------------------------------------------------
 * `quotationValidityDays` is a Company Settings default. Every other default —
 * the VAT rate, the closing paragraph, the client's details — is copied ONTO the
 * quotation when it is created and read from there forever after. This one was
 * not stored anywhere, so the only way to obtain it later was to ask Company
 * Settings what it says today. A quotation issued for 30 days therefore became
 * a 45-day quotation the moment an administrator changed the default, because
 * the term "This quotation shall remain valid for {{quotation.validityDays}}
 * days from the date of issue" was re-resolved against the new value.
 *
 * It now lives on the record beside `vatRateBasisPoints`.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE RUN THROUGH `handlePost`
 * ---------------------------------------------------------------------------
 * The guarantee is about what is PERSISTED and what comes back out, so calling
 * the handlers directly would skip the two things most likely to break it: the
 * validator, and the round trip through the sheet. Every assertion below is
 * made against a record that really went into storage and really came back.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { createPasswordRecord } from '../auth/password';
import { handlePost } from '../main';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { createUser } from '../sheets/users-repository';
import { QUOTATION_LIMITS } from '@shared/validation-rules';

const PEPPER = 'test-only-pepper-not-a-real-key';
const ADMIN_SECRET = 'TEST_ONLY_admin-horse-battery';
const USER_SECRET = 'TEST_ONLY_correct-horse-battery';
const ADMIN = 'admin@speedxksa.com';
const STAFF = 'staff@speedxksa.com';

const DRAFT = 'draft-validity-snapshot';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let adminToken: string;
let userToken: string;
let signatoryId: string;

function call(action: string, payload: unknown = {}, token?: string): Envelope {
  const output = handlePost(
    JSON.stringify({
      action,
      requestId: 'test-request',
      payload,
      ...(token === undefined ? {} : { token }),
    }),
  ) as unknown as { getContent: () => string };

  return JSON.parse(output.getContent()) as Envelope;
}

function seedUser(email: string, secret: string, role: 'Admin' | 'User'): void {
  const material = createPasswordRecord(secret, PEPPER, 1_000);
  createUser({
    email,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role,
  });
}

function login(email: string, secret: string): string {
  return (call('auth.login', { email, password: secret }).data as { token: string }).token;
}

/**
 * A quotation carrying the validity term, exactly as the browser sends it.
 *
 * `body` is the resolved snapshot and `bodyTemplate` the source it came from —
 * both travel, because reopening the quotation has to give the user something
 * editable back without losing what the client was actually sent.
 */
function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const days = 'validityDays' in overrides ? overrides['validityDays'] : 30;

  return {
    draftId: DRAFT,
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [
      {
        category: 'Manpower',
        description: 'TEST_ONLY Technician',
        quantity: 1_000,
        unit: 'Nos',
        unitPrice: 100_00,
      },
    ],
    terms: [
      {
        id: 'term-validity',
        title: 'TEST_ONLY Validity',
        body: `TEST_ONLY valid for ${String(days)} days.`,
        bodyTemplate: 'TEST_ONLY valid for {{quotation.validityDays}} days.',
        sortOrder: 0,
        source: 'library',
      },
    ],
    closingParagraph: 'TEST_ONLY the paragraph this quotation was created with.',
    authorizedPerson: { id: signatoryId },
    discountRateBasisPoints: 0,
    vatRateBasisPoints: 1500,
    validityDays: 30,
    ...overrides,
  };
}

function save(body: Record<string, unknown>, token = userToken): Envelope {
  return call('quotation.save', { quotation: body, finalize: false }, token);
}

/** A payload with the field genuinely absent, not present-and-undefined. */
function withoutValidity(body: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...body };
  delete copy['validityDays'];
  return copy;
}

function saveOk(body: Record<string, unknown>, token = userToken): void {
  const response = save(body, token);
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
}

function stored(draftId = DRAFT): Record<string, unknown> {
  const response = call('quotation.get', { draftId }, userToken);
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
  return (response.data as { quotation: Record<string, unknown> }).quotation;
}

function storedTermBody(draftId = DRAFT): unknown {
  const terms = stored(draftId)['terms'];
  return Array.isArray(terms) ? (terms[0] as Record<string, unknown> | undefined)?.['body'] : undefined;
}

/** Set the company default. Admin only, and irrelevant to any saved quotation. */
function setCompanyValidity(days: number): void {
  const response = call(
    'settings.update',
    {
      defaultVatRateBasisPoints: 1500,
      quotationValidityDays: days,
      defaultClosingParagraph: 'TEST_ONLY company default closing paragraph.',
    },
    adminToken,
  );
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
  TEST_ONLY_resetBootstrapState();

  const person = createPerson({
    id: 'TEST_ONLY-person-1',
    name: 'TEST_ONLY_Signatory',
    designation: 'TEST_ONLY Designation',
    companyName: 'TEST_ONLY Company',
    country: 'TEST_ONLY Country',
    email: 'test-only.signatory@example.invalid',
    phone: '+966 50 000 0000',
  });
  setSignatureFileId(person, 'TEST_ONLY-signature-file');
  signatoryId = person.id;

  seedUser(ADMIN, ADMIN_SECRET, 'Admin');
  seedUser(STAFF, USER_SECRET, 'User');
  adminToken = login(ADMIN, ADMIN_SECRET);
  userToken = login(STAFF, USER_SECRET);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                */
/* -------------------------------------------------------------------------- */

describe('persisting the validity period', () => {
  it('stores what the quotation was created with', () => {
    setCompanyValidity(30);
    saveOk(payload());

    expect(stored()['validityDays']).toBe(30);
  });

  it('stores the value SENT, never the company default', () => {
    // The company says 45; this quotation was created when it said 30. The
    // server has no business preferring the newer number.
    setCompanyValidity(45);
    saveOk(payload({ validityDays: 30 }));

    expect(stored()['validityDays']).toBe(30);
  });

  it('keeps it beside the other snapshots, not in a store of its own', () => {
    saveOk(payload());
    const record = stored();

    // The whole quotation is one JSON payload. Validity belongs in it for the
    // same reason the VAT rate does, and a second mechanism would be a second
    // thing to keep in step.
    expect(Object.keys(record)).toContain('validityDays');
    expect(record['vatRateBasisPoints']).toBe(1500);
  });
});

/* -------------------------------------------------------------------------- */
/* THE HISTORY GUARANTEE                                                      */
/* -------------------------------------------------------------------------- */

describe('an existing quotation after the company default changes', () => {
  beforeEach(() => {
    setCompanyValidity(30);
    saveOk(payload({ validityDays: 30 }));
    setCompanyValidity(45);
  });

  it('still reports the validity it was issued with', () => {
    expect(stored()['validityDays']).toBe(30);
  });

  it('still carries the clause it was issued with', () => {
    expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');
  });

  it('is not rewritten by the settings change itself', () => {
    const before = JSON.stringify(stored());
    setCompanyValidity(365);

    // Saving a setting must touch the Settings sheet and nothing else.
    expect(JSON.stringify(stored())).toBe(before);
  });

  it('keeps 30 when it is re-saved unchanged', () => {
    saveOk(payload({ validityDays: 30 }));

    expect(stored()['validityDays']).toBe(30);
    expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');
  });

  it('keeps 30 even when a client re-saves without sending the field', () => {
    /*
     * The stored value outranks an omission — the same rule the quotation
     * number follows. An older build, or a caller talking to the public
     * endpoint directly, must not be able to strip a quotation of the validity
     * it was issued with, because nothing else on the record could recover it.
     */
    saveOk(withoutValidity(payload({ validityDays: 30 })));

    expect(stored()['validityDays']).toBe(30);
  });

  it('accepts a deliberate change to 45 when one is actually sent', () => {
    // Not frozen — just never changed BEHIND the user's back.
    saveOk(payload({ validityDays: 45 }));

    expect(stored()['validityDays']).toBe(45);
  });
});

/* -------------------------------------------------------------------------- */
/* A quotation stored before this field existed                               */
/* -------------------------------------------------------------------------- */

describe('backward compatibility', () => {
  function legacy(): Record<string, unknown> {
    return withoutValidity(payload());
  }

  it('saves a quotation that carries no validity at all', () => {
    expect(save(legacy()).ok).toBe(true);
  });

  it('reports no validity rather than inventing one', () => {
    saveOk(legacy());

    /*
     * Absent stays absent. Filling it in server-side would have to read
     * Company Settings, which is exactly the coupling being removed — and it
     * would stamp today's number onto a record that cannot contradict it.
     */
    expect(stored()['validityDays']).toBeUndefined();
  });

  it('leaves its stored clause untouched', () => {
    saveOk(legacy());
    setCompanyValidity(45);

    expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');
  });

  it('adopts a validity once one is supplied', () => {
    saveOk(legacy());
    saveOk(payload({ validityDays: 30 }));

    // From here on it is governed by the snapshot like any other quotation.
    expect(stored()['validityDays']).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* Validation — the endpoint is public                                        */
/* -------------------------------------------------------------------------- */

describe('what the server refuses', () => {
  const REJECTED: Array<[string, unknown]> = [
    ['zero days', 0],
    ['a negative period', -30],
    ['beyond the maximum', QUOTATION_LIMITS.validityDaysMax + 1],
    ['a fraction', 12.5],
    ['a numeric string', '30'],
    ['a boolean', true],
    ['an object', { days: 30 }],
  ];

  for (const [label, value] of REJECTED) {
    it(`rejects ${label}`, () => {
      const response = save(payload({ validityDays: value }));

      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('VALIDATION_FAILED');
      expect(response.error?.fields?.['validityDays']).toBeDefined();
    });
  }

  it('stores nothing when it refuses', () => {
    save(payload({ validityDays: 0 }));

    expect(call('quotation.get', { draftId: DRAFT }, userToken).ok).toBe(false);
  });

  it('accepts the boundaries', () => {
    expect(save(payload({ validityDays: QUOTATION_LIMITS.validityDaysMin })).ok).toBe(true);
    expect(save(payload({ validityDays: QUOTATION_LIMITS.validityDaysMax })).ok).toBe(true);
  });

  it('bounds it the same way Company Settings does', () => {
    // One set of bounds. If Settings accepted a number the quotation validator
    // refused, saving the setting would break every quotation created after it.
    const rejected = call(
      'settings.update',
      {
        defaultVatRateBasisPoints: 1500,
        quotationValidityDays: QUOTATION_LIMITS.validityDaysMax + 1,
        defaultClosingParagraph: 'TEST_ONLY closing paragraph.',
      },
      adminToken,
    );

    expect(rejected.ok).toBe(false);
    expect(save(payload({ validityDays: QUOTATION_LIMITS.validityDaysMax + 1 })).ok).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* THE REGRESSION SCENARIO                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Settings 30 → create → settings 45 → reload → save → reload.
 *
 * Thirty days at every step. This is the scenario the bug produced 45 for, and
 * it fails if ANY link in the chain reaches for Company Settings instead of the
 * record: the validator, the save handler, or the read.
 */
describe('the full reopen-and-save cycle', () => {
  it('reports 30 days at every stage', () => {
    // 1. The company default is 30.
    setCompanyValidity(30);

    // 2. Create and save a quotation under it.
    saveOk(payload({ validityDays: 30 }));

    // 3. It is stored as 30.
    expect(stored()['validityDays']).toBe(30);
    expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');

    // 4. The company default changes to 45.
    setCompanyValidity(45);

    // 5. Reload the quotation.
    const reloaded = stored();
    expect(reloaded['validityDays']).toBe(30);

    // 6. Save it again, exactly as it was reloaded.
    saveOk({
      ...payload({ validityDays: reloaded['validityDays'] }),
      terms: reloaded['terms'],
    });

    // 7. Reload again.
    expect(stored()['validityDays']).toBe(30);
    expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');
  });

  it('survives several settings changes and re-saves', () => {
    setCompanyValidity(30);
    saveOk(payload({ validityDays: 30 }));

    for (const days of [45, 7, 365, 1]) {
      setCompanyValidity(days);
      const reloaded = stored();
      saveOk({
        ...payload({ validityDays: reloaded['validityDays'] }),
        terms: reloaded['terms'],
      });

      expect(stored()['validityDays']).toBe(30);
      expect(storedTermBody()).toBe('TEST_ONLY valid for 30 days.');
    }
  });

  it('gives a quotation created AFTER the change the new default', () => {
    setCompanyValidity(30);
    saveOk(payload({ validityDays: 30 }));

    setCompanyValidity(45);
    // A new draft id: a genuinely new quotation, created under the new default.
    saveOk(
      payload({
        draftId: 'draft-created-later',
        validityDays: 45,
        terms: [
          {
            id: 'term-validity',
            title: 'TEST_ONLY Validity',
            body: 'TEST_ONLY valid for 45 days.',
            bodyTemplate: 'TEST_ONLY valid for {{quotation.validityDays}} days.',
            sortOrder: 0,
            source: 'library',
          },
        ],
      }),
    );

    // The old one is untouched; the new one has the new default. Both correct.
    expect(stored()['validityDays']).toBe(30);
    expect(stored('draft-created-later')['validityDays']).toBe(45);
  });
});

/* -------------------------------------------------------------------------- */
/* Nothing else moved                                                         */
/* -------------------------------------------------------------------------- */

describe('the rest of the snapshot', () => {
  it('is byte-identical across a settings change', () => {
    setCompanyValidity(30);
    saveOk(payload({ validityDays: 30 }));
    const before = JSON.stringify(stored());

    setCompanyValidity(45);

    expect(JSON.stringify(stored())).toBe(before);
  });

  it('writes the validity into the same sheet row as everything else', () => {
    saveOk(payload());
    const rows = env.spreadsheet.dataRows('QuotationRecords');

    // One record, one row. No side table, no second write.
    expect(rows).toHaveLength(1);

    // Columns 7-10 are the JSON payload, chunked across four cells.
    const stored = (rows[0] ?? []).slice(6).join('');
    expect(stored).toContain('"validityDays":30');
    expect(stored).toContain('"vatRateBasisPoints":1500');
  });
});
