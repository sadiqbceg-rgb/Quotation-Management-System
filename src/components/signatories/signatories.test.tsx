import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewQuotationPage from '@/pages/quotations/new';
import * as quotationService from '@/services/quotation/quotation-service';
import * as signatoryService from '@/services/signatories/signatory-service';
import * as termsService from '@/services/terms/terms-service';
import type { AuthorizedPerson } from '@/services/signatories/signatory-service';
import { AppError } from '@/services/api/errors';
import { base64Png } from '@shared/signature';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const SAVE_RESULT = {
  draftId: 'draft-1',
  quotationNumber: '',
  status: 'Pending' as const,
  createdAt: '2026-08-11T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
};

/**
 * Obviously synthetic signatories.
 *
 * The real person named in `reference/quotation-sample.pdf` is evidence, not a
 * fixture, and is deliberately not used here.
 */
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

/**
 * A 1×1 transparent PNG, base64.
 *
 * Not a signature and not a picture of anything — the smallest byte sequence
 * the branded type will accept, so the component has something to render.
 */
const TEST_ONLY_TINY_PNG = base64Png(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
);

function renderPage() {
  return renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
}

/**
 * The signatory dropdown.
 *
 * By ROLE, not by label text: the loading spinner carries the accessible name
 * "Loading authorized persons", so a label query resolves to the spinner and
 * every assertion after it is meaningless.
 */
function personSelector(): Promise<HTMLElement> {
  return screen.findByRole('combobox', { name: /authorized person/i });
}

async function fillRequired(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/quotation for/i), 'TEST_ONLY manpower supply');
  await user.type(screen.getByLabelText(/client name/i), 'TEST_ONLY Contact');
  await user.type(screen.getByLabelText(/^company name/i), 'TEST_ONLY Client Co.');
  await user.type(screen.getByLabelText(/address/i), 'TEST_ONLY Address');
}

function savedPayload(): quotationService.QuotationPayload {
  const call = vi.mocked(quotationService.saveQuotation).mock.calls.at(-1);
  if (call === undefined) throw new Error('saveQuotation was not called');
  return call[0];
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);
  vi.spyOn(termsService, 'listTerms').mockResolvedValue([]);
  vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([person()]);
  vi.spyOn(signatoryService, 'fetchSignature').mockResolvedValue(TEST_ONLY_TINY_PNG);
});

/* -------------------------------------------------------------------------- */

describe('selection (PRD §24)', () => {
  it('offers active persons who have a signature', async () => {
    renderPage();

    const selector = await personSelector();
    expect(
      within(selector).getByRole('option', { name: /TEST_ONLY_Signatory — TEST_ONLY Designation/ }),
    ).toBeInTheDocument();
  });

  it('excludes an inactive person', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([
      person({ active: false, selectable: false }),
    ]);
    renderPage();

    const selector = await personSelector();
    expect(within(selector).queryByRole('option', { name: /TEST_ONLY_Signatory/ })).toBeNull();
  });

  it('excludes a person with no signature, and says why', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([
      person({ hasSignature: false, selectable: false }),
    ]);
    renderPage();

    const selector = await personSelector();
    expect(within(selector).queryByRole('option', { name: /TEST_ONLY_Signatory/ })).toBeNull();
    expect(screen.getByText(/no signature image yet/i)).toBeInTheDocument();
  });

  it('fills every detail automatically on selection', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');

    for (const value of [
      'TEST_ONLY_Signatory',
      'TEST_ONLY Designation',
      'TEST_ONLY Company',
      'TEST_ONLY Country',
      '+966 50 000 0000',
      'test-only.signatory@example.invalid',
    ]) {
      expect(screen.getByText(value), value).toBeInTheDocument();
    }
  });

  it('renders the details as text, with no editable control in the DOM', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');

    // PRD §24: the user must never retype these. Text, not disabled inputs —
    // a disabled input is still a form control someone can re-enable.
    const details = screen.getByText('TEST_ONLY_Signatory').closest('div');
    expect(within(details as HTMLElement).queryByRole('textbox')).toBeNull();

    for (const input of screen.getAllByRole('textbox')) {
      expect(input).not.toHaveValue('TEST_ONLY_Signatory');
    }
  });

  it('fetches the signature through the authenticated endpoint', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');

    await waitFor(() => {
      expect(signatoryService.fetchSignature).toHaveBeenCalledWith('person-1', expect.any(String));
    });
    expect(await screen.findByAltText(/signature of TEST_ONLY_Signatory/i)).toBeInTheDocument();
  });

  it('renders the signature from base64, never from a URL', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');

    const image = await screen.findByAltText(/signature of TEST_ONLY_Signatory/i);
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(image.getAttribute('src')).not.toContain('drive.google.com');
  });

  it('does not refetch the same signature twice', async () => {
    const user = userEvent.setup();
    renderPage();

    const selector = await personSelector();
    await user.selectOptions(selector, 'person-1');
    await screen.findByAltText(/signature of/i);

    await user.selectOptions(selector, '');
    await user.selectOptions(selector, 'person-1');

    // Held in memory for the life of the page — and nowhere else.
    expect(vi.mocked(signatoryService.fetchSignature).mock.calls).toHaveLength(1);
  });
});

