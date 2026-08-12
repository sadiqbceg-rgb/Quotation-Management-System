import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import TermsPage from '@/pages/terms/index';
import * as termsService from '@/services/terms/terms-service';
import type { TermTemplate } from '@/services/terms/terms-service';
import { AppError } from '@/services/api/errors';
import { renderWithProviders, TEST_ONLY_ADMIN, TEST_ONLY_USER } from '@/__fixtures__/test-render';

const LIBRARY: TermTemplate[] = [
  {
    id: 'term-a',
    title: 'TEST_ONLY Working Hours',
    bodyTemplate: 'TEST_ONLY minimum hours per day.',
    category: 'Manpower',
    sortOrder: 10,
    active: true,
  },
  {
    id: 'term-b',
    title: 'TEST_ONLY Payment Terms',
    bodyTemplate: 'TEST_ONLY payment within 30 days.',
    category: 'General',
    sortOrder: 20,
    active: true,
  },
];

function renderPage(role: 'Admin' | 'User' = 'Admin') {
  return renderWithProviders(<TermsPage />, {
    user: role === 'Admin' ? TEST_ONLY_ADMIN : TEST_ONLY_USER,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(termsService, 'listTerms').mockResolvedValue(LIBRARY);
});

/* -------------------------------------------------------------------------- */

describe('the empty library (PRD §34)', () => {
  it('shows an empty state rather than sample terms', async () => {
    vi.spyOn(termsService, 'listTerms').mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/library is empty/i)).toBeInTheDocument();
    expect(screen.queryByText(/working hours/i)).not.toBeInTheDocument();
  });

  it('does not import anything on load', async () => {
    const importSpy = vi.spyOn(termsService, 'importReferenceTerms');
    vi.spyOn(termsService, 'listTerms').mockResolvedValue([]);
    renderPage();

    await screen.findByText(/library is empty/i);
    expect(importSpy).not.toHaveBeenCalled();
  });
});

describe('listing', () => {
  it('renders each term with its wording', async () => {
    renderPage();

    expect(await screen.findByText('TEST_ONLY Working Hours')).toBeInTheDocument();
    expect(screen.getByText('TEST_ONLY payment within 30 days.')).toBeInTheDocument();
  });

  it('includes inactive terms so they can be restored', async () => {
    const list = vi.spyOn(termsService, 'listTerms').mockResolvedValue([
      ...LIBRARY,
      { ...LIBRARY[0], id: 'term-c', title: 'TEST_ONLY Retired', active: false } as TermTemplate,
    ]);
    renderPage();

    expect(await screen.findByText('TEST_ONLY Retired')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith(expect.any(String), true);
  });

  it('reports a failed load without leaking internal detail (§19.9)', async () => {
    vi.spyOn(termsService, 'listTerms').mockRejectedValue(
      new AppError('INTERNAL_ERROR', 'Sheet "Terms" is missing on spreadsheet 1AbC.'),
    );
    renderPage();

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.queryByText(/spreadsheet/i)).not.toBeInTheDocument();
  });
});

describe('the Admin reference import', () => {
  it('is offered only to an Admin', async () => {
    renderPage('User');

    await screen.findByText('TEST_ONLY Working Hours');
    expect(screen.queryByRole('button', { name: /import company terms/i })).not.toBeInTheDocument();
  });

  it('runs on an explicit click and reports what it did', async () => {
    const importSpy = vi
      .spyOn(termsService, 'importReferenceTerms')
      .mockResolvedValue({ imported: 11, skipped: 0, total: 11 });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: /import company terms/i }));

    await waitFor(() => {
      expect(importSpy).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/imported 11 of 11/i)).toBeInTheDocument();
  });

  it('says plainly when a second run changes nothing', async () => {
    vi.spyOn(termsService, 'importReferenceTerms').mockResolvedValue({
      imported: 0,
      skipped: 11,
      total: 11,
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: /import company terms/i }));

    expect(await screen.findByText(/nothing to import/i)).toBeInTheDocument();
  });
});

describe('create and edit', () => {
  it('creates a term', async () => {
    const create = vi.spyOn(termsService, 'createTerm').mockResolvedValue({
      id: 'term-new',
      title: 'TEST_ONLY Mobilization',
      bodyTemplate: 'TEST_ONLY mobilization wording.',
      category: 'General',
      sortOrder: 30,
      active: true,
    });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: /add term/i }));
    await user.type(screen.getByLabelText(/term name/i), 'TEST_ONLY Mobilization');
    await user.type(screen.getByLabelText(/term content/i), 'TEST_ONLY mobilization wording.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(create).toHaveBeenCalledWith(
        {
          title: 'TEST_ONLY Mobilization',
          bodyTemplate: 'TEST_ONLY mobilization wording.',
          category: 'General',
        },
        expect.any(String),
      );
    });
  });

  it('validates before opening a request', async () => {
    const create = vi.spyOn(termsService, 'createTerm');
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: /add term/i }));
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/a term name is required/i)).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('surfaces a duplicate title against the field', async () => {
    vi.spyOn(termsService, 'createTerm').mockRejectedValue(
      new AppError('VALIDATION_FAILED', 'A term with that title already exists.', {
        fields: { title: 'A term with that title already exists.' },
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: /add term/i }));
    await user.type(screen.getByLabelText(/term name/i), 'TEST_ONLY Working Hours');
    await user.type(screen.getByLabelText(/term content/i), 'TEST_ONLY duplicate body.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
  });

  it('edits an existing term through the library action', async () => {
    const update = vi.spyOn(termsService, 'updateTerm').mockResolvedValue(LIBRARY[0] as TermTemplate);
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText('TEST_ONLY Working Hours')).closest('li');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Edit' }));

    const content = screen.getByLabelText(/term content/i);
    await user.clear(content);
    await user.type(content, 'TEST_ONLY revised hours wording.');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(update).toHaveBeenCalledWith(
        {
          id: 'term-a',
          title: 'TEST_ONLY Working Hours',
          bodyTemplate: 'TEST_ONLY revised hours wording.',
        },
        expect.any(String),
      );
    });
  });
});

describe('soft delete and ordering', () => {
  it('deactivates rather than deleting', async () => {
    const setActive = vi.spyOn(termsService, 'setTermActive').mockResolvedValue({ id: 'term-a' });
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText('TEST_ONLY Working Hours')).closest('li');
    await user.click(within(row as HTMLElement).getByRole('button', { name: 'Deactivate' }));

    await waitFor(() => {
      expect(setActive).toHaveBeenCalledWith('term-a', false, expect.any(String));
    });
  });

  it('persists a reorder as the full ordered list', async () => {
    const reorder = vi.spyOn(termsService, 'reorderTerms').mockResolvedValue({ ordered: 2 });
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    await user.click(screen.getByRole('button', { name: 'Move "TEST_ONLY Payment Terms" up' }));

    await waitFor(() => {
      expect(reorder).toHaveBeenCalledWith(['term-b', 'term-a'], expect.any(String));
    });
  });

  it('cannot move the first term up or the last one down', async () => {
    renderPage();

    await screen.findByText('TEST_ONLY Working Hours');
    expect(screen.getByRole('button', { name: 'Move "TEST_ONLY Working Hours" up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move "TEST_ONLY Payment Terms" down' })).toBeDisabled();
  });
});
