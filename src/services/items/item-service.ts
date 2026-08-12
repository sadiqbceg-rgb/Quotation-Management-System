/**
 * Item library actions, over the shared API client.
 */

import { callAction } from '@/services/api/client';
import type { ItemCategory } from '@shared/types';

export interface CatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  defaultUnit: string;
  active: boolean;
}

export async function listItems(token: string, includeInactive = false): Promise<CatalogItem[]> {
  return callAction<{ includeInactive: boolean }, CatalogItem[]>(
    'items.list',
    { includeInactive },
    { token },
  );
}

export interface CreateItemInput {
  category: ItemCategory;
  name: string;
  defaultUnit: string;
}

export async function createItem(input: CreateItemInput, token: string): Promise<CatalogItem> {
  return callAction<CreateItemInput, CatalogItem>('items.create', input, { token });
}

export async function updateItem(
  input: { id: string; name: string; defaultUnit: string },
  token: string,
): Promise<CatalogItem> {
  return callAction<typeof input, CatalogItem>('items.update', input, { token });
}

export async function setItemActive(
  id: string,
  active: boolean,
  token: string,
): Promise<{ id: string }> {
  return callAction<{ id: string; active: boolean }, { id: string }>(
    'items.deactivate',
    { id, active },
    { token },
  );
}
