import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installGasFakes, type GasEnvironment } from '../__fixtures__/gas-fakes';
import { handlePost } from '../main';
import { createPasswordRecord } from '../auth/password';
import { createUser } from '../sheets/users-repository';
import { ITEMS_SHEET_NAME } from '../sheets/items-sheet';

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

function callAnonymous(action: string, payload: unknown = {}): Envelope {
  return postRaw(JSON.stringify({ action, requestId: 'test-request', payload }));
}

interface PublicItem {
  id: string;
  category: string;
  name: string;
  defaultUnit: string;
  active: boolean;
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
  it('refuses every item action without a session', () => {
    for (const action of ['items.list', 'items.create', 'items.update', 'items.deactivate']) {
      expect(callAnonymous(action).error?.code, action).toBe('AUTH_REQUIRED');
    }
  });
});

describe('no dummy data (PRD §34, §40)', () => {
  it('starts empty — the PRD examples are illustrative, not seed data', () => {
    expect(call('items.list').data).toEqual([]);
    expect(env.spreadsheet.dataRows(ITEMS_SHEET_NAME)).toEqual([]);
  });
});

describe('create', () => {
  it('adds an item', () => {
    const response = call('items.create', {
      category: 'Manpower',
      name: 'TEST_ONLY Carpenter',
      defaultUnit: 'Hour',
    });

    expect(response.ok).toBe(true);
    expect(response.data).toMatchObject({
      category: 'Manpower',
      name: 'TEST_ONLY Carpenter',
      defaultUnit: 'Hour',
      active: true,
    });
  });

  it('validates category, name and unit', () => {
    const response = call('items.create', { category: 'Wizardry', name: '', defaultUnit: '' });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(response.error?.fields ?? {}).sort()).toEqual([
      'category',
      'defaultUnit',
      'name',
    ]);
  });

  it('refuses a duplicate name within a category', () => {
    call('items.create', { category: 'Manpower', name: 'TEST_ONLY Mason', defaultUnit: 'Day' });

    const duplicate = call('items.create', {
      category: 'Manpower',
      name: 'test_only mason',
      defaultUnit: 'Day',
    });

    expect(duplicate.error?.code).toBe('VALIDATION_FAILED');
  });

  it('allows the same name in a different category', () => {
    call('items.create', { category: 'Manpower', name: 'TEST_ONLY Crane', defaultUnit: 'Day' });

    const other = call('items.create', {
      category: 'Equipment',
      name: 'TEST_ONLY Crane',
      defaultUnit: 'Day',
    });

    expect(other.ok).toBe(true);
  });

  it('rejects a unit that would start a spreadsheet formula', () => {
    const response = call('items.create', {
      category: 'Manpower',
      name: 'TEST_ONLY Item',
      defaultUnit: '=CMD',
    });

    expect(response.error?.code).toBe('VALIDATION_FAILED');
  });
});

describe('update and deactivate', () => {
  function seed(): PublicItem {
    return call('items.create', {
      category: 'Materials',
      name: 'TEST_ONLY Cement',
      defaultUnit: 'Ton',
    }).data as PublicItem;
  }

  it('renames an item', () => {
    const created = seed();

    const updated = call('items.update', {
      id: created.id,
      name: 'TEST_ONLY Cement OPC',
      defaultUnit: 'Ton',
    });

    expect(updated.ok).toBe(true);
    expect((call('items.list').data as PublicItem[])[0]?.name).toBe('TEST_ONLY Cement OPC');
  });

  it('reports a missing item clearly', () => {
    expect(call('items.update', { id: 'nope', name: 'x', defaultUnit: 'Kg' }).error?.code).toBe(
      'VALIDATION_FAILED',
    );
  });

  it('soft-deletes rather than removing the row', () => {
    const created = seed();

    call('items.deactivate', { id: created.id, active: false });

    // Gone from the picker, still present for historic quotations.
    expect(call('items.list').data).toEqual([]);
    expect((call('items.list', { includeInactive: true }).data as PublicItem[])[0]?.active).toBe(
      false,
    );
    expect(env.spreadsheet.dataRows(ITEMS_SHEET_NAME)).toHaveLength(1);
  });

  it('reactivates an item', () => {
    const created = seed();

    call('items.deactivate', { id: created.id, active: false });
    call('items.deactivate', { id: created.id, active: true });

    expect(call('items.list').data as PublicItem[]).toHaveLength(1);
  });
});
