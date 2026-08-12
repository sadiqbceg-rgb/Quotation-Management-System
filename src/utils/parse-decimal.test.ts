import { describe, expect, it } from 'vitest';
import { parsePrice, parseQuantity } from './parse-decimal';

describe('parseQuantity', () => {
  it('converts whole and fractional quantities to thousandths', () => {
    expect(parseQuantity('40')).toEqual({ ok: true, value: 40_000 });
    expect(parseQuantity('1.5')).toEqual({ ok: true, value: 1500 });
    expect(parseQuantity('0.125')).toEqual({ ok: true, value: 125 });
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseQuantity('  40  ')).toEqual({ ok: true, value: 40_000 });
  });

  it('reports an empty value distinctly, so a blank row is not an error yet', () => {
    expect(parseQuantity('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseQuantity('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('rejects a zero or negative quantity (PRD §36)', () => {
    expect(parseQuantity('0')).toEqual({ ok: false, reason: 'out-of-range' });
    // A leading minus is not even numeric input here, so it never reaches range.
    expect(parseQuantity('-5').ok).toBe(false);
  });

  it('rejects non-numeric text', () => {
    expect(parseQuantity('abc')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseQuantity('1e5')).toEqual({ ok: false, reason: 'not-a-number' });
    expect(parseQuantity('1,000')).toEqual({ ok: false, reason: 'not-a-number' });
  });

  it('rejects more than three decimal places', () => {
    expect(parseQuantity('1.2345')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('rejects a quantity above the ceiling', () => {
    expect(parseQuantity('1000001')).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('treats a trailing separator as incomplete rather than invalid', () => {
    // "1." is what the field holds mid-keystroke; it parses to 1.
    expect(parseQuantity('1.')).toEqual({ ok: true, value: 1000 });
  });
});

describe('parsePrice', () => {
  it('converts SAR to halalas', () => {
    expect(parsePrice('20')).toEqual({ ok: true, value: 2000 });
    expect(parsePrice('20.00')).toEqual({ ok: true, value: 2000 });
    expect(parsePrice('2500.50')).toEqual({ ok: true, value: 250_050 });
    expect(parsePrice('0.01')).toEqual({ ok: true, value: 1 });
  });

  it('allows zero, unlike quantity', () => {
    expect(parsePrice('0')).toEqual({ ok: true, value: 0 });
  });

  it('rejects more than two decimal places', () => {
    expect(parsePrice('20.005')).toEqual({ ok: false, reason: 'too-many-decimals' });
  });

  it('rejects a price above the ceiling', () => {
    expect(parsePrice('1000001')).toEqual({ ok: false, reason: 'out-of-range' });
  });

  it('rejects non-numeric text', () => {
    expect(parsePrice('SAR 20')).toEqual({ ok: false, reason: 'not-a-number' });
  });
});
