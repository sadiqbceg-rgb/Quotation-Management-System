/**
 * Authorized Persons actions.
 *
 * Role enforcement is declared in the action table in main.ts, not here (§19.2).
 * `persons.list` and `persons.getSignature` are `authenticated`; everything
 * that writes is `Admin`.
 *
 * Note what `list` does NOT return: signature bytes, and the Drive folder path.
 * The list is fetched to populate a dropdown, so shipping every signatory's
 * image with it would push private binaries to every user on every page load.
 * The image comes separately, one person at a time, from `getSignature`.
 */

import { writeAudit } from '../audit/audit-log';
import { ApiError, type Caller, type HandlerContext } from '../errors';
import { readSignature, storeSignature } from '../drive/signature-storage';
import * as persons from '../sheets/persons-sheet';
import * as records from '../sheets/quotation-records-sheet';
import { validatePerson } from '../validation/person-validator';
import { validateSignatureUpload } from '../validation/image-validator';

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

function readId(payload: Record<string, unknown>): string {
  const value = payload['id'];
  const id = typeof value === 'string' ? value.trim() : '';
  if (id.length === 0 || id.length > 64) {
    throw new ApiError('VALIDATION_FAILED', 'An authorized person is required.');
  }
  return id;
}

function requirePerson(id: string): persons.PersonRecord {
  const found = persons.findById(id);
  if (found === null) {
    throw new ApiError('VALIDATION_FAILED', 'That authorized person could not be found.');
  }
  return found;
}

