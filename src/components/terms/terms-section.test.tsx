import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NewQuotationPage from '@/pages/quotations/new';
import * as quotationService from '@/services/quotation/quotation-service';
import * as termsService from '@/services/terms/terms-service';
import type { TermTemplate } from '@/services/terms/terms-service';
import { AppError } from '@/services/api/errors';
import { DEFAULT_CLOSING_PARAGRAPH } from '@shared/company-defaults';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const SAVE_RESULT = {
  draftId: 'draft-1',
  quotationNumber: '',
  status: 'Pending' as const,
  createdAt: '2026-08-11T00:00:00Z',
  updatedAt: '2026-08-11T00:00:00Z',
};

/**
 * A stand-in library. Obviously synthetic — the real 11 terms live only in the
 * Admin import, and putting them here would blur test data into product data.
 */
const LIBRARY: TermTemplate[] = [
  {
    id: 'term-working-hours',
    title: 'TEST_ONLY Working Hours',
    bodyTemplate: 'TEST_ONLY minimum hours per day.',
    category: 'Manpower',
    sortOrder: 10,
    active: true,
  },
  {
    id: 'term-payment',
    title: 'TEST_ONLY Payment Terms',
    bodyTemplate: 'TEST_ONLY payment within 30 days.',
    category: 'General',
    sortOrder: 20,
    active: true,
  },
  {
    id: 'term-vat',
    title: 'TEST_ONLY VAT',
    bodyTemplate: '{{totals.vatRate}} VAT applies for {{client.companyName}}.',
    category: 'General',
    sortOrder: 30,
    active: true,
  },
];

function renderPage() {
  return renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
}

/** The ordered list of selected terms, as the document would number them. */
function selectedList(): HTMLElement {
  return screen.getByRole('list', { name: '' });
}

async function selectTerm(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> {
  await user.click(await screen.findByRole('checkbox', { name: label }));
}

function savedPayload(): quotationService.QuotationPayload {
  const mock = vi.mocked(quotationService.saveQuotation);
  const call = mock.mock.calls.at(-1);
  if (call === undefined) throw new Error('saveQuotation was not called');
  return call[0];
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(quotationService, 'saveQuotation').mockResolvedValue(SAVE_RESULT);
  vi.spyOn(termsService, 'listTerms').mockResolvedValue(LIBRARY);
});

/* -------------------------------------------------------------------------- */

describe('selection (PRD §20)', () => {
  it('lists the library as checkboxes', async () => {
    renderPage();

    for (const term of LIBRARY) {
      expect(await screen.findByRole('checkbox', { name: term.title })).toBeInTheDocument();
    }
  });

  it('starts with nothing selected', async () => {
    renderPage();

    await screen.findByRole('checkbox', { name: LIBRARY[0]?.title ?? '' });
    expect(screen.getByText(/no terms selected/i)).toBeInTheDocument();
  });

  it('adds a term to the quotation when checked', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');

    const list = selectedList();
    expect(within(list).getByText('TEST_ONLY Payment Terms')).toBeInTheDocument();
    expect(within(list).getByText('TEST_ONLY payment within 30 days.')).toBeInTheDocument();
  });

  it('removes it again when unchecked', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await selectTerm(user, 'TEST_ONLY Payment Terms');

    expect(screen.getByText(/no terms selected/i)).toBeInTheDocument();
  });

  it('removes a term from the selected list without unchecking it in the library', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY VAT');
    await user.click(screen.getByRole('button', { name: 'Remove "TEST_ONLY VAT"' }));

    expect(screen.getByText(/no terms selected/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'TEST_ONLY VAT' })).not.toBeChecked();
  });
});

describe('ordering (§10.3)', () => {
  async function selectThree(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await selectTerm(user, 'TEST_ONLY Working Hours');
    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await selectTerm(user, 'TEST_ONLY VAT');
  }

  function positions(): string[] {
    return within(selectedList())
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '');
  }

  it('numbers positionally, in selection order', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectThree(user);

    const items = positions();
    expect(items[0]).toContain('1.');
    expect(items[0]).toContain('TEST_ONLY Working Hours');
    expect(items[2]).toContain('3.');
    expect(items[2]).toContain('TEST_ONLY VAT');
  });

  it('renumbers after a move', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectThree(user);

    await user.click(screen.getByRole('button', { name: 'Move "TEST_ONLY VAT" up' }));

    const items = positions();
    expect(items[1]).toContain('TEST_ONLY VAT');
    expect(items[1]).toContain('2.');
    expect(items[2]).toContain('TEST_ONLY Payment Terms');
    expect(items[2]).toContain('3.');
  });

  it('renumbers after a middle term is removed', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectThree(user);

    await user.click(screen.getByRole('button', { name: 'Remove "TEST_ONLY Payment Terms"' }));

    const items = positions();
    expect(items).toHaveLength(2);
    expect(items[1]).toContain('2.');
    expect(items[1]).toContain('TEST_ONLY VAT');
  });

  it('cannot move the first term up or the last one down', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectThree(user);

    expect(screen.getByRole('button', { name: 'Move "TEST_ONLY Working Hours" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "TEST_ONLY VAT" down' })).toBeDisabled();
  });

  it('persists the order on the quotation, renumbered from zero', async () => {
    const user = userEvent.setup();
    renderPage();
    await selectThree(user);

    await user.click(screen.getByRole('button', { name: 'Move "TEST_ONLY VAT" up' }));
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    expect(savedPayload().terms?.map((term) => [term.sortOrder, term.title])).toEqual([
      [0, 'TEST_ONLY Working Hours'],
      [1, 'TEST_ONLY VAT'],
      [2, 'TEST_ONLY Payment Terms'],
    ]);
  });
});

