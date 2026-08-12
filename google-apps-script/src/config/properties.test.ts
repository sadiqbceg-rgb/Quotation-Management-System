import { afterEach, describe, expect, it, vi } from 'vitest';

import { installGasFakes } from '../__fixtures__/gas-fakes';
import { companyVatNumber, missingProperties, quotationCodes } from './properties';
import { isValidSaudiVatNumber } from '@shared/validation-rules';

afterEach(() => {
  vi.unstubAllGlobals();
});

/* -------------------------------------------------------------------------- */

describe('quotation codes', () => {
  it('defaults to the codes on the approved quotation', () => {
    installGasFakes(vi.stubGlobal);

    expect(quotationCodes()).toEqual({ company: 'SFC', branch: 'RUH', documentType: 'QTN' });
  });

  it('takes an override, so a second branch needs no code change', () => {
    installGasFakes(vi.stubGlobal, { BRANCH_CODE: 'JED' });

    expect(quotationCodes().branch).toBe('JED');
  });
});

describe('the company VAT number', () => {
  it('is configured and well formed by default', () => {
    installGasFakes(vi.stubGlobal);

    expect(isValidSaudiVatNumber(companyVatNumber())).toBe(true);
  });

  it('takes a valid Script Property override', () => {
    installGasFakes(vi.stubGlobal, { COMPANY_VAT_NUMBER: '300000000000003' });

    expect(companyVatNumber()).toBe('300000000000003');
  });

  it('falls back when the property is blank', () => {
    installGasFakes(vi.stubGlobal);
    const configured = companyVatNumber();

    installGasFakes(vi.stubGlobal, { COMPANY_VAT_NUMBER: '   ' });
    expect(companyVatNumber()).toBe(configured);
  });

  it('ignores a malformed property, keeping the known-good value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installGasFakes(vi.stubGlobal, { COMPANY_VAT_NUMBER: '12345' });

    // A wrong VAT number on a client's quotation is a tax-compliance problem
    // for the company, so a typo in a Script Property must not reach a document.
    expect(isValidSaudiVatNumber(companyVatNumber())).toBe(true);
    expect(warn).toHaveBeenCalled();

    warn.mockRestore();
  });

  it('names the property in the warning but never the value (§19.7)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installGasFakes(vi.stubGlobal, { COMPANY_VAT_NUMBER: 'BAD-VALUE-9999' });

    companyVatNumber();
    const logged = warn.mock.calls.flat().join(' ');

    expect(logged).toContain('COMPANY_VAT_NUMBER');
    expect(logged).not.toContain('BAD-VALUE-9999');

    warn.mockRestore();
  });

  it('is optional — a deployment without it is still fully configured', () => {
    installGasFakes(vi.stubGlobal);

    expect(missingProperties()).toEqual([]);
  });
});
