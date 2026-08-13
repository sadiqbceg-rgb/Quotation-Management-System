/**
 * PRD §36, rule by rule, on the SERVER.
 *
 * ---------------------------------------------------------------------------
 * WHY A TABLE RATHER THAN PROSE
 * ---------------------------------------------------------------------------
 * §36 is a list of required fields and a list of rejected values. Written as
 * free-standing `it` blocks, "every rule has a passing and a failing test"
 * becomes a claim nobody can check. Written as a table, the rules ARE the
 * table, each row produces both tests, and a rule with no row is visible as a
 * gap rather than hidden as an omission.
 *
 * The mirror of this file is `src/schemas/quotation-validation.test.ts`, which
 * runs the same table through the client-side schema. The server table is the
 * one that matters — the endpoint is public — but a rule the client does not
 * also catch means the user finds out after a round trip instead of while
 * typing, so both are required (§19.3).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../src/__fixtures__/gas-fakes';
import { handlePost } from '../src/main';
import { createPasswordRecord, MIN_PBKDF2_ITERATIONS } from '../src/auth/password';
import { createUser } from '../src/sheets/users-repository';
import { createPerson, setSignatureFileId } from '../src/sheets/persons-sheet';
import { readLastSequence } from '../src/sheets/counters-sheet';
import { QUANTITY_LIMITS, PRICE_LIMITS, TEXT_LIMITS } from '@shared/validation-rules';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

/**
 * PBKDF2 iterations for the fixtures here: the lowest the module will accept.
 *
 * `hashPassword` refuses anything below `MIN_PBKDF2_ITERATIONS`, and that floor
 * is a real control — a deployment that tuned the cost down to nothing would be
 * storing passwords that are barely hashed. So the tests take the floor rather
 * than a convenient literal, and it is imported rather than copied so lowering
 * it in production cannot silently lower it here.
 *
 * Production tunes `DEFAULT_PBKDF2_ITERATIONS` far higher (SECURITY.md); the
 * count itself is covered by `auth/password.test.ts`.
 */
const TEST_ITERATIONS = MIN_PBKDF2_ITERATIONS;

/**
 * The password material, derived ONCE.
 *
 * Every test reinstalls the fakes and therefore re-seeds the user, and PBKDF2
 * at the module's minimum cost is genuinely expensive — deriving it per test
 * doubled the work for a value that never changes. The salt is part of the
 * material, so reusing it reuses the same account entirely; the sign-in that
 * follows still runs a real verification hash, which is the half that is
 * actually under test here.
 */
let material: ReturnType<typeof createPasswordRecord> | null = null;

function passwordMaterial(): ReturnType<typeof createPasswordRecord> {
  material ??= createPasswordRecord(PASSWORD, PEPPER, TEST_ITERATIONS);
  return material;
}

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let token: string;
let signatoryId: string;

function post(action: string, payload: unknown): Envelope {
  const output = handlePost(
    JSON.stringify({ action, requestId: 'test-request', payload, token }),
  ) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

/** Finalize is where §36 applies: "do not create a PDF/DOCX until valid". */
function finalize(quotation: Record<string, unknown>): Envelope {
  return post('quotation.save', { quotation, finalize: true });
}

type Line = Record<string, unknown>;

function validLine(overrides: Line = {}): Line {
  return {
    category: 'Manpower',
    description: 'TEST_ONLY General Labour',
    quantity: 40_000,
    unit: 'Hour',
    unitPrice: 2000,
    remarks: '',
    ...overrides,
  };
}

let draftCounter = 0;

/** A complete, valid quotation. Every row of the table below starts here. */
function validQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  draftCounter += 1;
  return {
    draftId: `TEST_ONLY_draft-${String(draftCounter)}`,
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    status: 'Pending',
    closingParagraph: 'TEST_ONLY closing paragraph.',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [validLine()],
    authorizedPerson: { id: signatoryId },
    ...overrides,
  };
}

/** Replace the first line, keeping everything else valid. */
function withLine(overrides: Line): Record<string, unknown> {
  return validQuotation({ lines: [validLine(overrides)] });
}