describe('token resolution', () => {
  it('shows the resolved text once the client is filled in', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/company name/i), 'TEST_ONLY Client Co.');
    await selectTerm(user, 'TEST_ONLY VAT');

    expect(
      within(selectedList()).getByText('15% VAT applies for TEST_ONLY Client Co..'),
    ).toBeInTheDocument();
  });

  it('leaves an unfilled token visible and warns instead of blanking it', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY VAT');

    const list = selectedList();

    // The body keeps the placeholder rather than printing "15% VAT applies for ."
    expect(
      within(list).getByText('15% VAT applies for {{client.companyName}}.'),
    ).toBeInTheDocument();
    // …and the gap is called out explicitly.
    expect(
      within(list).getByText(/needs a value[\s\S]*\{\{client\.companyName\}\}/i),
    ).toBeInTheDocument();
  });

  it('sends the resolved snapshot alongside the template', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/company name/i), 'TEST_ONLY Client Co.');
    await selectTerm(user, 'TEST_ONLY VAT');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    const term = savedPayload().terms?.[0];
    expect(term?.body).toBe('15% VAT applies for TEST_ONLY Client Co..');
    expect(term?.bodyTemplate).toBe('{{totals.vatRate}} VAT applies for {{client.companyName}}.');
  });
});

describe('quotation-local editing (PRD §22)', () => {
  async function editSelected(
    user: ReturnType<typeof userEvent.setup>,
    body: string,
  ): Promise<void> {
    await user.click(within(selectedList()).getByRole('button', { name: 'Edit' }));
    const textarea = screen.getByLabelText(/term content/i);
    await user.clear(textarea);
    await user.type(textarea, body);
    await user.click(screen.getByRole('button', { name: /apply to this quotation/i }));
  }

  it('never calls a library mutation', async () => {
    const update = vi.spyOn(termsService, 'updateTerm');
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await editSelected(user, 'TEST_ONLY payment within 45 days.');

    expect(update).not.toHaveBeenCalled();
  });

  it('marks the term as modified for this quotation', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await editSelected(user, 'TEST_ONLY payment within 45 days.');

    const list = selectedList();
    expect(within(list).getByText(/modified for this quotation/i)).toBeInTheDocument();
    expect(within(list).getByText('TEST_ONLY payment within 45 days.')).toBeInTheDocument();
  });

  it('reverts to the library wording', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await editSelected(user, 'TEST_ONLY payment within 45 days.');
    await user.click(screen.getByRole('button', { name: /revert to library version/i }));

    const list = selectedList();
    expect(within(list).getByText('TEST_ONLY payment within 30 days.')).toBeInTheDocument();
    expect(within(list).queryByText(/modified for this quotation/i)).not.toBeInTheDocument();
  });

  it('records the override on the saved quotation', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await editSelected(user, 'TEST_ONLY payment within 45 days.');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    expect(savedPayload().terms?.[0]?.source).toBe('library-overridden');
  });

  it('rejects an edit that empties the term', async () => {
    const user = userEvent.setup();
    renderPage();

    await selectTerm(user, 'TEST_ONLY Payment Terms');
    await user.click(within(selectedList()).getByRole('button', { name: 'Edit' }));
    await user.clear(screen.getByLabelText(/term content/i));
    await user.click(screen.getByRole('button', { name: /apply to this quotation/i }));

    expect(screen.getByText(/term content is required/i)).toBeInTheDocument();
  });
});

