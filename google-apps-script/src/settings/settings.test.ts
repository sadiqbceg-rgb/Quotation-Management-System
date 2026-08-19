/**
 * Company settings.
 *
 * Driven through `handlePost`, so the Admin-only rule on `settings.update` is
 * exercised where it actually lives — the ACTIONS table — rather than assumed.
 *
 * The section that matters most is the last one: editing a default must not
 * change a quotation that already exists, and that is asserted against a really
 * saved quotation with real recomputed totals.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { createPasswordRecord } from '../auth/password';
import { handlePost } from '../main';
import { SETTINGS_SHEET_NAME } from '../sheets/settings-sheet';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { createUser } from '../sheets/users-repository';
import { DEFAULT_CLOSING_PARAGRAPH, DEFAULT_QUOTATION_VALIDITY_DAYS } from '@shared/company-defaults';
import { DEFAULT_VAT_RATE_BASIS_POINTS } from '@shared/totals';

const PEPPER = 'test-only-pepper-not-a-real-key';
const ADMIN_SECRET = 'TEST_ONLY_admin-horse-battery';
const USER_SECRET = 'TEST_ONLY_correct-horse-battery';
const ADMIN = 'admin@speedxksa.com';
const STAFF = 'staff@speedxksa.com';

const NEW_CLOSING = 'TEST_ONLY replacement closing paragraph.\n\nWith a second paragraph.';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

interface SettingsResponse {
  business: {
    defaultVatRateBasisPoints: number;
    quotationValidityDays: number;
    defaultClosingParagraph: string;
  };
  deployment: {
    companyCode: string;
    branchCode: string;
    documentTypeCode: string;
    vatNumber: string;
  };
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

function getSettings(token = adminToken): SettingsResponse {
  const response = call('settings.get', {}, token);
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
  return response.data as SettingsResponse;
}

const VALID_UPDATE = {
  defaultVatRateBasisPoints: 500,
  quotationValidityDays: 30,
  defaultClosingParagraph: NEW_CLOSING,
};

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
/* Defaults before anything is stored                                         */
/* -------------------------------------------------------------------------- */

