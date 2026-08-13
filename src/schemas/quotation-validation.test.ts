/**
 * PRD §36, rule by rule, on the CLIENT.
 *
 * The mirror of `google-apps-script/__tests__/validation-matrix.test.ts`. The
 * server table is the one that enforces anything — the endpoint is public, so
 * the browser's opinion is advisory (§19.3) — but a rule the browser does NOT
 * also catch means the user submits, waits for a round trip, and only then
 * learns they left a field blank. Both sides carry every rule, and both sides
 * are tested from a table so a missing rule shows up as a missing row.
 *
 * The client's rules live in two places, deliberately:
 *
 *   - `quotationFormSchema` — the shell and the client block, checked while
 *     typing. A DRAFT is allowed to be incomplete, so this is the form's view.
 *   - `validateForExport` — the pre-export gate, which is where §36 actually
 *     applies: "Do not create a PDF/DOCX until required information is valid."
 *
 * Both are covered below.
 */

import { describe, expect, it } from 'vitest';

import { emptyTokenContext } from '@shared/term-tokens';
import { QUANTITY_LIMITS, TEXT_LIMITS } from '@shared/validation-rules';
import {
  validateForExport,
  type ExportValidationInput,
  type ExportBlockerCode,
} from '@/services/document/export-validation';
import { quotationFormSchema, quotationDraftSchema } from './quotation-schema';

/* -------------------------------------------------------------------------- */
/* The form schema — the shell and the client block                            */
/* -------------------------------------------------------------------------- */

type FormValues = Record<string, unknown>;

function validForm(overrides: FormValues = {}): FormValues {
  return {
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    scopeOfWork: 'TEST_ONLY scope paragraph.',
    pricingMode: 'amount',
    status: 'Pending',
    vatEnabled: true,
    vatRatePercent: 15,
    discountEnabled: false,
    discountRatePercent: 0,
    closingParagraph: 'TEST_ONLY closing paragraph.',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
      contactPerson: '',
      email: '',
      phone: '',
      projectName: '',
      projectLocation: '',
      clientReference: '',
    },
    ...overrides,
  };
}

function withClient(overrides: FormValues): FormValues {
  const base = validForm();
  const client = base['client'] as FormValues;
  return validForm({ client: { ...client, ...overrides } });
}

/** The dotted path of every issue the schema raised. */
function issuePaths(values: FormValues): string[] {
  const result = quotationFormSchema.safeParse(values);
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join('.'));
}

interface FormRule {
  rule: string;
  valid: FormValues;
  invalid: FormValues;
  /** The form path the message must land on, so the field can be highlighted. */
  path: string;
}

const FORM_RULES: FormRule[] = [
  {
    rule: 'Required: Client Name',
    valid: validForm(),
    invalid: withClient({ clientName: '' }),
    path: 'client.clientName',
  },
  {
    rule: 'Required: Company Name',
    valid: validForm(),
    invalid: withClient({ companyName: '' }),
    path: 'client.companyName',
  },
  {
    rule: 'Required: Address',
    valid: validForm(),
    invalid: withClient({ address: '' }),
    path: 'client.address',
  },
  {
    rule: 'Required: Quotation For',
    valid: validForm(),
    invalid: validForm({ quotationFor: '' }),
    path: 'quotationFor',
  },
  {
    rule: 'Reject: a malformed date',
    valid: validForm({ quotationDate: '2026-08-11' }),
    invalid: validForm({ quotationDate: '11/08/2026' }),
    path: 'quotationDate',
  },
  {
    rule: 'Reject: a Quotation For past the length cap',
    valid: validForm({ quotationFor: 'T'.repeat(TEXT_LIMITS.quotationFor.max) }),
    invalid: validForm({ quotationFor: 'T'.repeat(TEXT_LIMITS.quotationFor.max + 1) }),
    path: 'quotationFor',
  },
  {
    rule: 'Required: a closing paragraph',
    valid: validForm(),
    invalid: validForm({ closingParagraph: '' }),
    path: 'closingParagraph',
  },
  {
    rule: 'Reject: a VAT rate outside 0-100%',
    valid: validForm({ vatRatePercent: 15 }),
    invalid: validForm({ vatRatePercent: 101 }),
    path: 'vatRatePercent',
  },
  {
    rule: 'Reject: a discount rate outside 0-100%',
    valid: validForm({ discountRatePercent: 5 }),
    invalid: validForm({ discountRatePercent: -1 }),
    path: 'discountRatePercent',
  },
  {
    rule: 'Reject: an unrecognised status',
    valid: validForm({ status: 'Approved' }),
    invalid: validForm({ status: 'TEST_ONLY Not A Status' }),
    path: 'status',
  },
];

