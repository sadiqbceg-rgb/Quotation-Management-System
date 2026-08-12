import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useLineItems } from './useLineItems';
import { halalas, milli } from '@shared/money';

describe('categories', () => {
  it('starts with none', () => {
    const { result } = renderHook(() => useLineItems());
    expect(result.current.categories).toEqual([]);
    expect(result.current.groups).toEqual([]);
  });

  it('adds a category with one blank row', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    expect(result.current.categories).toEqual(['Manpower']);
    expect(result.current.groups[0]?.items).toHaveLength(1);
  });

  it('does not add the same category twice', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });
    act(() => {
      result.current.addCategory('Manpower');
    });

    expect(result.current.categories).toEqual(['Manpower']);
    expect(result.current.items).toHaveLength(1);
  });

  it('supports several categories in one quotation (PRD §13)', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
      result.current.addCategory('Equipment');
      result.current.addCategory('Materials');
    });

    expect(result.current.categories).toEqual(['Manpower', 'Equipment', 'Materials']);
    expect(result.current.groups).toHaveLength(3);
  });

  it('removes a category and all of its rows', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
      result.current.addCategory('Equipment');
    });
    act(() => {
      result.current.removeCategory('Manpower');
    });

    expect(result.current.categories).toEqual(['Equipment']);
    expect(result.current.items.every((item) => item.category === 'Equipment')).toBe(true);
  });
});

describe('rows', () => {
  it('adds and removes rows', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });
    act(() => {
      result.current.addItem('Manpower');
    });
    expect(result.current.groups[0]?.items).toHaveLength(2);

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.removeItem(id);
    });
    expect(result.current.groups[0]?.items).toHaveLength(1);
  });

  it('keeps row ids stable across a reorder, so inputs do not remount', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });
    act(() => {
      result.current.addItem('Manpower');
    });

    const before = result.current.items.map((item) => item.id);

    act(() => {
      result.current.moveItem(before[0] ?? '', 1);
    });

    const after = result.current.items.map((item) => item.id);
    expect([...after].sort()).toEqual([...before].sort());
    expect(after[0]).toBe(before[1]);
  });

  it('does not move a row past the ends of its own table', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.moveItem(id, -1);
    });
    expect(result.current.items[0]?.id).toBe(id);
  });

  it('never moves a row into another category', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
      result.current.addCategory('Equipment');
    });

    const manpowerId = result.current.items.find((item) => item.category === 'Manpower')?.id ?? '';
    act(() => {
      result.current.moveItem(manpowerId, 1);
    });

    expect(result.current.items.find((item) => item.id === manpowerId)?.category).toBe('Manpower');
  });
});

describe('derived amount', () => {
  it('computes quantity x unit price on every change', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.updateItem(id, { quantity: milli(40_000), unitPrice: halalas(2000) });
    });

    // 40 x SAR 20.00 = SAR 800.00
    expect(result.current.items[0]?.amount).toBe(800_00);
  });

  it('recomputes when only the quantity changes', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Materials');
    });

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.updateItem(id, { quantity: milli(2000), unitPrice: halalas(1250) });
    });
    expect(result.current.items[0]?.amount).toBe(25_00);

    act(() => {
      result.current.updateItem(id, { quantity: milli(4000) });
    });
    expect(result.current.items[0]?.amount).toBe(50_00);
  });
});

describe('category subtotals and summary', () => {
  it('sums each category independently', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
      result.current.addCategory('Equipment');
    });

    const manpower = result.current.items.find((item) => item.category === 'Manpower')?.id ?? '';
    const equipment = result.current.items.find((item) => item.category === 'Equipment')?.id ?? '';

    act(() => {
      result.current.updateItem(manpower, { quantity: milli(40_000), unitPrice: halalas(2000) });
      result.current.updateItem(equipment, { quantity: milli(2000), unitPrice: halalas(50_000) });
    });

    const groups = result.current.groups;
    expect(groups.find((g) => g.category === 'Manpower')?.subtotal).toBe(800_00);
    expect(groups.find((g) => g.category === 'Equipment')?.subtotal).toBe(1000_00);
  });

  it('totals the quantities for the headcount line', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });
    act(() => {
      result.current.addItem('Manpower');
    });

    const ids = result.current.items.map((item) => item.id);
    act(() => {
      result.current.updateItem(ids[0] ?? '', { quantity: milli(40_000) });
      result.current.updateItem(ids[1] ?? '', { quantity: milli(1000) });
    });

    // The approved quotation's "Total Manpower: 41 Persons".
    expect(result.current.groups[0]?.quantityTotal).toBe(41_000);
  });
});

describe('conditional Remarks column (PRD §17)', () => {
  it('is hidden while no item has a remark', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    expect(result.current.showRemarksColumn).toBe(false);
  });

  it('appears as soon as one item has a remark', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.updateItem(id, { remarks: 'Night shift' });
    });

    expect(result.current.showRemarksColumn).toBe(true);
  });

  it('hides again when the last remark is cleared', () => {
    const { result } = renderHook(() => useLineItems());

    act(() => {
      result.current.addCategory('Manpower');
    });

    const id = result.current.items[0]?.id ?? '';
    act(() => {
      result.current.updateItem(id, { remarks: 'Night shift' });
    });
    act(() => {
      result.current.updateItem(id, { remarks: '   ' });
    });

    // Whitespace is not a remark.
    expect(result.current.showRemarksColumn).toBe(false);
  });
});
