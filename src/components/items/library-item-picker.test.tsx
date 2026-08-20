/**
 * The item library, wired into a quotation row (W-5).
 *
 * The library existed and the Items page promised that "selecting one later
 * prefills a row's description and unit" — but nothing consumed it, so staff
 * maintained a catalogue that did nothing.
 *
 * The property that matters most here is what does NOT travel: no item id
 * reaches the quotation. That is what keeps a later edit to the library from
 * changing a quotation already issued, and what stops a client injecting an id
 * to bypass validation.
 */

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LibraryItemPicker } from '@/components/items/LibraryItemPicker';
import * as itemService from '@/services/items/item-service';
import type { CatalogItem } from '@/services/items/item-service';
import { renderWithProviders, TEST_ONLY_USER } from '@/__fixtures__/test-render';

function item(overrides: Partial<CatalogItem> = {}): CatalogItem {
  return {
    id: 'item-1',
    category: 'Manpower',
    name: 'TEST_ONLY Technician',
    defaultUnit: 'Hour',
    active: true,
    ...overrides,
  };
}

function renderPicker(onSelect = vi.fn()) {
  renderWithProviders(
    <LibraryItemPicker category="Manpower" rowLabel="Designation 1" onSelect={onSelect} />,
    { user: TEST_ONLY_USER },
  );
  return onSelect;
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(itemService, 'listItems').mockResolvedValue([
    item(),
    item({ id: 'item-2', name: 'TEST_ONLY Excavator', category: 'Equipment', defaultUnit: 'Day' }),
  ]);
});

/* -------------------------------------------------------------------------- */

describe('opening the picker', () => {
  it('fetches nothing until it is opened', () => {
    const list = vi.spyOn(itemService, 'listItems');
    renderPicker();

    // PRD §35: opening New Quotation must not do work of its own.
    expect(list).not.toHaveBeenCalled();
  });

  it('asks for ACTIVE items only', async () => {
    const list = vi.spyOn(itemService, 'listItems').mockResolvedValue([item()]);
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await screen.findByText('TEST_ONLY Technician');

    // No includeInactive argument: a deactivated item is never offered.
    expect(list).toHaveBeenCalledWith(expect.any(String));
  });
});

describe('choosing an item', () => {
  it('hands back the description and the unit', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker(onSelect);

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await user.click(await screen.findByRole('button', { name: /TEST_ONLY Technician/i }));

    expect(onSelect).toHaveBeenCalledWith({
      description: 'TEST_ONLY Technician',
      unit: 'Hour',
    });
  });

  it('passes NO item id, so the quotation keeps no reference', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker(onSelect);

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await user.click(await screen.findByRole('button', { name: /TEST_ONLY Technician/i }));

    /*
     * The whole snapshot guarantee rests on this. If an id travelled, a later
     * edit to the library item could reach an issued quotation, and a client
     * could send an id the server would have to trust.
     */
    const [choice] = onSelect.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(choice).sort()).toEqual(['description', 'unit']);
    expect(JSON.stringify(choice)).not.toContain('item-1');
  });

  it('passes no quantity or price — those are always per quotation', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    renderPicker(onSelect);

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await user.click(await screen.findByRole('button', { name: /TEST_ONLY Technician/i }));

    const [choice] = onSelect.mock.calls[0] as [Record<string, unknown>];
    expect(choice['quantity']).toBeUndefined();
    expect(choice['unitPrice']).toBeUndefined();
  });
});

describe('scoping and search', () => {
  it('offers only this row\'s category', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await screen.findByText('TEST_ONLY Technician');

    // The Equipment item exists in the library but not in a Manpower row.
    expect(screen.queryByText('TEST_ONLY Excavator')).not.toBeInTheDocument();
  });

  it('filters by name', async () => {
    vi.spyOn(itemService, 'listItems').mockResolvedValue([
      item(),
      item({ id: 'item-3', name: 'TEST_ONLY Foreman' }),
    ]);
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));
    await screen.findByText('TEST_ONLY Technician');
    await user.type(screen.getByLabelText(/search items/i), 'Foreman');

    expect(screen.getByText('TEST_ONLY Foreman')).toBeInTheDocument();
    expect(screen.queryByText('TEST_ONLY Technician')).not.toBeInTheDocument();
  });

  it('points at manual entry when the library is empty', async () => {
    vi.spyOn(itemService, 'listItems').mockResolvedValue([]);
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));

    // Manual entry must stay the fallback, never be replaced by the library.
    expect(await screen.findByText(/just type the description below/i)).toBeInTheDocument();
  });

  it('says the row stays editable and that price is per quotation', async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole('button', { name: /choose a library item/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/stay editable. Quantity and price are always entered per quotation/i),
      ).toBeInTheDocument();
    });
  });
});