/** The text fields, plus whether a signature exists — never the bytes. */
export interface PublicPerson {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  /** Whether a signature has been uploaded. The file id itself stays server-side. */
  hasSignature: boolean;
  /**
   * PRD §24: a person without a signature is LISTED but not selectable, with
   * the reason shown. Computing it here keeps the rule in one place.
   */
  selectable: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

function toPublic(record: persons.PersonRecord): PublicPerson {
  const hasSignature = record.signatureFileId.length > 0;

  return {
    id: record.id,
    name: record.name,
    designation: record.designation,
    companyName: record.companyName,
    country: record.country,
    email: record.email,
    phone: record.phone,
    hasSignature,
    selectable: record.active && hasSignature,
    active: record.active,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* Read                                                                       */
/* -------------------------------------------------------------------------- */

export function list(payload: unknown, context: HandlerContext): PublicPerson[] {
  requireCaller(context);
  const body = asRecord(payload);
  const includeInactive = body['includeInactive'] === true;

  return persons.listPersons(includeInactive).map(toPublic);
}

export interface SignatureResponse {
  id: string;
  /** Bare base64 PNG. Never a URL — there is no public URL anywhere (§11.2). */
  signature: string;
}

/**
 * Fetch one signature image.
 *
 * Authenticated, and any signed-in user may call it: the signature appears on
 * the quotation they are producing, so a User who can create a quotation can
 * necessarily see the mark that will be printed on it. What matters is that
 * this is the ONLY route out of Drive, and it requires a session.
 */
export function getSignature(payload: unknown, context: HandlerContext): SignatureResponse {
  requireCaller(context);
  const person = requirePerson(readId(asRecord(payload)));

  if (person.signatureFileId.length === 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `${person.name} does not have a signature image yet. An administrator must upload one first.`,
    );
  }

  const signature = readSignature(person.signatureFileId);
  if (signature === null) {
    // Specific, not generic: the record points at a file Drive will not return,
    // and an Admin needs to know that rather than see "something went wrong".
    throw new ApiError(
      'DRIVE_UPLOAD_FAILED',
      `The signature image for ${person.name} could not be read from Google Drive. It may need to be uploaded again.`,
    );
  }

  return { id: person.id, signature };
}

/* -------------------------------------------------------------------------- */
/* Write — Admin only                                                         */
/* -------------------------------------------------------------------------- */

export function create(payload: unknown, context: HandlerContext): PublicPerson {
  const caller = requireCaller(context);
  const validated = validatePerson(payload);

  if (persons.personExists(validated.name, validated.designation)) {
    throw new ApiError('VALIDATION_FAILED', 'That person is already in the library.', {
      name: 'This name and designation already exist.',
    });
  }

  const created = persons.createPerson({ id: Utilities.getUuid(), ...validated });

  writeAudit({
    actor: caller.email,
    action: 'persons.create',
    // The id, not the person's name, email or phone — an audit row does not
    // need to restate personal contact details to be useful.
    target: created.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(created);
}

export function update(payload: unknown, context: HandlerContext): PublicPerson {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = requirePerson(readId(body));
  const validated = validatePerson(body);

  if (persons.personExists(validated.name, validated.designation, existing.id)) {
    throw new ApiError('VALIDATION_FAILED', 'That person is already in the library.', {
      name: 'This name and designation already exist.',
    });
  }

  const updated = persons.updatePerson(existing, validated);

  writeAudit({
    actor: caller.email,
    action: 'persons.update',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(updated);
}

/**
 * Deactivate or reactivate.
 *
 * Deactivation is refused while the person is the signatory on a draft that has
 * not been issued: the user would otherwise return to their quotation to find
 * the signature block empty and no explanation. Issued quotations are never a
 * blocker — they hold a snapshot and are unaffected.
 */
export function deactivate(payload: unknown, context: HandlerContext): PublicPerson {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = requirePerson(readId(body));
  const active = body['active'] === true;

  if (!active) {
    const blocking = draftsUsingPerson(existing.id);
    if (blocking.length > 0) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `${existing.name} is the authorized person on ${blocking.length === 1 ? 'a draft quotation' : `${String(blocking.length)} draft quotations`} that ${blocking.length === 1 ? 'has' : 'have'} not been issued yet (${blocking.join(', ')}). Change the signatory there first.`,
        { active: 'This person is in use on an unissued draft.' },
      );
    }
  }

  const updated = persons.setActive(existing, active);

  writeAudit({
    actor: caller.email,
    action: active ? 'persons.activate' : 'persons.deactivate',
    target: existing.id,
    outcome: 'success',
    requestId: context.requestId,
  });

  return toPublic(updated);
}

interface StoredQuotationPerson {
  authorizedPerson?: { id?: unknown } | null;
}

/** Draft ids of unissued quotations whose signatory is this person. */
function draftsUsingPerson(personId: string): string[] {
  const blocking: string[] = [];

  for (const record of records.listAll()) {
    // An issued quotation carries a number and a snapshot; it is finished, and
    // deactivating its signatory changes nothing about it.
    if (record.quotationNumber.length > 0) continue;

    let parsed: StoredQuotationPerson;
    try {
      // Every field of StoredQuotationPerson is optional and re-checked below,
      // so the narrowing here is the whole guarantee the shape needs.
      const value: unknown = JSON.parse(record.payload);
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue;
      parsed = value;
    } catch {
      continue;
    }

    if (parsed.authorizedPerson?.id === personId) blocking.push(record.draftId);
  }

  return blocking;
}

export interface UploadSignatureResponse {
  id: string;
  hasSignature: true;
  /** Non-fatal notes — a missing alpha channel, a low resolution. */
  warnings: string[];
  width: number;
  height: number;
}

/**
 * Upload a signature image. Admin only.
 *
 * Order matters: validate, then write to Drive, then update the sheet. A
 * failure at any step leaves no record pointing at a file that does not exist,
 * which is the one inconsistency that would be invisible until a document
 * failed to render months later.
 */
export function uploadSignature(
  payload: unknown,
  context: HandlerContext,
): UploadSignatureResponse {
  const caller = requireCaller(context);
  const body = asRecord(payload);

  const existing = requirePerson(readId(body));
  const validated = validateSignatureUpload(body['signature'], body['filename']);

  // A NEW Drive file every time, so a quotation issued against the previous
  // signature still resolves to the image it was signed with.
  const stored = storeSignature(existing.id, validated.bytes, validated.filename);
  persons.setSignatureFileId(existing, stored.fileId);

  writeAudit({
    actor: caller.email,
    action: 'persons.uploadSignature',
    target: `${existing.id}:${String(stored.byteLength)}b`,
    outcome: 'success',
    requestId: context.requestId,
  });

  return {
    id: existing.id,
    hasSignature: true,
    warnings: validated.warnings,
    width: validated.header.width,
    height: validated.header.height,
  };
}

/** Look up a stored person for the quotation validator. */
export function lookupForSnapshot(id: string): {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  signatureFileId: string;
} | null {
  const found = persons.findById(id);
  if (found === null) return null;

  return {
    id: found.id,
    name: found.name,
    designation: found.designation,
    companyName: found.companyName,
    country: found.country,
    email: found.email,
    phone: found.phone,
    signatureFileId: found.signatureFileId,
  };
}
