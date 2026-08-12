import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import {
  TEST_ONLY_buildJpeg,
  TEST_ONLY_buildOpaquePng,
  TEST_ONLY_buildPng,
  TEST_ONLY_toBase64,
} from '../__fixtures__/png-fixtures';
import { handlePost } from '../main';
import { createPasswordRecord } from '../auth/password';
import { createUser } from '../sheets/users-repository';
import { PERSONS_SHEET_NAME } from '../sheets/persons-sheet';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

interface PublicPerson {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  hasSignature: boolean;
  selectable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Obviously synthetic. No real signatory is used as a fixture. */
const PERSON = {
  name: 'TEST_ONLY_Signatory',
  designation: 'TEST_ONLY Designation',
  companyName: 'TEST_ONLY Company',
  country: 'TEST_ONLY Country',
  email: 'test-only.signatory@example.invalid',
  phone: '+966 50 000 0000',
};

let env: GasEnvironment;
let adminToken: string;
let userToken: string;

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}, token = adminToken): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload, token }));
}

function callAnonymous(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload }));
}

function signIn(email: string, role: 'Admin' | 'User'): string {
  const material = createPasswordRecord(PASSWORD, PEPPER, 1_000);
  createUser({
    email,
    passwordHash: material.hash,
    salt: material.salt,
    iterations: material.iterations,
    role,
  });

  return (
    postRaw(
      JSON.stringify({
        action: 'auth.login',
        requestId: 'test-request',
        payload: { email, password: PASSWORD },
      }),
    ).data as { token: string }
  ).token;
}

function createPerson(overrides: Partial<typeof PERSON> = {}): PublicPerson {
  return call('persons.create', { ...PERSON, ...overrides }).data as PublicPerson;
}

function uploadSignature(id: string, bytes: number[] = TEST_ONLY_buildPng()): Envelope {
  return call('persons.uploadSignature', {
    id,
    signature: TEST_ONLY_toBase64(bytes),
    filename: 'signature.png',
  });
}

function persons(includeInactive = false, token = adminToken): PublicPerson[] {
  return call('persons.list', { includeInactive }, token).data as PublicPerson[];
}