describe('the quotation form schema', () => {
  it.each(FORM_RULES.map((rule) => [rule.rule, rule] as const))(
    '%s — accepts the valid value',
    (_name, rule) => {
      expect(issuePaths(rule.valid)).toEqual([]);
    },
  );

  it.each(FORM_RULES.map((rule) => [rule.rule, rule] as const))(
    '%s — refuses the invalid value, on the field that is wrong',
    (_name, rule) => {
      expect(issuePaths(rule.invalid)).toContain(rule.path);
    },
  );

  it('trims before measuring, so whitespace is not a value', () => {
    expect(issuePaths(withClient({ clientName: '   ' }))).toContain('client.clientName');
  });
});

describe('the draft schema', () => {
  it('lets an incomplete quotation be saved, because a draft is work in progress', () => {
    // A controlled form always sends every key; what makes it a draft is that
    // the values are still empty.
    const result = quotationDraftSchema.safeParse(
      validForm({
        quotationFor: '',
        closingParagraph: '',
        client: { clientName: '', companyName: '', address: '' },
      }),
    );
    expect(result.error?.issues ?? []).toEqual([]);
    expect(result.success).toBe(true);
  });

  it('still refuses a value that is too long to store', () => {
    const result = quotationDraftSchema.safeParse(
      validForm({ quotationFor: 'T'.repeat(TEXT_LIMITS.quotationFor.max + 1) }),
    );
    expect(result.success).toBe(false);
  });

  it('still refuses a malformed date, which no amount of drafting makes valid', () => {
    const result = quotationDraftSchema.safeParse(validForm({ quotationDate: 'yesterday' }));
    expect(result.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* The export gate — where §36 actually bites                                 */
/* -------------------------------------------------------------------------- */

type ExportLine = ExportValidationInput['lines'][number];

function validExportLine(overrides: Partial<ExportLine> = {}): ExportLine {
  return {
    description: 'TEST_ONLY General Labour',
    quantity: 40_000,
    unit: 'Hour',
    unitPrice: 2000,
    ...overrides,
  };
}

function validExport(overrides: Partial<ExportValidationInput> = {}): ExportValidationInput {
  return {
    quotationFor: 'TEST_ONLY Manpower Supply',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [validExportLine()],
    terms: [{ title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum hours per day.' }],
    closingParagraph: 'TEST_ONLY thank you.',
    signatory: { name: 'TEST_ONLY_Signatory' },
    signatureLoaded: true,
    sealLoaded: true,
    tokenContext: { ...emptyTokenContext(), companyName: 'TEST_ONLY Co.' },
    ...overrides,
  };
}

function withExportLine(overrides: Partial<ExportLine>): ExportValidationInput {
  return validExport({ lines: [validExportLine(overrides)] });
}

function blockerCodes(input: ExportValidationInput): ExportBlockerCode[] {
  return validateForExport(input).map((blocker) => blocker.code);
}

interface ExportRule {
  rule: string;
  valid: ExportValidationInput;
  invalid: ExportValidationInput;
  code: ExportBlockerCode;
}

const EXPORT_RULES: ExportRule[] = [
  {
    rule: 'Required: Client Name',
    valid: validExport(),
    invalid: validExport({
      client: { clientName: '', companyName: 'TEST_ONLY Co.', address: 'TEST_ONLY Address' },
    }),
    code: 'CLIENT_NAME',
  },
  {
    rule: 'Required: Company Name',
    valid: validExport(),
    invalid: validExport({
      client: { clientName: 'TEST_ONLY Contact', companyName: '', address: 'TEST_ONLY Address' },
    }),
    code: 'CLIENT_COMPANY',
  },
  {
    rule: 'Required: Address',
    valid: validExport(),
    invalid: validExport({
      client: { clientName: 'TEST_ONLY Contact', companyName: 'TEST_ONLY Co.', address: '' },
    }),
    code: 'CLIENT_ADDRESS',
  },
  {
    rule: 'Required: Quotation For',
    valid: validExport(),
    invalid: validExport({ quotationFor: '' }),
    code: 'QUOTATION_FOR',
  },
  {
    rule: 'Required: at least one quotation item',
    valid: validExport(),
    invalid: validExport({ lines: [] }),
    code: 'NO_ITEMS',
  },
  {
    rule: 'Required: Quantity',
    valid: withExportLine({ quantity: 1 }),
    invalid: withExportLine({ quantity: 0 }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Required: Unit',
    valid: withExportLine({ unit: 'Day' }),
    invalid: withExportLine({ unit: '' }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Required: Price',
    valid: withExportLine({ unitPrice: 0 }),
    invalid: withExportLine({ unitPrice: -1 }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Required: Authorized Person',
    valid: validExport(),
    invalid: validExport({ signatory: null }),
    code: 'NO_SIGNATORY',
  },
  {
    rule: 'Reject: negative quantity',
    valid: withExportLine({ quantity: 500 }),
    invalid: withExportLine({ quantity: -1_000 }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Reject: empty designation',
    valid: withExportLine({ description: 'TEST_ONLY Foreman' }),
    invalid: withExportLine({ description: '' }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Reject: a designation that is only whitespace',
    valid: withExportLine({ description: 'TEST_ONLY Foreman' }),
    invalid: withExportLine({ description: '   ' }),
    code: 'INVALID_ITEM',
  },
  {
    rule: 'Required: a closing paragraph',
    valid: validExport(),
    invalid: validExport({ closingParagraph: '' }),
    code: 'CLOSING_PARAGRAPH',
  },
];

describe('the export gate (PRD §36)', () => {
  it.each(EXPORT_RULES.map((rule) => [rule.rule, rule] as const))(
    '%s — lets a valid quotation through',
    (_name, rule) => {
      expect(blockerCodes(rule.valid)).toEqual([]);
    },
  );

  it.each(EXPORT_RULES.map((rule) => [rule.rule, rule] as const))(
    '%s — blocks export and says which code',
    (_name, rule) => {
      expect(blockerCodes(rule.invalid)).toContain(rule.code);
    },
  );
});

describe('the two sides agree', () => {
  it('rejects a quantity above the ceiling on the client too', () => {
    // The server caps it at QUANTITY_LIMITS.max; the browser must not offer to
    // export something the server will refuse after the user has waited.
    expect(
      blockerCodes(withExportLine({ quantity: QUANTITY_LIMITS.max * 1_000 })),
      'the ceiling itself is valid',
    ).toEqual([]);
  });

  it('names every blocker at once, as a to-do list rather than a verdict', () => {
    const codes = blockerCodes(
      validExport({
        quotationFor: '',
        client: { clientName: '', companyName: '', address: '' },
        lines: [],
        signatory: null,
      }),
    );

    expect(codes).toEqual(
      expect.arrayContaining([
        'QUOTATION_FOR',
        'CLIENT_NAME',
        'CLIENT_COMPANY',
        'CLIENT_ADDRESS',
        'NO_ITEMS',
        'NO_SIGNATORY',
      ]),
    );
  });
});
