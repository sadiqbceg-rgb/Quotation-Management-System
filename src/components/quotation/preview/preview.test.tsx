import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { QuotationPreview } from './QuotationPreview';
import { PreviewToolbar } from './PreviewToolbar';
import { buildDocumentModel, type BuildDocumentInput } from '@/services/document/build-document-model';
import { paginate } from '@/services/document/pagination-rules';
import type { ImageRef } from '@/services/document/document-model.types';
import { calculateTotals } from '@shared/totals';
import { halalas, milli } from '@shared/money';
import type { ItemCategory } from '@shared/types';

const TEST_ONLY_SEAL: ImageRef = {
  src: 'test-only://seal.png',
  alt: 'TEST_ONLY seal',
  intrinsicWidth: 800,
  intrinsicHeight: 731,
};

const TEST_ONLY_SIGNATURE: ImageRef = {
  src: 'test-only://signature.png',
  alt: 'TEST_ONLY signature',
  intrinsicWidth: 600,
  intrinsicHeight: 200,
};

const TEST_ONLY_LETTERHEAD = 'test-only://letterhead.png';

function line(overrides: Partial<BuildDocumentInput['lines'][number]> = {}) {
  return {
    category: 'Manpower' as ItemCategory,
    description: 'TEST_ONLY General Labour',
    quantity: milli(40_000),
    unit: 'Hour',
    unitPrice: halalas(2000),
    amount: halalas(80_000),
    remarks: '',
    ...overrides,
  };
}

function modelFrom(overrides: Partial<BuildDocumentInput> = {}) {
  const lines = overrides.lines ?? [line()];

  return buildDocumentModel({
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '2026-08-11',
    quotationFor: 'TEST_ONLY Manpower Supply',
    pricingMode: 'amount',
    scopeOfWork: 'TEST_ONLY scope paragraph.',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address',
      contactPerson: 'TEST_ONLY Attention',
    },
    lines,
    totals: calculateTotals({
      lines: lines.map((entry) => ({
        category: entry.category,
        quantity: entry.quantity,
        unitPrice: entry.unitPrice,
      })),
    }),
    terms: [{ title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum hours per day.' }],
    closingParagraph: 'TEST_ONLY thank you.',
    signatory: {
      name: 'TEST_ONLY_Signatory',
      designation: 'TEST_ONLY Designation',
      companyName: 'TEST_ONLY Company',
      country: 'TEST_ONLY Country',
      phone: '+966 50 000 0000',
      email: 'test-only@example.invalid',
    },
    assets: { seal: TEST_ONLY_SEAL, signature: TEST_ONLY_SIGNATURE },
    ...overrides,
  });
}

function renderPreview(overrides: Partial<BuildDocumentInput> = {}) {
  const model = modelFrom(overrides);
  render(<QuotationPreview model={model} letterheadUrl={TEST_ONLY_LETTERHEAD} />);
  return model;
}

/* -------------------------------------------------------------------------- */

describe('rendering', () => {
  it('renders a one-page quotation', () => {
    renderPreview();
    expect(screen.getAllByRole('region', { name: /page 1 of 1/i })).toHaveLength(1);
  });

  it('shows the canonical quotation number', () => {
    renderPreview();
    expect(screen.getByText('SFC/RUH/QTN/2026/004')).toBeInTheDocument();
  });

  it('shows the draft placeholder instead of inventing a number', () => {
    renderPreview({ quotationNumber: '' });

    expect(screen.getByText(/will be assigned on save/i)).toBeInTheDocument();
    expect(screen.queryByText(/SFC\/RUH\/QTN/)).toBeNull();
  });

  it('renders the meta labels the approved document uses', () => {
    renderPreview();

    for (const label of ['Quotation For:', 'Quotation No.:', 'Date:', 'Attention:', 'Client:']) {
      expect(screen.getByText(label), label).toBeInTheDocument();
    }
  });

  it('numbers the sections', () => {
    renderPreview();

    expect(screen.getByRole('heading', { name: '1. Scope of Work' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '2. General Terms & Conditions' }),
    ).toBeInTheDocument();
  });

  it('renders the item table with its category heading', () => {
    renderPreview();

    const table = screen.getByRole('table', { name: /manpower items/i });
    expect(within(table).getByRole('columnheader', { name: 'Designation' })).toBeInTheDocument();
    expect(within(table).getByText('TEST_ONLY General Labour')).toBeInTheDocument();
  });

  it('renders the numbered terms list', () => {
    renderPreview();

    const item = screen.getByRole('listitem');
    expect(item).toHaveTextContent('TEST_ONLY Working Hours');
    expect(item).toHaveTextContent('TEST_ONLY minimum hours per day.');
  });

  it('renders the signature block with both images', () => {
    renderPreview();

    expect(screen.getByAltText('TEST_ONLY seal')).toBeInTheDocument();
    expect(screen.getByAltText('TEST_ONLY signature')).toBeInTheDocument();
    expect(screen.getByText('TEST_ONLY_Signatory')).toBeInTheDocument();
    expect(screen.getByText('Mobile : +966 50 000 0000')).toBeInTheDocument();
  });

  it('paints the letterhead as the page background', () => {
    renderPreview();
    const page = screen.getByRole('region', { name: /page 1 of 1/i });

    // Without this the printed page has no header, footer or watermark.
    expect(page.style.backgroundImage).toContain(TEST_ONLY_LETTERHEAD);
  });
});

describe('multi-page', () => {
  it('renders one region per page and labels them', () => {
    const lines = Array.from({ length: 60 }, (_value, index) =>
      line({ description: `TEST_ONLY item ${String(index + 1)}` }),
    );

    const model = modelFrom({ lines });
    const pageCount = paginate(model).length;
    expect(pageCount).toBeGreaterThan(1);

    render(<QuotationPreview model={model} letterheadUrl={TEST_ONLY_LETTERHEAD} />);

    expect(screen.getAllByRole('region', { name: /page \d+ of \d+/i })).toHaveLength(pageCount);
    expect(
      screen.getByRole('region', { name: new RegExp(`page 1 of ${String(pageCount)}`, 'i') }),
    ).toBeInTheDocument();
  });

  it('repeats the table header on the continuation page', () => {
    const lines = Array.from({ length: 60 }, (_value, index) =>
      line({ description: `TEST_ONLY item ${String(index + 1)}` }),
    );
    render(<QuotationPreview model={modelFrom({ lines })} letterheadUrl={TEST_ONLY_LETTERHEAD} />);

    const continued = screen.getAllByRole('table', { name: /manpower items \(continued\)/i });
    expect(continued.length).toBeGreaterThan(0);

    for (const table of continued) {
      expect(within(table).getByRole('columnheader', { name: 'Designation' })).toBeInTheDocument();
    }
  });
});

describe('conditional columns', () => {
  it('omits Remarks when no item has one', () => {
    renderPreview();
    expect(screen.queryByRole('columnheader', { name: 'Remarks' })).toBeNull();
  });

  it('shows Remarks as soon as one item has one', () => {
    renderPreview({ lines: [line({ remarks: 'TEST_ONLY note' })] });
    expect(screen.getByRole('columnheader', { name: 'Remarks' })).toBeInTheDocument();
  });

  it('omits Amount and the totals block in rate-only mode', () => {
    renderPreview({ pricingMode: 'rate-only' });

    expect(screen.queryByRole('columnheader', { name: 'Amount' })).toBeNull();
    expect(screen.queryByText('Grand Total')).toBeNull();
  });

  it('shows both in amount mode', () => {
    renderPreview();

    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByText('Grand Total')).toBeInTheDocument();
  });
});