beforeEach(() => {
  env = installGasFakes(vi.stubGlobal);
  adminToken = signIn('admin@speedxksa.com', 'Admin');
  userToken = signIn('staff@speedxksa.com', 'User');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('authorization (§11.4)', () => {
  it('refuses every person action without a session', () => {
    for (const action of [
      'persons.list',
      'persons.create',
      'persons.update',
      'persons.deactivate',
      'persons.uploadSignature',
      'persons.getSignature',
    ]) {
      expect(callAnonymous(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });

  it('lets a User read the library', () => {
    expect(call('persons.list', {}, userToken).ok).toBe(true);
  });

  it('refuses every write and the upload to a User', () => {
    for (const action of [
      'persons.create',
      'persons.update',
      'persons.deactivate',
      'persons.uploadSignature',
    ]) {
      expect(call(action, { id: 'x', ...PERSON }, userToken).error?.code, action).toBe('FORBIDDEN');
    }
  });

  it('lets a User fetch a signature for the quotation they are producing', () => {
    const created = createPerson();
    uploadSignature(created.id);

    expect(call('persons.getSignature', { id: created.id }, userToken).ok).toBe(true);
  });

  it('refuses a signature fetch without a session', () => {
    const created = createPerson();
    uploadSignature(created.id);

    expect(callAnonymous('persons.getSignature', { id: created.id }).error?.code).toBe(
      'AUTH_REQUIRED',
    );
  });
});

describe('no dummy data (PRD §34)', () => {
  it('ships an empty library and no signature files', () => {
    expect(persons(true)).toEqual([]);
    expect(env.spreadsheet.dataRows(PERSONS_SHEET_NAME)).toEqual([]);
    expect(env.drive.files()).toEqual([]);
  });
});

describe('create, update, deactivate', () => {
  it('creates a person without a signature', () => {
    const created = createPerson();

    expect(created).toMatchObject({ ...PERSON, active: true, hasSignature: false });
    // Listed, but not offered on a quotation until a signature exists.
    expect(created.selectable).toBe(false);
  });

  it('validates every required field', () => {
    const response = call('persons.create', {
      name: '',
      designation: '',
      companyName: '',
      country: '',
      email: 'not-an-email',
      phone: 'abc',
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.error?.fields ?? {}).sort()).toEqual([
      'companyName',
      'country',
      'designation',
      'email',
      'name',
      'phone',
    ]);
  });

  it('refuses a duplicate name and designation', () => {
    createPerson();
    expect(call('persons.create', PERSON).error?.code).toBe('VALIDATION_FAILED');
  });

  it('allows the same name with a different designation', () => {
    createPerson();
    expect(call('persons.create', { ...PERSON, designation: 'TEST_ONLY Other' }).ok).toBe(true);
  });

  it('moves updatedAt but never createdAt', () => {
    const created = createPerson();

    const updated = call('persons.update', {
      id: created.id,
      ...PERSON,
      designation: 'TEST_ONLY Revised',
    }).data as PublicPerson;

    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.createdAt).getTime(),
    );
    expect(updated.designation).toBe('TEST_ONLY Revised');
  });

  it('soft-deletes and reactivates', () => {
    const created = createPerson();

    call('persons.deactivate', { id: created.id, active: false });
    expect(persons()).toEqual([]);
    expect(persons(true)[0]?.active).toBe(false);
    expect(env.spreadsheet.dataRows(PERSONS_SHEET_NAME)).toHaveLength(1);

    call('persons.deactivate', { id: created.id, active: true });
    expect(persons()).toHaveLength(1);
  });

  it('reports a missing person clearly', () => {
    expect(call('persons.update', { id: 'nope', ...PERSON }).error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('signature upload (PRD §33 item 14)', () => {
  it('accepts a transparent PNG', () => {
    const created = createPerson();
    const response = uploadSignature(created.id);

    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({ hasSignature: true, width: 640, height: 120 });
    expect((response.data as { warnings: string[] }).warnings).toEqual([]);
    expect(persons()[0]?.selectable).toBe(true);
  });

  it('rejects a JPEG renamed .png — the bytes decide, not the name', () => {
    const created = createPerson();
    const response = uploadSignature(created.id, TEST_ONLY_buildJpeg());

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.message).toMatch(/not a PNG/i);
    expect(env.drive.files()).toEqual([]);
  });

  it('rejects a file over 1 MB', () => {
    const created = createPerson();
    // A real PNG, just far too large once its header is honest about the size.
    const oversized = TEST_ONLY_buildPng({ width: 2000, height: 2000 });
    const padded = [...oversized, ...new Array<number>(1_100_000).fill(0)];

    expect(uploadSignature(created.id, padded).error?.code).toBe('VALIDATION_FAILED');
    expect(env.drive.files()).toEqual([]);
  });

  it('rejects a non-image payload', () => {
    const created = createPerson();
    const response = call('persons.uploadSignature', {
      id: created.id,
      signature: TEST_ONLY_toBase64([...Buffer.from('not an image at all')]),
      filename: 'signature.png',
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a data: URI rather than decoding it to garbage', () => {
    const created = createPerson();
    const response = call('persons.uploadSignature', {
      id: created.id,
      signature: `data:image/png;base64,${TEST_ONLY_toBase64(TEST_ONLY_buildPng())}`,
      filename: 'signature.png',
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });

  it('rejects an image too small to be a signature', () => {
    const created = createPerson();
    const tiny = TEST_ONLY_buildPng({ width: 4, height: 4 });

    expect(uploadSignature(created.id, tiny).error?.code).toBe('VALIDATION_FAILED');
  });

  it('accepts an opaque PNG but warns it will paint a white box', () => {
    const created = createPerson();
    const response = uploadSignature(created.id, TEST_ONLY_buildOpaquePng());

    expect(response.ok).toBe(true);
    expect((response.data as { warnings: string[] }).warnings.join(' ')).toMatch(/transparent/i);
  });

  it('warns about a low-resolution image', () => {
    const created = createPerson();
    const response = uploadSignature(created.id, TEST_ONLY_buildPng({ width: 200, height: 60 }));

    expect(response.ok).toBe(true);
    expect((response.data as { warnings: string[] }).warnings.join(' ')).toMatch(/600 px/);
  });

  it('sanitises a path-traversal filename', () => {
    const created = createPerson();
    call('persons.uploadSignature', {
      id: created.id,
      signature: TEST_ONLY_toBase64(TEST_ONLY_buildPng()),
      filename: '../../../etc/passwd.png',
    });

    const stored = env.drive.files()[0];
    expect(stored?.name).not.toContain('/');
    expect(stored?.name).not.toContain('..');
  });

  it('stores in the private _assets/signatures folder', () => {
    const created = createPerson();
    uploadSignature(created.id);

    expect(env.drive.filesIn('_assets/signatures')).toHaveLength(1);
  });

  it('never shares the file or asks for a public URL', () => {
    const created = createPerson();
    uploadSignature(created.id);
    call('persons.getSignature', { id: created.id });

    // Nothing in the signature path may make a file link-accessible.
    expect(env.drive.sharingCalls()).toEqual([]);
  });

  it('creates a NEW file on replacement, leaving the previous one intact', () => {
    const created = createPerson();
    uploadSignature(created.id);
    const first = env.drive.files()[0];

    uploadSignature(created.id, TEST_ONLY_buildPng({ width: 800, height: 150 }));

    expect(env.drive.files()).toHaveLength(2);
    // A quotation issued against the old signature must still resolve.
    expect(env.drive.files().some((file) => file.id === first?.id)).toBe(true);
  });

  it('leaves no record pointing at a file that was never written', () => {
    const created = createPerson();
    env.drive.failNextCreate('Drive is unavailable');

    const response = uploadSignature(created.id);

    expect(response.error?.code).toBe('DRIVE_UPLOAD_FAILED');
    expect(persons()[0]?.hasSignature).toBe(false);
    expect(env.drive.files()).toEqual([]);
  });

  it('maps a Drive quota failure to its own code', () => {
    const created = createPerson();
    env.drive.failNextCreate('User has exceeded their Drive storage quota');

    expect(uploadSignature(created.id).error?.code).toBe('DRIVE_QUOTA_EXCEEDED');
  });
});

describe('reading a signature', () => {
  it('returns bare base64, never a URL', () => {
    const created = createPerson();
    uploadSignature(created.id);

    const signature = (call('persons.getSignature', { id: created.id }).data as { signature: string })
      .signature;

    expect(signature.length).toBeGreaterThan(0);
    expect(signature).not.toContain('http');
    expect(signature).not.toContain('data:');
  });

  it('round-trips the exact bytes that were uploaded', () => {
    const created = createPerson();
    const bytes = TEST_ONLY_buildPng({ width: 700, height: 130 });
    uploadSignature(created.id, bytes);

    const signature = (call('persons.getSignature', { id: created.id }).data as { signature: string })
      .signature;

    expect(signature).toBe(TEST_ONLY_toBase64(bytes));
  });

  it('says specifically when a person has no signature yet', () => {
    const created = createPerson();
    const response = call('persons.getSignature', { id: created.id });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.message).toMatch(/does not have a signature/i);
  });

  it('never returns image bytes from the list', () => {
    const created = createPerson();
    uploadSignature(created.id);

    const listed = JSON.stringify(persons());
    expect(listed).not.toContain('_assets');
    expect(listed).not.toContain('signatureFileId');
    expect(listed).toContain('"hasSignature":true');
  });
});

describe('deactivating a person in use', () => {
  function draftUsing(personId: string, draftId: string, finalize = false): Envelope {
    return call('quotation.save', {
      finalize,
      quotation: {
        draftId,
        quotationDate: '2026-08-11',
        quotationFor: 'TEST_ONLY manpower supply',
        pricingMode: 'amount',
        status: 'Pending',
        client: {
          clientName: 'TEST_ONLY Contact',
          companyName: 'TEST_ONLY Client Co.',
          address: 'TEST_ONLY Address',
        },
        lines: [{ category: 'Manpower', quantity: 1_000, unitPrice: 2_000 }],
        authorizedPerson: { id: personId },
      },
    });
  }

  it('is blocked, naming the draft', () => {
    const created = createPerson();
    uploadSignature(created.id);
    draftUsing(created.id, 'TEST_ONLY-draft-1');

    const response = call('persons.deactivate', { id: created.id, active: false });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(response.error?.message).toContain('TEST_ONLY-draft-1');
  });

  it('is allowed once the quotation has been issued', () => {
    const created = createPerson();
    uploadSignature(created.id);
    expect(draftUsing(created.id, 'TEST_ONLY-draft-2', true).ok).toBe(true);

    // An issued quotation holds a snapshot and is unaffected.
    expect(call('persons.deactivate', { id: created.id, active: false }).ok).toBe(true);
  });

  it('is allowed when no draft uses them', () => {
    const created = createPerson();
    expect(call('persons.deactivate', { id: created.id, active: false }).ok).toBe(true);
  });
});
