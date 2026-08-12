import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SignatoriesPage from '@/pages/signatories/index';
import * as signatoryService from '@/services/signatories/signatory-service';
import type { AuthorizedPerson } from '@/services/signatories/signatory-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

function person(overrides: Partial<AuthorizedPerson> = {}): AuthorizedPerson {
  return {
    id: 'person-1',
    name: 'TEST_ONLY_Signatory',
    designation: 'TEST_ONLY Designation',
    companyName: 'TEST_ONLY Company',
    country: 'TEST_ONLY Country',
    email: 'test-only.signatory@example.invalid',
    phone: '+966 50 000 0000',
    hasSignature: true,
    selectable: true,
    active: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function renderPage(role: 'Admin' | 'User' = 'Admin') {
  return renderWithProviders(<SignatoriesPage />, {
    user: role === 'Admin' ? TEST_ONLY_ADMIN : TEST_ONLY_USER,
  });
}

async function fillPersonForm(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/^name/i), 'TEST_ONLY_New');
  await user.type(screen.getByLabelText(/designation/i), 'TEST_ONLY Role');
  await user.type(screen.getByLabelText(/company name/i), 'TEST_ONLY Company');
  await user.type(screen.getByLabelText(/country/i), 'TEST_ONLY Country');
  await user.type(screen.getByLabelText(/email/i), 'test-only.new@example.invalid');
  await user.type(screen.getByLabelText(/phone/i), '+966 50 111 1111');
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([person()]);
});

/* -------------------------------------------------------------------------- */

describe('access', () => {
  it('is refused to a non-Admin', () => {
    renderPage('User');

    expect(screen.getByText(/do not have permission|not authorized/i)).toBeInTheDocument();
    expect(signatoryService.listPersons).not.toHaveBeenCalled();
  });

  it('is available to an Admin', async () => {
    renderPage();
    expect(await screen.findByText('TEST_ONLY_Signatory')).toBeInTheDocument();
  });
});

describe('the empty library (PRD §34)', () => {
  it('shows an empty state, never a sample signatory', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no authorized persons yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('listing', () => {
  it('includes inactive people so they can be restored', async () => {
    const list = vi
      .spyOn(signatoryService, 'listPersons')
      .mockResolvedValue([person({ active: false })]);
    renderPage();

    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('states plainly when someone has no signature and cannot be selected', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([
      person({ hasSignature: false, selectable: false }),
    ]);
    renderPage();

    expect(await screen.findByText(/no signature — cannot be selected/i)).toBeInTheDocument();
  });
});

describe('create and edit', () => {
  it('creates a person with all six printed fields', async () => {
    const create = vi.spyOn(signatoryService, 'createPerson').mockResolvedValue(person());
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /add person/i }));
    await fillPersonForm(user);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        {
          name: 'TEST_ONLY_New',
          designation: 'TEST_ONLY Role',
          companyName: 'TEST_ONLY Company',
          country: 'TEST_ONLY Country',
          email: 'test-only.new@example.invalid',
          phone: '+966 50 111 1111',
        },
        expect.any(String),
      );
    });
  });

  it('validates before opening a request', async () => {
    const create = vi.spyOn(signatoryService, 'createPerson');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /add person/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // "Name" and "Company name" both match a loose pattern; anchor it.
    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(screen.getByText('Country is required')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a malformed email and phone', async () => {
    const create = vi.spyOn(signatoryService, 'createPerson');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /add person/i }));
    await user.type(screen.getByLabelText(/^name/i), 'TEST_ONLY_New');
    await user.type(screen.getByLabelText(/designation/i), 'TEST_ONLY Role');
    await user.type(screen.getByLabelText(/company name/i), 'TEST_ONLY Company');
    await user.type(screen.getByLabelText(/country/i), 'TEST_ONLY Country');
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/phone/i), 'abc');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/valid email address/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('prefills the form when editing', async () => {
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText('TEST_ONLY_Signatory')).closest('li');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit' }));

    expect(screen.getByLabelText(/^name/i)).toHaveValue('TEST_ONLY_Signatory');
    expect(screen.getByLabelText(/country/i)).toHaveValue('TEST_ONLY Country');
  });

  it('surfaces a duplicate against the field', async () => {
    vi.spyOn(signatoryService, 'createPerson').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'That person is already in the library.', {
        fields: { name: 'This name and designation already exist.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /add person/i }));
    await fillPersonForm(user);
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/already exist/i)).toBeInTheDocument();
  });
});

describe('activation', () => {
  it('deactivates rather than deleting', async () => {
    const setActive = vi
      .spyOn(signatoryService, 'setPersonActive')
      .mockResolvedValue(person({ active: false }));
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /deactivate TEST_ONLY_Signatory/i }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith('person-1', false, expect.any(String));
    });
    expect(screen.queryByRole('button', { name: /^delete/i })).toBeNull();
  });

  it('shows the full reason when deactivation is blocked by a draft', async () => {
    vi.spyOn(signatoryService, 'setPersonActive').mockRejectedValue(
      new AppError(
        'VALIDATION_FAILED',
        'TEST_ONLY_Signatory is the authorized person on a draft quotation that has not been issued yet (draft-77). Change the signatory there first.',
      ),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /deactivate TEST_ONLY_Signatory/i }));

    // The message names the blocking draft, so it must not be collapsed into
    // something generic.
    expect(await screen.findByText(/draft-77/)).toBeInTheDocument();
  });
});

describe('signature upload', () => {
  it('opens the upload dialog and explains that replacing keeps history', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /replace signature/i }));

    expect(screen.getByText(/quotations already issued are unchanged/i)).toBeInTheDocument();
  });

  it('offers "Add signature" for a person who has none', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([
      person({ hasSignature: false, selectable: false }),
    ]);
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /add signature/i }));

    expect(screen.getByLabelText(/signature image/i)).toBeInTheDocument();
  });

  it('cannot upload until a file has been chosen', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /replace signature/i }));

    expect(screen.getByRole('button', { name: /upload signature/i })).toBeDisabled();
  });

  it('rejects a JPEG renamed .png before it reaches the server', async () => {
    const upload = vi.spyOn(signatoryService, 'uploadSignature');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /replace signature/i }));

    const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])], 'signature.png', {
      type: 'image/png',
    });
    await user.upload(screen.getByLabelText(/signature image/i), jpeg);

    expect(await screen.findByText(/not a PNG image/i)).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it('states the transparency requirement up front', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY_Signatory');
    await user.click(screen.getByRole('button', { name: /replace signature/i }));

    expect(screen.getByText(/transparent background/i)).toBeInTheDocument();
  });
});
