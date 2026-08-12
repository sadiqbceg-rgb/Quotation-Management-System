import { describe, expect, it } from 'vitest';

import {
  TERM_TOKEN_NAMES,
  emptyTokenContext,
  findUnresolvedTokens,
  hasUnresolvedTokens,
  resolveTermTokens,
  type TermTokenContext,
} from './term-tokens';

function context(overrides: Partial<TermTokenContext> = {}): TermTokenContext {
  return {
    companyName: 'Speed Falcon Company',
    companyVatNumber: '300000000000003',
    clientCompanyName: 'TEST_ONLY Client Co.',
    clientName: 'TEST_ONLY Client Name',
    quotationNumber: 'SFC/RUH/QTN/2026/004',
    quotationDate: '11-08-2026',
    validityDays: '7',
    vatRate: '15%',
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe('the whitelist', () => {
  it('resolves every token it publishes', () => {
    const ctx = context();

    for (const name of TERM_TOKEN_NAMES) {
      const result = resolveTermTokens(`before {{${name}}} after`, ctx);

      expect(result.unknownTokens, name).toEqual([]);
      expect(result.emptyTokens, name).toEqual([]);
      expect(result.text, name).not.toContain('{{');
    }
  });

  it('resolves several tokens in one body', () => {
    const result = resolveTermTokens(
      '{{totals.vatRate}} VAT applies to {{client.companyName}} under {{quotation.number}}.',
      context(),
    );

    expect(result.text).toBe(
      '15% VAT applies to TEST_ONLY Client Co. under SFC/RUH/QTN/2026/004.',
    );
  });

  it('resolves repeated occurrences of the same token', () => {
    const result = resolveTermTokens('{{company.name}} and {{company.name}}', context());
    expect(result.text).toBe('Speed Falcon Company and Speed Falcon Company');
  });

  it('leaves a body with no tokens untouched', () => {
    const body = 'Minimum 10 hours per day, 6 days per week.';
    expect(resolveTermTokens(body, context()).text).toBe(body);
  });
});

describe('unknown tokens', () => {
  it('preserves them verbatim rather than blanking them', () => {
    // The real case: the company's own {SAR  } placeholder, which a human must
    // replace with per-category rates. A blank here would ship a price gap.
    const result = resolveTermTokens('The agreed manpower rate is {{rate}} per hour.', context());

    expect(result.text).toBe('The agreed manpower rate is {{rate}} per hour.');
    expect(result.unknownTokens).toEqual(['rate']);
  });

  it('reports each unknown token once', () => {
    const result = resolveTermTokens('{{rate}} then {{rate}} then {{other}}', context());
    expect(result.unknownTokens).toEqual(['rate', 'other']);
  });

  it('flags a body as needing attention', () => {
    expect(hasUnresolvedTokens('{{rate}}', context())).toBe(true);
    expect(hasUnresolvedTokens('{{company.name}}', context())).toBe(false);
  });
});

describe('empty context values', () => {
  it('leaves a whitelisted token verbatim when there is no value yet', () => {
    const result = resolveTermTokens('VAT No. {{company.vatNumber}}', context({ companyVatNumber: '' }));

    expect(result.text).toBe('VAT No. {{company.vatNumber}}');
    expect(result.emptyTokens).toEqual(['company.vatNumber']);
    expect(result.unknownTokens).toEqual([]);
  });

  it('reports every token as unresolved against an empty context', () => {
    const body = TERM_TOKEN_NAMES.map((name) => `{{${name}}}`).join(' ');
    const unresolved = findUnresolvedTokens(body, emptyTokenContext());

    expect(unresolved.sort()).toEqual([...TERM_TOKEN_NAMES].sort());
  });
});

describe('no code execution (§10.2)', () => {
  it('does not reach the prototype chain', () => {
    for (const attempt of [
      '{{constructor}}',
      '{{__proto__}}',
      '{{toString}}',
      '{{hasOwnProperty}}',
      '{{valueOf}}',
    ]) {
      const result = resolveTermTokens(attempt, context());

      expect(result.text, attempt).toBe(attempt);
      expect(result.unknownTokens, attempt).toHaveLength(1);
    }
  });

  it('treats a dotted prototype walk as one unknown name, not a path', () => {
    const result = resolveTermTokens('{{constructor.prototype}}', context());

    expect(result.text).toBe('{{constructor.prototype}}');
    expect(result.unknownTokens).toEqual(['constructor.prototype']);
  });

  it('does not evaluate an expression', () => {
    const result = resolveTermTokens('{{1+1}} {{alert(1)}}', context());

    // Neither matches the token pattern's character set, so both survive whole.
    expect(result.text).toBe('{{1+1}} {{alert(1)}}');
    expect(result.unknownTokens).toEqual([]);
  });

  it('ignores single-brace text, which is what the source document contains', () => {
    const result = resolveTermTokens('{company} and {SAR  }', context());
    expect(result.text).toBe('{company} and {SAR  }');
  });

  it('caps the token name length so the pattern cannot run away', () => {
    const long = 'a'.repeat(41);
    const result = resolveTermTokens(`{{${long}}}`, context());

    expect(result.text).toBe(`{{${long}}}`);
    expect(result.unknownTokens).toEqual([]);
  });
});

describe('resolved values are inert', () => {
  it('does not re-scan a substituted value for tokens', () => {
    // A client name that itself looks like a token must not become a second
    // substitution pass — that is how a lookup turns into an expansion bomb.
    const result = resolveTermTokens(
      '{{client.companyName}}',
      context({ clientCompanyName: '{{company.name}}' }),
    );

    expect(result.text).toBe('{{company.name}}');
  });
});