describe('the snapshot on the quotation (§6.3)', () => {
  it('is sent with the saved quotation', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    expect(savedPayload().authorizedPerson).toEqual({
      id: 'person-1',
      name: 'TEST_ONLY_Signatory',
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company',
      country: 'TEST_ONLY Country',
      email: 'test-only.signatory@example.invalid',
      phone: '+966 50 000 0000',
    });
  });

  it('carries no signature bytes and no Drive reference', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    const serialised = JSON.stringify(savedPayload());
    expect(serialised).not.toContain('signatureFileId');
    expect(serialised).not.toContain('data:image');
    expect(serialised).not.toContain('iVBORw0KGgo');
  });

  it('is absent from a draft saved without a signatory', async () => {
    const user = userEvent.setup();
    renderPage();

    await personSelector();
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    expect(savedPayload().authorizedPerson).toBeUndefined();
  });
});

describe('a document is never issued without a signature', () => {
  it('blocks finalize when no one is selected', async () => {
    const user = userEvent.setup();
    renderPage();

    await personSelector();
    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/select an authorized person/i).length).toBeGreaterThan(0);
    });
    expect(quotationService.saveQuotation).not.toHaveBeenCalled();
  });

  it('blocks finalize when the signature could not be loaded', async () => {
    vi.spyOn(signatoryService, 'fetchSignature').mockRejectedValue(
      new AppError('DRIVE_UPLOAD_FAILED', 'The signature could not be read.'),
    );
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');
    await screen.findByText(/could not be loaded/i);

    await fillRequired(user);
    await user.click(screen.getByRole('button', { name: /create quotation/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/cannot be issued yet/i).length).toBeGreaterThan(0);
    });
    // Never silently produces a document with a missing signature.
    expect(quotationService.saveQuotation).not.toHaveBeenCalled();
  });

  it('still allows a draft save with no signatory', async () => {
    const user = userEvent.setup();
    renderPage();

    await personSelector();
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });
  });

  it('offers a retry when the signature fetch fails', async () => {
    const fetchSpy = vi
      .spyOn(signatoryService, 'fetchSignature')
      .mockRejectedValueOnce(new AppError('DRIVE_UPLOAD_FAILED', 'Temporary failure.'))
      .mockResolvedValue(TEST_ONLY_TINY_PNG);
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(await personSelector(), 'person-1');
    await screen.findByText(/could not be loaded/i);

    await user.click(screen.getByRole('button', { name: /try again/i }));

    expect(await screen.findByAltText(/signature of/i)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('an empty library', () => {
  it('says a quotation cannot be issued without a signatory', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no authorized persons yet/i)).toBeInTheDocument();
  });

  it('warns without blocking the rest of the form when the list fails to load', async () => {
    vi.spyOn(signatoryService, 'listPersons').mockRejectedValue(
      new AppError('INTERNAL_ERROR', 'Unavailable.'),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();

    // The rest of the quotation is still usable and still saves as a draft.
    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });
  });
});