describe('page numbers (§26 UR-07)', () => {
  it('are absent by default, matching the approved document', () => {
    renderPreview();
    expect(screen.queryByText(/^Page 1 of 1$/)).toBeNull();
  });

  it('appear when enabled', () => {
    renderPreview({ showPageNumbers: true });
    expect(screen.getByText(/page 1 of 1/i, { selector: 'div' })).toBeInTheDocument();
  });
});

describe('security', () => {
  it('renders term text as text, never as markup', () => {
    renderPreview({
      terms: [{ title: 'TEST_ONLY XSS', body: '<img src=x onerror="alert(1)">' }],
    });

    // Escaped, so it reads as the literal characters and creates no element.
    expect(screen.getByRole('listitem')).toHaveTextContent('<img src=x onerror="alert(1)">');
    expect(document.querySelector('img[src="x"]')).toBeNull();
  });
});

describe('the toolbar (PRD §29)', () => {
  function renderToolbar(canExport = true) {
    render(
      <PreviewToolbar
        quotationNumber="SFC/RUH/QTN/2026/004"
        pageCount={2}
        canExport={canExport}
        onBack={() => undefined}
        onPrint={() => undefined}
        onSavePdf={() => undefined}
        isSavingPdf={false}
        onSaveWord={() => undefined}
        isSavingWord={false}
      />,
    );
  }

  it('offers Back to Edit and Print', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /back to edit/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /^print$/i })).toBeEnabled();
  });

  it('enables Save as PDF and Save as Word once the quotation is exportable', () => {
    renderToolbar();

    expect(screen.getByRole('button', { name: /save as pdf/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /save as word/i })).toBeEnabled();
  });

  it('shows the not-yet-built exports disabled, with the phase named', () => {
    renderToolbar();

    const button = screen.getByRole('button', { name: /save to google drive/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', expect.stringMatching(/phase/i));
  });

  it('explains the real blocker when the quotation is not exportable', () => {
    renderToolbar(false);

    for (const name of [/save as pdf/i, /save as word/i]) {
      const button = screen.getByRole('button', { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute(
        'title',
        expect.stringMatching(/resolve the items listed above/i),
      );
    }
  });

  it('reports the page count', () => {
    renderToolbar();
    expect(screen.getByText(/2 pages/)).toBeInTheDocument();
  });
});
