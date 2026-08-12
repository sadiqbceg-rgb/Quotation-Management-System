/**
 * Item library actions.
 *
 * Role enforcement is declared in the action table in main.ts, not here (§19.2).
 */

import { ITEM_CATEGORIES, type ItemCategory } from '@shared/types';
import {
  PATTERNS,
  TEXT_LIMITS,
  isWithinLength,
  stripControlCharacters,
} from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import * as items from '../sheets/items-sheet';

function requireCaller(context: HandlerContext): Caller {
  if (context.caller === null) {
    throw new ApiError('AUTH_REQUIRED', 'Authentication is required.');
  }
  return context.caller;
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('VALIDATION_FAILED', 'Invalid request payload.');
  }
  return payload as Record<string, unknown>;
}

function readString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  return typeof value === 'string' ? stripControlCharacters(value).trim() : '';
}

export interface PublicCatalogItem {
  id: string;
  category: ItemCategory;
  name: string;
  defaultUnit: string;
  active: boolean;
}

function toPublic(record: items.CatalogItemRecord): PublicCatalogItem {
  return {
    id: record.id,
    category: record.category,
    name: record.name,
    defaultUnit: record.defaultUnit,
    active: record.active,
  };
}

export function list(payload: unknown, context: HandlerContext): PublicCatalogItem[] {
  requireCaller(context);
  const body = asRecord(payload);
  const includeInactive = body['includeInactive'] === true;

  return items.listItems(includeInactive).map(toPublic);
}

function validate(
  category: string,
  name: string,
  defaultUnit: string,
): { category: ItemCategory; name: string; defaultUnit: string } {
  const fields: Record<string, string> = {};

  if (!(ITEM_CATEGORIES as readonly string[]).includes(category)) {
    fields['category'] = 'Choose Manpower, Equipment or Materials.';
  }
  if (!isWithinLength(name, TEXT_LIMITS.itemDescription)) {
    fields['name'] = 'Name is required.';
  }
  if (!isWithinLength(defaultUnit, TEXT_LIMITS.unit) || !PATTERNS.customUnit.test(defaultUnit)) {
    fields['defaultUnit'] = 'Enter a short unit without symbols.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  return { category: category as ItemCategory, name, defaultUnit };
}

export function create(payload: unknown, context: HandlerContext): PublicCatalogItem {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const validated = validate(
    readString(body, 'category'),
    readString(body, 'name'),
    readString(body, 'defaultUnit'),
  );

  if (items.nameExists(validated.category, validated.name)) {
    throw new ApiError('VALIDATION_FAILED', 'That item already exists in this category.', {
      name: 'That item already exists in this category.',
    });
  }

  const created = items.createItem({ id: Utilities.getUuid(), ...validated });

  writeAudit({
    actor: caller.email,
    action: 'items.create',
    target: `${validated.category}:${validated.name}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(created);
}

export function update(payload: unknown, context: HandlerContext): PublicCatalogItem {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = items.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That item could not be found.');
  }

  const validated = validate(
    existing.category,
    readString(body, 'name'),
    readString(body, 'defaultUnit'),
  );

  if (items.nameExists(validated.category, validated.name, existing.id)) {
    throw new ApiError('VALIDATION_FAILED', 'That item already exists in this category.', {
      name: 'That item already exists in this category.',
    });
  }

  items.updateItem(existing, validated.name, validated.defaultUnit);

  writeAudit({
    actor: caller.email,
    action: 'items.update',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { ...toPublic(existing), name: validated.name, defaultUnit: validated.defaultUnit };
}

export function deactivate(payload: unknown, context: HandlerContext): { id: string } {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = items.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That item could not be found.');
  }

  const active = body['active'] === true;
  items.setActive(existing, active);

  writeAudit({
    actor: caller.email,
    action: active ? 'items.activate' : 'items.deactivate',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { id: existing.id };
}
