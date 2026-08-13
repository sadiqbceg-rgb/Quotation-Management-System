import { describe, expect, it } from 'vitest';

import { canExport, validateForExport, type ExportValidationInput } from './export-validation';
import { emptyTokenContext } from '@shared/term-tokens';

function input(overrides: Partial<ExportValidationInput> = {}): ExportValidationInput {
  return {
    quotationFor: 'TEST_ONLY Manpower Supply',
    client: {
      clientName: 'TEST_ONLY Contact',
      companyName: 'TEST_ONLY Client Co.',
      address: 'TEST_ONLY Address, Riyadh',
    },
    lines: [
      { description: 'TEST_ONLY General Labour', quantity: 40_000, unit: 'Hour', unitPrice: 2000 },
    ],
    terms: [{ title: 'TEST_ONLY Working Hours', body: 'TEST_ONLY minimum hours per day.' }],
    closingParagraph: 'TEST_ONLY thank you.',
    signatory: { name: 'TEST_ONLY_Signatory' },
    signatureLoaded: true,
    sealLoaded: true,
    tokenContext: { ...emptyTokenContext(), companyName: 'TEST_ONLY Co.' },
    ...overrides,
  };
}

function codes(overrides: Partial<ExportValidationInput> = {}): string[] {
  return validateForExport(input(overrides)).map((blocker) => blocker.code);
}

/* -------------------------------------------------------------------------- */

describe('a complete quotation', () => {
  it('has nothing blocking export', () => {
    const blockers = validateForExport(input());

    expect(blockers).toEqual([]);
    expect(canExport(blockers)).toBe(true);
  });
});

describe('required fields', () => {
  it('blocks a missing Quotation For', () => {
    expect(codes({ quotationFor: '' })).toContain('QUOTATION_FOR');
  });

  it('blocks each missing client field separately', () => {
    const result = codes({ client: { clientName: '', companyName: '', address: '' } });

    expect(result).toContain('CLIENT_NAME');
    expect(result).toContain('CLIENT_COMPANY');
    expect(result).toContain('CLIENT_ADDRESS');
  });

  it('blocks a quotation with no items', () => {
    expect(codes({ lines: [] })).toContain('NO_ITEMS');
  });

  it('blocks an item with no description', () => {
    expect(
      codes({ lines: [{ description: '  ', quantity: 1000, unit: 'Hour', unitPrice: 100 }] }),
    ).toContain('INVALID_ITEM');
  });

  it('blocks an item with a zero quantity', () => {
    expect(
      codes({ lines: [{ description: 'TEST_ONLY x', quantity: 0, unit: 'Hour', unitPrice: 100 }] }),
    ).toContain('INVALID_ITEM');
  });

  it('blocks a missing closing paragraph', () => {
    expect(codes({ closingParagraph: '   ' })).toContain('CLOSING_PARAGRAPH');
  });
});

describe('the signatory', () => {
  it('blocks when nobody is selected', () => {
    expect(codes({ signatory: null })).toContain('NO_SIGNATORY');
  });

  it('blocks when the signature image did not load', () => {
    // Phase 06 showed this in the editor; at export it stops the document.
    expect(codes({ signatureLoaded: false })).toContain('NO_SIGNATURE_IMAGE');
  });

  it('names the person in the message, so it is actionable', () => {
    const blockers = validateForExport(input({ signatureLoaded: false }));
    const blocker = blockers.find((entry) => entry.code === 'NO_SIGNATURE_IMAGE');

    expect(blocker?.message).toContain('TEST_ONLY_Signatory');
  });

  it('does not also complain about a signature when nobody is selected', () => {
    const result = codes({ signatory: null, signatureLoaded: false });
    expect(result).not.toContain('NO_SIGNATURE_IMAGE');
  });
});

describe('unresolved tokens escalate at export', () => {
  it('blocks a term still containing a placeholder', () => {
    // Phase 05 showed "{{rate}}" as a warning while editing. Printed on a
    // client's quotation it is a gap where a price belongs.
    expect(
      codes({
        terms: [{ title: 'TEST_ONLY Manpower Rate', body: 'The rate is {{rate}} per hour.' }],
      }),
    ).toContain('UNRESOLVED_TOKEN');
  });

  it('blocks a whitelisted token the context cannot fill', () => {
    expect(
      codes({
        terms: [{ title: 'TEST_ONLY VAT', body: 'VAT No. {{company.vatNumber}}' }],
        tokenContext: emptyTokenContext(),
      }),
    ).toContain('UNRESOLVED_TOKEN');
  });

  it('names the term so the user knows which to fix', () => {
    const blockers = validateForExport(
      input({ terms: [{ title: 'TEST_ONLY Manpower Rate', body: '{{rate}}' }] }),
    );

    expect(blockers.find((b) => b.code === 'UNRESOLVED_TOKEN')?.message).toContain(
      'TEST_ONLY Manpower Rate',
    );
  });

  it('allows a term whose tokens all resolve', () => {
    expect(
      codes({
        terms: [{ title: 'TEST_ONLY Food', body: 'Provided by TEST_ONLY Co.' }],
      }),
    ).not.toContain('UNRESOLVED_TOKEN');
  });
});

describe('assets', () => {
  it('blocks when the seal failed to load', () => {
    expect(codes({ sealLoaded: false })).toContain('SEAL_ASSET');
  });
});

describe('the blocker list', () => {
  it('reports every problem at once, not just the first', () => {
    const blockers = validateForExport(
      input({
        quotationFor: '',
        client: { clientName: '', companyName: '', address: '' },
        lines: [],
        closingParagraph: '',
        signatory: null,
        sealLoaded: false,
      }),
    );

    // A user fixing one thing per round trip across four sections is a worse
    // experience than a single list they can work through.
    expect(blockers.length).toBeGreaterThanOrEqual(7);
    expect(canExport(blockers)).toBe(false);
  });

  it('tags each blocker with the section to go and fix', () => {
    const blockers = validateForExport(input({ quotationFor: '', lines: [], signatory: null }));
    const sections = new Set(blockers.map((blocker) => blocker.section));

    expect(sections).toContain('Quotation');
    expect(sections).toContain('Items');
    expect(sections).toContain('Authorized Person');
  });
});
