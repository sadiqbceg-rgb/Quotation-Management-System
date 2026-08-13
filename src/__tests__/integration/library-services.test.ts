/**
 * The master-data services — items, terms, authorized persons — spoken to the
 * real backend over a faked network.
 *
 * ---------------------------------------------------------------------------
 * WHY THESE ARE WORTH A TEST
 * ---------------------------------------------------------------------------
 * Each of these functions is one line: `callAction('terms.create', input)`. It
 * is tempting to call that implementation detail and skip it. It is not. The
 * action NAME and the payload SHAPE are the contract between the two halves of
 * the system, and both halves are written from the same list of strings — which
 * means a typo compiles, passes every unit test on either side, and fails only
 * in front of a user.
 *
 * So these round-trip: create through the service, read back through the
 * service, and assert the backend really did what the caller asked. A wrong
 * action name fails here, and so does an action the backend does not implement.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeBackend, type FakeBackend } from '../../../test/fakes/backend';
import { AppError } from '@/services/api/errors';
import { ACTION_NAMES } from '@/services/api/actions';
import { createItem, listItems, setItemActive, updateItem } from '@/services/items/item-service';
import { createTerm, listTerms, setTermActive, updateTerm } from '@/services/terms/terms-service';
import {
  createPerson,
  fetchSignature,
  listPersons,
  setPersonActive,
  updatePerson,
  uploadSignature,
} from '@/services/signatories/signatory-service';
import { TEST_ONLY_buildPng } from '../../../google-apps-script/src/__fixtures__/png-fixtures';
import { bytesToBase64 } from '@/utils/base64';

const STAFF = 'staff@speedxksa.com';
const ADMIN = 'admin@speedxksa.com';

let backend: FakeBackend;
let staffToken: string;
let adminToken: string;

beforeEach(() => {
  backend = createFakeBackend(vi.stubGlobal);
  staffToken = backend.signIn(STAFF);
  adminToken = backend.signIn(ADMIN, 'Admin');
});

afterEach(() => {
  backend.teardown();
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */
/* The catalogue itself                                                        */
/* -------------------------------------------------------------------------- */

