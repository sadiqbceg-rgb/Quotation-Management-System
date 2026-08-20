/**
 * The validity period through the front half of its life (R-4).
 *
 * Company Settings decide it ONCE — when a quotation is created. From then on
 * it belongs to the quotation, exactly like the VAT rate and the closing
 * paragraph, and the screens that display or export the quotation read it from
 * the record.
 *
 * The other half — persistence, reload, re-save, validation, the legacy
 * fallback — is asserted against a really-stored record in
 * `google-apps-script/src/quotation/validity-snapshot.test.ts`.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DOCUMENT TESTS GENERATE REAL FILES
 * ---------------------------------------------------------------------------
 * The PDF and the DOCX are the deliverable. Asserting on the model that feeds
 * them would leave the one question that matters unanswered — whether the
 * number the client reads is the one the quotation was issued with — so those
 * two build an actual PDF and an actual .docx and read the text back out.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';

import NewQuotationPage from '@/pages/quotations/new';
import QuotationPreviewPage from '@/pages/quotations/preview';
import * as quotationService from '@/services/quotation/quotation-service';
import * as settingsService from '@/services/settings/settings-service';
import * as assetLoader from '@/services/document/asset-loader';
import * as signatoryService from '@/services/signatories/signatory-service';
import type { CompanySettings } from '@/services/settings/settings-service';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

import { generateQuotationPdf } from '@/services/pdf/pdf-generator';
import { generateQuotationDocx } from '@/services/docx/docx-generator';
import { TEST_ONLY_model } from '@/services/pdf/__fixtures__/pdf-test-model';
import { TEST_ONLY_pdfAssets } from '@/services/pdf/__fixtures__/pdf-test-assets';
import { TEST_ONLY_docxAssets } from '@/services/docx/__fixtures__/docx-test-assets';
import { TEST_ONLY_parsePdf } from '@/services/pdf/__fixtures__/pdf-inspect';
import {
  TEST_ONLY_openDocx,
  TEST_ONLY_part,
  TEST_ONLY_textOf,
} from '@/services/docx/__fixtures__/docx-inspect';

/** The clause the company's own reference terms carry, once resolved. */
const ISSUED_CLAUSE = 'TEST_ONLY This quotation shall remain valid for 30 days.';