beforeEach(() => {
  draftCounter = 0;
  env = installGasFakes(vi.stubGlobal);

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

  const seeded = passwordMaterial();
  createUser({
    email: 'staff@speedxksa.com',
    passwordHash: seeded.hash,
    salt: seeded.salt,
    iterations: seeded.iterations,
    role: 'User',
  });

  const login = handlePost(
    JSON.stringify({
      action: 'auth.login',
      requestId: 'test-request',
      payload: { email: 'staff@speedxksa.com', password: PASSWORD },
    }),
  ) as unknown as { getContent: () => string };
  token = (JSON.parse(login.getContent()) as { data: { token: string } }).data.token;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The table                                                                  */
/* -------------------------------------------------------------------------- */

interface Rule {
  /** The §36 clause, quoted. */
  rule: string;
  /** A quotation that satisfies it. Must finalize. */
  valid: () => Record<string, unknown>;
  /** A quotation that breaks it, and only it. Must be refused. */
  invalid: () => Record<string, unknown>;
  /**
   * The field key the refusal must name, so the UI can point at the input.
   * `null` where the refusal is a whole-payload message with no single field.
   */
  field: string | null;
}

const REQUIRED_FIELDS: Rule[] = [
  {
    rule: 'Required: Client Name',
    valid: () => validQuotation(),
    invalid: () =>
      validQuotation({
        client: { clientName: '', companyName: 'TEST_ONLY Co.', address: 'TEST_ONLY Address' },
      }),
    field: 'client.clientName',
  },
  {
    rule: 'Required: Company Name',
    valid: () => validQuotation(),
    invalid: () =>
      validQuotation({
        client: { clientName: 'TEST_ONLY Contact', companyName: '', address: 'TEST_ONLY Address' },
      }),
    field: 'client.companyName',
  },
  {
    rule: 'Required: Address',
    valid: () => validQuotation(),
    invalid: () =>
      validQuotation({
        client: { clientName: 'TEST_ONLY Contact', companyName: 'TEST_ONLY Co.', address: '' },
      }),
    field: 'client.address',
  },
  {
    rule: 'Required: Quotation For',
    valid: () => validQuotation(),
    invalid: () => validQuotation({ quotationFor: '' }),
    field: 'quotationFor',
  },
  {
    rule: 'Required: At least one quotation item',
    valid: () => validQuotation(),
    invalid: () => validQuotation({ lines: [] }),
    field: 'lines',
  },
  {
    rule: 'Required: Quantity',
    valid: () => withLine({ quantity: 1 }),
    invalid: () => withLine({ quantity: undefined }),
    field: 'lines.0.quantity',
  },
  {
    rule: 'Required: Unit',
    valid: () => withLine({ unit: 'Day' }),
    invalid: () => withLine({ unit: '' }),
    field: 'lines.0.unit',
  },
  {
    rule: 'Required: Price',
    valid: () => withLine({ unitPrice: 0 }),
    invalid: () => withLine({ unitPrice: undefined }),
    field: 'lines.0.unitPrice',
  },
  {
    rule: 'Required: Authorized Person',
    valid: () => validQuotation(),
    invalid: () => validQuotation({ authorizedPerson: undefined }),
    field: 'authorizedPerson',
  },
];

const REJECTED_VALUES: Rule[] = [
  {
    rule: 'Reject: negative quantity',
    valid: () => withLine({ quantity: 500 }),
    invalid: () => withLine({ quantity: -1_000 }),
    field: 'lines.0.quantity',
  },
  {
    rule: 'Reject: zero quantity',
    valid: () => withLine({ quantity: 1 }),
    invalid: () => withLine({ quantity: 0 }),
    field: 'lines.0.quantity',
  },
  {
    rule: 'Reject: negative price',
    valid: () => withLine({ unitPrice: 1 }),
    invalid: () => withLine({ unitPrice: -1 }),
    field: 'lines.0.unitPrice',
  },
  {
    rule: 'Reject: empty designation (Manpower)',
    valid: () => withLine({ category: 'Manpower', description: 'TEST_ONLY Foreman' }),
    invalid: () => withLine({ category: 'Manpower', description: '' }),
    field: 'lines.0.description',
  },
  {
    rule: 'Reject: empty material description',
    valid: () =>
      withLine({ category: 'Materials', unit: 'Nos.', description: 'TEST_ONLY Cement bag' }),
    invalid: () => withLine({ category: 'Materials', unit: 'Nos.', description: '' }),
    field: 'lines.0.description',
  },
  {
    rule: 'Reject: empty equipment description',
    valid: () =>
      withLine({ category: 'Equipment', unit: 'Day', description: 'TEST_ONLY Scissor lift' }),
    invalid: () => withLine({ category: 'Equipment', unit: 'Day', description: '' }),
    field: 'lines.0.description',
  },
  {
    rule: 'Reject: quantity above the ceiling',
    valid: () => withLine({ quantity: QUANTITY_LIMITS.max * 1_000 }),
    invalid: () => withLine({ quantity: QUANTITY_LIMITS.max * 1_000 + 1 }),
    field: 'lines.0.quantity',
  },
  {
    rule: 'Reject: price above the ceiling',
    valid: () => withLine({ unitPrice: PRICE_LIMITS.maxSar * 100 }),
    invalid: () => withLine({ unitPrice: PRICE_LIMITS.maxSar * 100 + 1 }),
    field: 'lines.0.unitPrice',
  },
  {
    rule: 'Reject: a description past the length cap',
    valid: () => withLine({ description: 'T'.repeat(TEXT_LIMITS.itemDescription.max) }),
    invalid: () => withLine({ description: 'T'.repeat(TEXT_LIMITS.itemDescription.max + 1) }),
    field: 'lines.0.description',
  },
  {
    rule: 'Reject: an unrecognised category',
    valid: () => withLine({ category: 'Materials', unit: 'Nos.' }),
    invalid: () => withLine({ category: 'TEST_ONLY Not A Category' }),
    field: 'lines.0.category',
  },
  {
    rule: 'Reject: a malformed date',
    valid: () => validQuotation({ quotationDate: '2026-08-11' }),
    invalid: () => validQuotation({ quotationDate: '11/08/2026' }),
    field: 'quotationDate',
  },
  {
    rule: 'Reject: an impossible date',
    valid: () => validQuotation({ quotationDate: '2026-02-28' }),
    invalid: () => validQuotation({ quotationDate: '2026-02-31' }),
    field: 'quotationDate',
  },
  {
    rule: 'Reject: a quotation number the client made up',
    valid: () => validQuotation(),
    invalid: () => validQuotation({ quotationNumber: 'SFC/RUH/QTN/2026/9' }),
    field: 'quotationNumber',
  },
];

const ALL_RULES = [...REQUIRED_FIELDS, ...REJECTED_VALUES];

/* -------------------------------------------------------------------------- */

describe('PRD §36 — the required fields', () => {
  it.each(REQUIRED_FIELDS.map((rule) => [rule.rule, rule] as const))(
    '%s — accepts a quotation that has it',
    (_name, rule) => {
      const response = finalize(rule.valid());
      expect(response.error?.code ?? 'ok', JSON.stringify(response.error?.fields)).toBe('ok');
      expect(response.ok).toBe(true);
    },
  );

  it.each(REQUIRED_FIELDS.map((rule) => [rule.rule, rule] as const))(
    '%s — refuses a quotation missing it',
    (_name, rule) => {
      const response = finalize(rule.invalid());
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('VALIDATION_FAILED');
    },
  );
});

describe('PRD §36 — the rejected values', () => {
  it.each(REJECTED_VALUES.map((rule) => [rule.rule, rule] as const))(
    '%s — accepts the value just inside the rule',
    (_name, rule) => {
      const response = finalize(rule.valid());
      expect(response.error?.code ?? 'ok', JSON.stringify(response.error?.fields)).toBe('ok');
      expect(response.ok).toBe(true);
    },
  );

  it.each(REJECTED_VALUES.map((rule) => [rule.rule, rule] as const))(
    '%s — refuses the value outside it',
    (_name, rule) => {
      const response = finalize(rule.invalid());
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe('VALIDATION_FAILED');
    },
  );
});

describe('the refusal is actionable', () => {
  it.each(
    ALL_RULES.filter((rule) => rule.field !== null).map((rule) => [rule.rule, rule] as const),
  )('%s — names the field the user has to fix', (_name, rule) => {
    const response = finalize(rule.invalid());
    const fields = response.error?.fields ?? {};

    expect(
      Object.keys(fields),
      `${rule.rule}: expected a message on "${rule.field ?? ''}"`,
    ).toContain(rule.field);
  });
});

/* -------------------------------------------------------------------------- */
/* "Do not create a PDF/DOCX until required information is valid"             */
/* -------------------------------------------------------------------------- */

describe('an invalid quotation costs nothing', () => {
  it.each(ALL_RULES.map((rule) => [rule.rule, rule] as const))(
    '%s — consumes no quotation number',
    (_name, rule) => {
      finalize(rule.invalid());
      expect(readLastSequence(2026)).toBe(0);
    },
  );

  it('writes no register row for a refused quotation', () => {
    finalize(validQuotation({ quotationFor: '' }));
    expect(env.spreadsheet.dataRows('Quotations')).toEqual([]);
  });

  it('reports every problem at once rather than one per round trip', () => {
    const response = finalize(
      validQuotation({
        quotationFor: '',
        client: { clientName: '', companyName: '', address: '' },
      }),
    );

    const fields = Object.keys(response.error?.fields ?? {});
    expect(fields).toContain('quotationFor');
    expect(fields).toContain('client.clientName');
    expect(fields).toContain('client.companyName');
    expect(fields).toContain('client.address');
  });
});

/* -------------------------------------------------------------------------- */
/* A draft is deliberately exempt                                             */
/* -------------------------------------------------------------------------- */

describe('a draft is held to a weaker standard', () => {
  it('saves an incomplete quotation without issuing a number', () => {
    const response = post('quotation.save', {
      quotation: validQuotation({ quotationFor: '', client: {} }),
      finalize: false,
    });

    expect(response.ok).toBe(true);
    expect(readLastSequence(2026)).toBe(0);
  });

  it('still refuses a negative price on a draft — a bad value is bad either way', () => {
    const response = post('quotation.save', {
      quotation: withLine({ unitPrice: -1 }),
      finalize: false,
    });

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });
});