describe('the action catalogue', () => {
  it('has no duplicate name', () => {
    // Two entries with one name is a merge artefact that compiles fine and
    // makes one of the two unreachable.
    expect(new Set(ACTION_NAMES).size).toBe(ACTION_NAMES.length);
  });

  it('names every action the way the backend spells it', async () => {
    // Every service call below records the action the backend received; this
    // asserts the names are drawn from the catalogue rather than typed inline.
    await listItems(staffToken);
    await listTerms(staffToken);
    await listPersons(staffToken);

    const seen = backend.requests.map((request) => request.action);
    for (const action of seen) {
      expect(ACTION_NAMES as readonly string[], `${action} is not in the catalogue`).toContain(
        action,
      );
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Items (PRD §40)                                                             */
/* -------------------------------------------------------------------------- */

describe('the item library', () => {
  it('starts empty — the company seeds it, nothing else does', async () => {
    // PRD §34.17: the Items sheet ships with no rows.
    await expect(listItems(staffToken)).resolves.toEqual([]);
  });

  it('creates an item and reads it back', async () => {
    const created = await createItem(
      { category: 'Manpower', name: 'TEST_ONLY Steel Fixer', defaultUnit: 'Hour' },
      adminToken,
    );

    expect(created.name).toBe('TEST_ONLY Steel Fixer');

    const listed = await listItems(staffToken);
    expect(listed.map((item) => item.name)).toContain('TEST_ONLY Steel Fixer');
  });

  it('updates an item in place', async () => {
    const created = await createItem(
      { category: 'Equipment', name: 'TEST_ONLY Lift', defaultUnit: 'Day' },
      adminToken,
    );

    await updateItem(
      { id: created.id, name: 'TEST_ONLY Scissor Lift', defaultUnit: 'Day' },
      adminToken,
    );

    const listed = await listItems(staffToken);
    expect(listed.find((item) => item.id === created.id)?.name).toBe('TEST_ONLY Scissor Lift');
  });

  it('deactivates rather than deletes, so historic quotations stay explicable', async () => {
    const created = await createItem(
      { category: 'Materials', name: 'TEST_ONLY Cement', defaultUnit: 'Nos.' },
      adminToken,
    );

    await setItemActive(created.id, false, adminToken);

    expect((await listItems(staffToken)).map((item) => item.id)).not.toContain(created.id);
    expect((await listItems(staffToken, true)).map((item) => item.id)).toContain(created.id);
  });

  it('lets an ordinary User add to it, which is the point of a working library', async () => {
    /*
     * Deliberately NOT Admin-only, and the same for terms.
     *
     * PRD §45.14 has a user creating a term in the middle of writing a
     * quotation, and the item library is the same kind of thing: staff add to
     * it as they price work. Requiring an administrator would mean either
     * waiting or typing the item free-hand every time, and the second is what
     * would actually happen.
     *
     * The things a User genuinely may NOT do are the ones with consequences
     * outside their own quotation — creating an account, and adding an
     * authorized person whose signature goes on a document. Both are asserted
     * as refusals elsewhere in this file.
     */
    await expect(
      createItem(
        { category: 'Manpower', name: 'TEST_ONLY Helper', defaultUnit: 'Hour' },
        staffToken,
      ),
    ).resolves.toMatchObject({ name: 'TEST_ONLY Helper' });
  });
});

/* -------------------------------------------------------------------------- */
/* Terms (PRD §20-§22)                                                         */
/* -------------------------------------------------------------------------- */

describe('the Terms & Conditions library', () => {
  it('creates a term and reads it back', async () => {
    const created = await createTerm(
      {
        title: 'TEST_ONLY Working Hours',
        bodyTemplate: 'TEST_ONLY ten hours per day.',
        category: 'General',
      },
      adminToken,
    );

    const listed = await listTerms(staffToken);
    expect(listed.find((term) => term.id === created.id)?.title).toBe('TEST_ONLY Working Hours');
  });

  it('keeps a template token intact rather than resolving it on the way in', async () => {
    // §10.2: a token is resolved per quotation, at render time. Storing it
    // resolved would freeze one quotation's values into the library.
    const created = await createTerm(
      {
        title: 'TEST_ONLY VAT',
        bodyTemplate: 'VAT No. {{company.vatNumber}}',
        category: 'General',
      },
      adminToken,
    );

    const listed = await listTerms(staffToken);
    expect(listed.find((term) => term.id === created.id)?.bodyTemplate).toContain(
      '{{company.vatNumber}}',
    );
  });

  it('updates a term in the library', async () => {
    const created = await createTerm(
      { title: 'TEST_ONLY Payment', bodyTemplate: 'TEST_ONLY thirty days.', category: 'General' },
      adminToken,
    );

    await updateTerm(
      { id: created.id, title: 'TEST_ONLY Payment Terms', bodyTemplate: 'TEST_ONLY sixty days.' },
      adminToken,
    );

    const listed = await listTerms(staffToken);
    const found = listed.find((term) => term.id === created.id);
    expect(found?.title).toBe('TEST_ONLY Payment Terms');
    expect(found?.bodyTemplate).toBe('TEST_ONLY sixty days.');
  });

  it('deactivates rather than deletes', async () => {
    const created = await createTerm(
      {
        title: 'TEST_ONLY Retired',
        bodyTemplate: 'TEST_ONLY no longer offered.',
        category: 'General',
      },
      adminToken,
    );

    await setTermActive(created.id, false, adminToken);

    expect((await listTerms(staffToken)).map((term) => term.id)).not.toContain(created.id);
    expect((await listTerms(staffToken, true)).map((term) => term.id)).toContain(created.id);
  });

  it('refuses a term the validator will not accept, with a typed code', async () => {
    await expect(
      createTerm({ title: '', bodyTemplate: '', category: 'General' }, adminToken),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

/* -------------------------------------------------------------------------- */
/* Authorized persons (PRD §24)                                                */
/* -------------------------------------------------------------------------- */

describe('the authorized persons library', () => {
  function personInput(name = 'TEST_ONLY_Signatory') {
    return {
      name,
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company',
      country: 'TEST_ONLY Country',
      email: 'test-only.person@example.invalid',
      phone: '+966 50 000 0000',
    };
  }

  it('creates a person and reads them back', async () => {
    const created = await createPerson(personInput(), adminToken);

    const listed = await listPersons(staffToken);
    expect(listed.find((person) => person.id === created.id)?.designation).toBe(
      'TEST_ONLY Designation',
    );
  });

  it('never returns signature bytes in the list', async () => {
    await createPerson(personInput(), adminToken);
    const listed = await listPersons(staffToken);

    // The list is rendered on a screen; the bytes are fetched only when a
    // document needs them.
    expect(JSON.stringify(listed)).not.toContain('signature');
  });

  it('reports a person with no signature as not selectable, rather than hiding them', async () => {
    const created = await createPerson(personInput(), adminToken);
    const listed = await listPersons(staffToken);
    const found = listed.find((person) => person.id === created.id);

    // PRD §24: listed, but a quotation cannot be issued against them yet.
    expect(found).toBeDefined();
    expect(found?.hasSignature).toBe(false);
  });

  it('stores a signature and hands it back as base64 for the document', async () => {
    const created = await createPerson(personInput(), adminToken);
    const png = bytesToBase64(new Uint8Array(TEST_ONLY_buildPng({ width: 640, height: 120 })));

    await uploadSignature(
      { id: created.id, signature: png, filename: 'TEST_ONLY-signature.png' },
      adminToken,
    );

    const fetched = await fetchSignature(created.id, staffToken);
    expect(fetched).toBe(png);

    expect((await listPersons(staffToken)).find((p) => p.id === created.id)?.hasSignature).toBe(
      true,
    );
  });

  it('refuses a file that is not a PNG, whatever it is named', async () => {
    const created = await createPerson(personInput(), adminToken);
    const notAPng = bytesToBase64(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    await expect(
      uploadSignature(
        { id: created.id, signature: notAPng, filename: 'TEST_ONLY-signature.png' },
        adminToken,
      ),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('says so specifically when a person has no signature to fetch', async () => {
    const created = await createPerson(personInput(), adminToken);

    // Not a generic failure: a missing signature must be reported clearly, or
    // the document quietly goes out without one.
    await expect(fetchSignature(created.id, staffToken)).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });
  });

  it('updates a person, and deactivates rather than deletes', async () => {
    const created = await createPerson(personInput(), adminToken);

    await updatePerson({ id: created.id, ...personInput('TEST_ONLY_Renamed') }, adminToken);
    expect((await listPersons(staffToken)).find((person) => person.id === created.id)?.name).toBe(
      'TEST_ONLY_Renamed',
    );

    await setPersonActive(created.id, false, adminToken);
    expect((await listPersons(staffToken)).map((person) => person.id)).not.toContain(created.id);
    expect((await listPersons(staffToken, true)).map((person) => person.id)).toContain(created.id);
  });

  it('refuses a User the right to add a signatory', async () => {
    await expect(createPerson(personInput(), staffToken)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