describe('before an administrator has saved anything', () => {
  it('reports the values the system ships with', () => {
    const settings = getSettings();

    // A deployment that has never opened this screen still produces quotations.
    expect(settings.business.defaultVatRateBasisPoints).toBe(DEFAULT_VAT_RATE_BASIS_POINTS);
    expect(settings.business.quotationValidityDays).toBe(DEFAULT_QUOTATION_VALIDITY_DAYS);
    expect(settings.business.defaultClosingParagraph).toBe(DEFAULT_CLOSING_PARAGRAPH);
  });

  it('creates no Settings rows just by reading', () => {
    getSettings();

    expect(env.spreadsheet.dataRows(SETTINGS_SHEET_NAME)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorization                                                              */
/* -------------------------------------------------------------------------- */

describe('authorization', () => {
  it('lets a User READ the settings, because producing a quotation needs them', () => {
    expect(call('settings.get', {}, userToken).ok).toBe(true);
  });

  it('refuses an update from a User', () => {
    expect(call('settings.update', VALID_UPDATE, userToken).error?.code).toBe('FORBIDDEN');
  });

  it('leaves the stored values untouched after a User is refused', () => {
    call('settings.update', VALID_UPDATE, userToken);

    expect(getSettings().business.defaultVatRateBasisPoints).toBe(DEFAULT_VAT_RATE_BASIS_POINTS);
  });

  it('refuses both actions with no token', () => {
    expect(call('settings.get').error?.code).toBe('AUTH_REQUIRED');
    expect(call('settings.update', VALID_UPDATE).error?.code).toBe('AUTH_REQUIRED');
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence and validation                                                 */
/* -------------------------------------------------------------------------- */

describe('saving', () => {
  it('persists what an Admin saves', () => {
    expect(call('settings.update', VALID_UPDATE, adminToken).ok).toBe(true);

    const settings = getSettings();
    expect(settings.business.defaultVatRateBasisPoints).toBe(500);
    expect(settings.business.quotationValidityDays).toBe(30);
    expect(settings.business.defaultClosingParagraph).toBe(NEW_CLOSING);
  });

  it('keeps the paragraph breaks in the closing paragraph', () => {
    call('settings.update', VALID_UPDATE, adminToken);

    // The closing paragraph is two paragraphs; flattening it would change the
    // document.
    expect(getSettings().business.defaultClosingParagraph).toContain('\n\n');
  });

  it('upserts rather than appending a row per edit', () => {
    call('settings.update', VALID_UPDATE, adminToken);
    call('settings.update', { ...VALID_UPDATE, quotationValidityDays: 14 }, adminToken);

    // Three settings, three rows — not six.
    expect(env.spreadsheet.dataRows(SETTINGS_SHEET_NAME)).toHaveLength(3);
    expect(getSettings().business.quotationValidityDays).toBe(14);
  });

  it('rejects a VAT rate above 100%', () => {
    const response = call(
      'settings.update',
      { ...VALID_UPDATE, defaultVatRateBasisPoints: 10_001 },
      adminToken,
    );

    expect(response.error?.fields?.['defaultVatRateBasisPoints']).toBeDefined();
    expect(getSettings().business.defaultVatRateBasisPoints).toBe(DEFAULT_VAT_RATE_BASIS_POINTS);
  });

  it('rejects a negative VAT rate and a non-integer one', () => {
    for (const rate of [-1, 12.5]) {
      expect(
        call('settings.update', { ...VALID_UPDATE, defaultVatRateBasisPoints: rate }, adminToken)
          .error?.fields?.['defaultVatRateBasisPoints'],
        String(rate),
      ).toBeDefined();
    }
  });

  it('rejects validity days outside 1-365', () => {
    for (const days of [0, 366]) {
      expect(
        call('settings.update', { ...VALID_UPDATE, quotationValidityDays: days }, adminToken).error
          ?.fields?.['quotationValidityDays'],
        String(days),
      ).toBeDefined();
    }
  });

  it('rejects an empty closing paragraph', () => {
    expect(
      call('settings.update', { ...VALID_UPDATE, defaultClosingParagraph: '' }, adminToken).error
        ?.fields?.['defaultClosingParagraph'],
    ).toBeDefined();
  });

  it('rejects a non-numeric rate sent as a string', () => {
    expect(
      call(
        'settings.update',
        { ...VALID_UPDATE, defaultVatRateBasisPoints: '1500' },
        adminToken,
      ).error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('writes nothing at all when validation fails', () => {
    call('settings.update', { ...VALID_UPDATE, quotationValidityDays: 0 }, adminToken);

    // Not a partial write: the whole screen saves or none of it does.
    expect(env.spreadsheet.dataRows(SETTINGS_SHEET_NAME)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* Deployment configuration is reported, never edited                         */
/* -------------------------------------------------------------------------- */

describe('deployment configuration', () => {
  it('reports the numbering codes and the VAT number', () => {
    const { deployment } = getSettings();

    expect(deployment.companyCode.length).toBeGreaterThan(0);
    expect(deployment.branchCode.length).toBeGreaterThan(0);
    expect(deployment.documentTypeCode.length).toBeGreaterThan(0);
    expect(deployment.vatNumber.length).toBeGreaterThan(0);
  });

  it('cannot be changed through settings.update', () => {
    const before = getSettings().deployment;

    call(
      'settings.update',
      { ...VALID_UPDATE, companyCode: 'XXX', branchCode: 'YYY', vatNumber: '300000000000003' },
      adminToken,
    );

    // The numbering codes decide every issued number and every Drive folder.
    expect(getSettings().deployment).toEqual(before);
  });

  it('never stores a deployment key in the Settings sheet', () => {
    call(
      'settings.update',
      { ...VALID_UPDATE, companyCode: 'XXX', vatNumber: '300000000000003' },
      adminToken,
    );

    const keys = env.spreadsheet.dataRows(SETTINGS_SHEET_NAME).map((row) => String(row[0]));
    expect(keys.sort()).toEqual([
      'defaultClosingParagraph',
      'defaultVatRateBasisPoints',
      'quotationValidityDays',
    ]);
  });

  it('exposes no secret', () => {
    const serialised = JSON.stringify(getSettings());

    for (const forbidden of [
      'SESSION_HMAC_SECRET',
      'PASSWORD_PEPPER',
      'DRIVE_ROOT_FOLDER_ID',
      'TRACKING_SPREADSHEET_ID',
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    expect(serialised.toLowerCase()).not.toContain('secret');
    expect(serialised.toLowerCase()).not.toContain('pepper');
  });
});

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

describe('audit', () => {
  it('records an update with the numbers that changed', () => {
    call('settings.update', VALID_UPDATE, adminToken);

    const rows = env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
    const entry = rows.find((row) => String(row[2]) === 'settings.update');

    expect(entry).toBeDefined();
    expect(String(entry?.[1])).toBe(ADMIN);
    expect(String(entry?.[3])).toContain('vat:500');
  });

  it('does not copy the closing paragraph into the log', () => {
    call('settings.update', VALID_UPDATE, adminToken);

    for (const row of env.spreadsheet.dataRows(AUDIT_SHEET_NAME)) {
      for (const value of row) {
        if (typeof value !== 'string') continue;
        expect(value).not.toContain(NEW_CLOSING);
      }
    }
  });

  it('does not audit a read', () => {
    const before = env.spreadsheet.dataRows(AUDIT_SHEET_NAME).length;
    getSettings();

    expect(env.spreadsheet.dataRows(AUDIT_SHEET_NAME).length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* THE HISTORY GUARANTEE                                                      */
/* -------------------------------------------------------------------------- */

describe('an existing quotation never changes when a default does', () => {
  function payload(): Record<string, unknown> {
    return {
      draftId: 'draft-settings-history',
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
          id: 'line-1',
          category: 'Manpower',
          description: 'TEST_ONLY Technician',
          quantity: 1_000,
          unit: 'Nos',
          unitPrice: 100_00,
        },
      ],
      terms: [],
      closingParagraph: 'TEST_ONLY the paragraph this quotation was created with.',
      authorizedPerson: { id: signatoryId },
      discountRateBasisPoints: 0,
      // The rate this quotation was created with, stored ON the quotation.
      vatRateBasisPoints: 1500,
    };
  }

  function storedQuotation(): Record<string, unknown> {
    const response = call('quotation.get', { draftId: 'draft-settings-history' }, userToken);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    return (response.data as { quotation: Record<string, unknown> }).quotation;
  }

  beforeEach(() => {
    const saved = call('quotation.save', { quotation: payload(), finalize: false }, userToken);
    expect(saved.ok, JSON.stringify(saved.error)).toBe(true);
  });

  it('keeps its own VAT rate after the default is changed', () => {
    call('settings.update', { ...VALID_UPDATE, defaultVatRateBasisPoints: 500 }, adminToken);

    expect(storedQuotation()['vatRateBasisPoints']).toBe(1500);
  });

  it('keeps its own totals, recomputed from its own rate', () => {
    const before = JSON.stringify(storedQuotation()['totals']);
    call('settings.update', { ...VALID_UPDATE, defaultVatRateBasisPoints: 500 }, adminToken);

    // The server recomputes from the rate ON THE QUOTATION, so a changed
    // default cannot move a total that has already been quoted to a client.
    expect(JSON.stringify(storedQuotation()['totals'])).toBe(before);
  });

  it('keeps its own closing paragraph after the default is changed', () => {
    call('settings.update', VALID_UPDATE, adminToken);

    expect(storedQuotation()['closingParagraph']).toBe(
      'TEST_ONLY the paragraph this quotation was created with.',
    );
  });

  it('still re-saves at its own rate rather than picking up the new default', () => {
    call('settings.update', { ...VALID_UPDATE, defaultVatRateBasisPoints: 500 }, adminToken);
    call('quotation.save', { quotation: payload(), finalize: false }, userToken);

    expect(storedQuotation()['vatRateBasisPoints']).toBe(1500);
  });
});