describe('+ Create New Term (PRD §21)', () => {
  async function createTerm(
    user: ReturnType<typeof userEvent.setup>,
    options: { saveToLibrary: boolean },
  ): Promise<void> {
    await user.click(screen.getByRole('button', { name: /create new term/i }));
    await user.type(screen.getByLabelText(/term name/i), 'TEST_ONLY Mobilization');
    await user.type(screen.getByLabelText(/term content/i), 'TEST_ONLY mobilization wording.');

    if (options.saveToLibrary) {
      await user.click(screen.getByRole('checkbox', { name: /save to library/i }));
    }

    await user.click(screen.getByRole('button', { name: /add term/i }));
  }

  it('leaves "Save to Library" unticked by default', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /create new term/i }));
    expect(screen.getByRole('checkbox', { name: /save to library/i })).not.toBeChecked();
  });

  it('adds the term to the quotation only', async () => {
    const create = vi.spyOn(termsService, 'createTerm');
    const user = userEvent.setup();
    renderPage();

    await createTerm(user, { saveToLibrary: false });

    expect(create).not.toHaveBeenCalled();
    expect(within(selectedList()).getByText('TEST_ONLY Mobilization')).toBeInTheDocument();
    expect(within(selectedList()).getByText(/this quotation only/i)).toBeInTheDocument();
  });

  it('writes exactly one library row when asked to', async () => {
    const create = vi.spyOn(termsService, 'createTerm').mockResolvedValue({
      id: 'term-mobilization',
      title: 'TEST_ONLY Mobilization',
      bodyTemplate: 'TEST_ONLY mobilization wording.',
      category: 'General',
      sortOrder: 40,
      active: true,
    });
    const user = userEvent.setup();
    renderPage();

    await createTerm(user, { saveToLibrary: true });

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
    });
    expect(create).toHaveBeenCalledWith(
      {
        title: 'TEST_ONLY Mobilization',
        bodyTemplate: 'TEST_ONLY mobilization wording.',
        category: 'General',
      },
      expect.any(String),
    );
  });

  it('keeps the modal open with the text intact when the library save fails', async () => {
    vi.spyOn(termsService, 'createTerm').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'A term with that title already exists.', {
        fields: { title: 'A term with that title already exists.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await createTerm(user, { saveToLibrary: true });

    await waitFor(() => {
      expect(screen.getByText(/a term with that title already exists/i)).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/term content/i)).toHaveValue('TEST_ONLY mobilization wording.');
  });

  it('validates before it opens a request', async () => {
    const create = vi.spyOn(termsService, 'createTerm');
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /create new term/i }));
    await user.click(screen.getByRole('button', { name: /add term/i }));

    expect(screen.getByText(/a term name is required/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });
});

describe('a failed library load (error handling)', () => {
  it('warns without blocking the quotation', async () => {
    vi.spyOn(termsService, 'listTerms').mockRejectedValue(
      new AppError('INTERNAL_ERROR', 'The library is unavailable.'),
    );
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument();

    // The user can still write a term and finish the document.
    await user.click(screen.getByRole('button', { name: /create new term/i }));
    await user.type(screen.getByLabelText(/term name/i), 'TEST_ONLY Local');
    await user.type(screen.getByLabelText(/term content/i), 'TEST_ONLY local wording.');
    await user.click(screen.getByRole('button', { name: /add term/i }));

    expect(within(selectedList()).getByText('TEST_ONLY Local')).toBeInTheDocument();
  });
});

describe('the closing paragraph (PRD §23)', () => {
  it('defaults to the company wording', async () => {
    renderPage();
    await screen.findByRole('checkbox', { name: LIBRARY[0]?.title ?? '' });

    expect(screen.getByLabelText(/closing paragraph/i)).toHaveValue(DEFAULT_CLOSING_PARAGRAPH);
  });

  it('is editable per quotation and is what gets saved', async () => {
    const user = userEvent.setup();
    renderPage();

    const editor = screen.getByLabelText(/closing paragraph/i);
    await user.clear(editor);
    await user.type(editor, 'TEST_ONLY closing wording for this client.');
    await user.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => {
      expect(quotationService.saveQuotation).toHaveBeenCalled();
    });

    expect(savedPayload().closingParagraph).toBe('TEST_ONLY closing wording for this client.');
  });

  it('restores the company default without a request', async () => {
    const user = userEvent.setup();
    renderPage();

    const editor = screen.getByLabelText(/closing paragraph/i);
    await user.clear(editor);
    await user.type(editor, 'TEST_ONLY replaced.');
    await user.click(screen.getByRole('button', { name: /restore the company default/i }));

    expect(editor).toHaveValue(DEFAULT_CLOSING_PARAGRAPH);
  });

  it('offers no restore when the default is already in place', async () => {
    renderPage();
    await screen.findByRole('checkbox', { name: LIBRARY[0]?.title ?? '' });

    expect(screen.getByRole('button', { name: /restore the company default/i })).toBeDisabled();
  });
});
