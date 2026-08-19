/**
 * Customer library actions.
 *
 * Role enforcement is declared in the action table in main.ts, not here (§19.2).
 *
 * ---------------------------------------------------------------------------
 * THIS LIBRARY NEVER REACHES BACK INTO A QUOTATION
 * ---------------------------------------------------------------------------
 * Nothing here reads, writes or references a quotation. Selecting a customer
 * prefills the form; the quotation then stores those VALUES. No quotation holds
 * a customer id, so editing or deactivating a customer cannot alter a quotation
 * that already exists — not by policy, but because there is no link to follow.
 */

import { PATTERNS, TEXT_LIMITS, isWithinLength, stripControlCharacters } from '@shared/validation-rules';
import { writeAudit } from '../audit/audit-log';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import * as clients from '../sheets/clients-sheet';

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

/**
 * A customer as the client sees it.
 *
 * The shape deliberately mirrors `ClientInfo` (shared/types.ts) field for field,
 * so the picker can hand it straight to the quotation form without a mapping
 * layer that could drift.
 */
export interface PublicClient {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  active: boolean;
}

function toPublic(record: clients.ClientRecordRow): PublicClient {
  return {
    id: record.id,
    clientName: record.clientName,
    companyName: record.companyName,
    address: record.address,
    contactPerson: record.contactPerson,
    email: record.email,
    phone: record.phone,
    active: record.active,
  };
}

export function list(payload: unknown, context: HandlerContext): PublicClient[] {
  requireCaller(context);
  const body = asRecord(payload);
  const includeInactive = body['includeInactive'] === true;

  return clients.listClients(includeInactive).map(toPublic);
}

interface ValidatedClient {
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
}

/**
 * The same rules the quotation applies to the same fields.
 *
 * Taken from `TEXT_LIMITS` and `PATTERNS` rather than restated, so a customer
 * that saves here cannot fail validation later when it reaches a quotation —
 * which would be a library that hands you records you cannot use.
 */
function validate(body: Record<string, unknown>): ValidatedClient {
  const clientName = readString(body, 'clientName');
  const companyName = readString(body, 'companyName');
  const address = readString(body, 'address');
  const contactPerson = readString(body, 'contactPerson');
  const email = readString(body, 'email');
  const phone = readString(body, 'phone');

  const fields: Record<string, string> = {};

  if (!isWithinLength(clientName, TEXT_LIMITS.clientName)) {
    fields['clientName'] = 'Client name is required.';
  }
  if (!isWithinLength(companyName, TEXT_LIMITS.companyName)) {
    fields['companyName'] = 'Company name is required.';
  }
  if (!isWithinLength(address, TEXT_LIMITS.address)) {
    fields['address'] = 'Address is required.';
  }
  // The three below are optional on a quotation, so they are optional here —
  // but an entered value still has to be a usable one.
  if (contactPerson.length > TEXT_LIMITS.contactPerson.max) {
    fields['contactPerson'] = 'Contact person is too long.';
  }
  if (email.length > 0 && !PATTERNS.email.test(email)) {
    fields['email'] = 'Enter a valid email address.';
  }
  if (phone.length > 0 && !PATTERNS.phone.test(phone)) {
    fields['phone'] = 'Enter a valid phone number.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  return { clientName, companyName, address, contactPerson, email, phone };
}

export function create(payload: unknown, context: HandlerContext): PublicClient {
  const caller = requireCaller(context);
  const body = asRecord(payload);
  const validated = validate(body);

  if (clients.nameExists(validated.clientName, validated.companyName)) {
    throw new ApiError('VALIDATION_FAILED', 'That customer already exists.', {
      clientName: 'That customer already exists.',
    });
  }

  const created = clients.createClient({ id: Utilities.getUuid(), ...validated });

  writeAudit({
    actor: caller.email,
    action: 'clients.create',
    // The id, not the record: an audit log holding a full copy of every client
    // is a second database of client data to protect (§19.7).
    target: created.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(created);
}

export function update(payload: unknown, context: HandlerContext): PublicClient {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = clients.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That customer could not be found.');
  }

  const validated = validate(body);

  if (clients.nameExists(validated.clientName, validated.companyName, existing.id)) {
    throw new ApiError('VALIDATION_FAILED', 'That customer already exists.', {
      clientName: 'That customer already exists.',
    });
  }

  clients.updateClient(existing, validated);

  writeAudit({
    actor: caller.email,
    action: 'clients.update',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { ...toPublic(existing), ...validated };
}

/**
 * Activate or deactivate. Never delete.
 *
 * One action name for both directions, with the resulting state in the audit
 * target — the alternative, an `clients.activate` name that appears in the log
 * but not in `AUDITED_ACTIONS`, is a classification the security suite cannot
 * check.
 */
export function deactivate(payload: unknown, context: HandlerContext): PublicClient {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = clients.findById(readString(body, 'id'));
  if (existing === null) {
    throw new ApiError('VALIDATION_FAILED', 'That customer could not be found.');
  }

  const active = body['active'] === true;
  if (existing.active !== active) {
    clients.setActive(existing, active);
  }

  writeAudit({
    actor: caller.email,
    action: 'clients.deactivate',
    target: `${existing.id} ${active ? 'active' : 'inactive'}`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return { ...toPublic(existing), active };
}