function settings(quotationValidityDays: number): CompanySettings {
  return {
    business: {
      defaultVatRateBasisPoints: 1_500,
      quotationValidityDays,
      defaultClosingParagraph: 'TEST_ONLY company default closing paragraph.',
    },
    deployment: {
      companyCode: 'SFC',
      branchCode: 'RUH',
      documentTypeCode: 'QTN',
      vatNumber: '313098686600003',
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

/* -------------------------------------------------------------------------- */
/* Creating                                                                   */
/* -------------------------------------------------------------------------- */

describe('a NEW quotation takes the company default', () => {
  async function saveNewQuotation(configuredDays: number) {
    vi.spyOn(settingsService, 'getSettings').mockResolvedValue(settings(configuredDays));
    const save = vi
      .spyOn(quotationService, 'saveQuotation')
      .mockResolvedValue({ draftId: 'draft-1', quotationNumber: '' } as never);

    const user = userEvent.setup();
    renderWithProviders(<NewQuotationPage />, { user: TEST_ONLY_USER });
    await screen.findByLabelText(/quotation for/i);

    await user.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => {
      expect(save).toHaveBeenCalled();
    });

    return save.mock.calls[0]?.[0];
  }

  it('snapshots 30 onto the quotation when the company default is 30', async () => {
    expect((await saveNewQuotation(30))?.validityDays).toBe(30);
  });

  it('snapshots 45 onto the NEXT quotation once the default becomes 45', async () => {
    // The same page, mounted again after an administrator changed the default.
    expect((await saveNewQuotation(45))?.validityDays).toBe(45);
  });

  it('carries the value onto the payload, not merely into the form', async () => {
    const payload = await saveNewQuotation(30);

    // A number that only lived in component state would be lost the moment the
    // quotation was reloaded, which is the bug this whole change is about.
    expect(payload).toHaveProperty('validityDays');
    expect(payload?.validityDays).toBe(30);
  });
});

/* -------------------------------------------------------------------------- */
/* Previewing                                                                 */
/* -------------------------------------------------------------------------- */

describe('previewing a quotation issued under an older default', () => {
  function storedQuotation(): Record<string, unknown> {
    return {
      draftId: 'draft-1',
      quotationNumber: 'SFC/RUH/QTN/2026/004',
      quotationDate: '2026-08-11',
      quotationFor: 'TEST_ONLY manpower supply',
      pricingMode: 'amount',
      scopeOfWork: '',
      client: {
        clientName: 'TEST_ONLY Contact',
        companyName: 'TEST_ONLY Client Co.',
        address: 'TEST_ONLY Address, Riyadh',
      },
      lines: [
        {
          category: 'Manpower',
          description: 'TEST_ONLY General Labour',
          quantity: 1_000,
          unit: 'Hour',
          unitPrice: 2_000,
          remarks: '',
        },
      ],
      terms: [
        {
          id: 'term-validity',
          title: 'TEST_ONLY Validity',
          body: ISSUED_CLAUSE,
          bodyTemplate:
            'TEST_ONLY This quotation shall remain valid for {{quotation.validityDays}} days.',
          sortOrder: 0,
          source: 'library',
        },
      ],
      closingParagraph: 'TEST_ONLY closing paragraph.',
      authorizedPerson: null,
      discountRateBasisPoints: 0,
      vatRateBasisPoints: 1_500,
      // Issued at 30, while the company now runs on 45.
      validityDays: 30,
    };
  }

  function renderPreview(quotation = storedQuotation()): void {
    vi.spyOn(settingsService, 'getSettings').mockResolvedValue(settings(45));
    vi.spyOn(quotationService, 'getQuotationByDraftId').mockResolvedValue({
      quotation,
      status: 'Pending',
      createdBy: TEST_ONLY_USER.email,
      createdAt: '2026-08-11T00:00:00Z',
      updatedAt: '2026-08-11T00:00:00Z',
      driveFolderUrl: '',
      pdfUrl: '',
      docxUrl: '',
      tracked: false,
    } as never);
    vi.spyOn(assetLoader, 'loadDocumentAssets').mockResolvedValue({
      letterheadPreview: 'blob:letterhead',
      seal: 'blob:seal',
      logo: 'blob:logo',
    });
    vi.spyOn(signatoryService, 'fetchSignature').mockResolvedValue('' as never);

    renderWithProviders(
      <Routes>
        <Route path="/quotations/:draftId/preview" element={<QuotationPreviewPage />} />
      </Routes>,
      { user: TEST_ONLY_USER, route: '/quotations/draft-1/preview' },
    );
  }

  it('shows the clause the quotation was issued with', async () => {
    renderPreview();

    expect(await screen.findByText(ISSUED_CLAUSE)).toBeInTheDocument();
  });

  it("never shows today's company default", async () => {
    renderPreview();
    await screen.findByText(ISSUED_CLAUSE);

    expect(screen.queryByText(/valid for 45 days/i)).not.toBeInTheDocument();
  });

  it('does not ask Company Settings anything at all', async () => {
    const getSettings = vi.spyOn(settingsService, 'getSettings');
    renderPreview();
    await screen.findByText(ISSUED_CLAUSE);

    /*
     * The preview renders a SAVED quotation. There is no default to apply and
     * nothing to seed, so a settings read here could only be a way for today's
     * configuration to reach a document that was already issued.
     */
    expect(getSettings).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* The documents themselves                                                   */
/* -------------------------------------------------------------------------- */

/**
 * A model carrying the issued clause, exactly as the preview builds one.
 *
 * `terms[].body` is the resolved snapshot the quotation stores. The generators
 * receive that text and print it — they never see a template and never resolve
 * a token, which is what makes a stored quotation's documents reproducible.
 */
function modelWithIssuedClause() {
  return TEST_ONLY_model({
    terms: [{ title: 'TEST_ONLY Validity', body: ISSUED_CLAUSE }],
  });
}

describe('the generated PDF', () => {
  it('prints the validity the quotation was issued with', async () => {
    const result = await generateQuotationPdf(modelWithIssuedClause(), TEST_ONLY_pdfAssets());
    const pages = await TEST_ONLY_parsePdf(result.bytes);
    const text = pages.map((page) => page.text).join(' ');

    expect(text).toContain('remain valid for 30 days');
  });

  it('prints no other validity period', async () => {
    const result = await generateQuotationPdf(modelWithIssuedClause(), TEST_ONLY_pdfAssets());
    const pages = await TEST_ONLY_parsePdf(result.bytes);
    const text = pages.map((page) => page.text).join(' ');

    expect(text).not.toContain('45 days');
    // An unresolved placeholder reaching a client's document would be worse
    // than either number.
    expect(text).not.toContain('{{quotation.validityDays}}');
  });
});

describe('the generated DOCX', () => {
  async function documentText(): Promise<string> {
    const result = await generateQuotationDocx(modelWithIssuedClause(), TEST_ONLY_docxAssets());
    const pkg = await TEST_ONLY_openDocx(result.bytes);
    return TEST_ONLY_textOf(TEST_ONLY_part(pkg, 'word/document.xml'));
  }

  it('prints the validity the quotation was issued with', async () => {
    expect(await documentText()).toContain('remain valid for 30 days');
  });

  it('prints no other validity period', async () => {
    const text = await documentText();

    expect(text).not.toContain('45 days');
    expect(text).not.toContain('{{quotation.validityDays}}');
  });
});
