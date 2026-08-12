/**
 * Authorized person validation.
 *
 * See PRD §24 and IMPLEMENTATION_PLAN.md §11.
 *
 * Every field is required. Unlike a client record, where a missing phone is
 * merely untidy, each of these six lines is PRINTED in the signature block of
 * the finished quotation — an absent one leaves a visible gap in a document
 * that has already gone out.
 */

import {
  PATTERNS,
  TEXT_LIMITS,
  isWithinLength,
  stripControlCharacters,
} from '@shared/validation-rules';
import { ApiError } from '../errors';

export interface ValidatedPerson {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
}

type Fields = Record<string, string>;

function text(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? stripControlCharacters(value).trim() : '';
}

function asRecord(payload: unknown, label: string): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new ApiError('VALIDATION_FAILED', `${label} is missing or malformed.`);
  }
  return payload as Record<string, unknown>;
}

export function validatePerson(payload: unknown): ValidatedPerson {
  const source = asRecord(payload, 'Authorized person');
  const fields: Fields = {};

  const name = text(source, 'name');
  const designation = text(source, 'designation');
  const companyName = text(source, 'companyName');
  const country = text(source, 'country');
  const email = text(source, 'email');
  const phone = text(source, 'phone');

  if (!isWithinLength(name, TEXT_LIMITS.personName)) {
    fields['name'] = `Name must be ${String(TEXT_LIMITS.personName.min)}-${String(TEXT_LIMITS.personName.max)} characters.`;
  }
  if (!isWithinLength(designation, TEXT_LIMITS.personDesignation)) {
    fields['designation'] =
      `Designation must be ${String(TEXT_LIMITS.personDesignation.min)}-${String(TEXT_LIMITS.personDesignation.max)} characters.`;
  }
  if (!isWithinLength(companyName, TEXT_LIMITS.companyName)) {
    fields['companyName'] = 'Company name is required.';
  }
  if (!isWithinLength(country, TEXT_LIMITS.personCountry)) {
    fields['country'] = 'Country is required.';
  }
  if (!isWithinLength(email, TEXT_LIMITS.email) || !PATTERNS.email.test(email)) {
    fields['email'] = 'Enter a valid email address.';
  }
  if (!isWithinLength(phone, TEXT_LIMITS.phone) || !PATTERNS.phone.test(phone)) {
    fields['phone'] = 'Enter a valid phone number.';
  }

  if (Object.keys(fields).length > 0) {
    throw new ApiError('VALIDATION_FAILED', 'Please correct the highlighted fields.', fields);
  }

  return { name, designation, companyName, country, email, phone };
}

/* -------------------------------------------------------------------------- */
/* The snapshot a quotation carries                                           */
/* -------------------------------------------------------------------------- */

export interface ValidatedPersonSnapshot extends ValidatedPerson {
  id: string;
  signatureFileId: string;
}

export interface StoredPersonLookup {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  signatureFileId: string;
}

/**
 * Validate the authorized-person snapshot submitted with a quotation.
 *
 * The client sends a snapshot, but the SERVER decides what it contains. The
 * endpoint is public, so a caller can post any name and designation they like;
 * accepting that would let someone issue a quotation signed by a person who
 * never agreed to sign it.
 *
 * So: the id is looked up, and the snapshot is rebuilt from the stored record.
 * Whatever text arrived is discarded.
 *
 * The lookup deliberately accepts INACTIVE people. Re-saving a quotation whose
 * signatory has since left the company must not fail — §11.3 requires them to
 * stay resolvable. The active-only rule belongs to the selector, not here.
 */
export function validatePersonSnapshot(
  payload: unknown,
  lookup: (id: string) => StoredPersonLookup | null,
  options: { requireComplete: boolean },
): ValidatedPersonSnapshot | null {
  if (payload === undefined || payload === null) {
    if (options.requireComplete) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Select an authorized person before creating the quotation.',
        { authorizedPerson: 'An authorized person is required.' },
      );
    }
    return null;
  }

  const source = asRecord(payload, 'Authorized person');
  const id = text(source, 'id');

  if (id.length === 0) {
    if (!options.requireComplete) return null;
    throw new ApiError(
      'VALIDATION_FAILED',
      'Select an authorized person before creating the quotation.',
      { authorizedPerson: 'An authorized person is required.' },
    );
  }

  const stored = lookup(id);
  if (stored === null) {
    throw new ApiError('VALIDATION_FAILED', 'That authorized person could not be found.', {
      authorizedPerson: 'That authorized person could not be found.',
    });
  }

  // A signature is what makes the document a signed quotation. Missing one is
  // a blocker at finalize, but only a nuisance on a draft.
  if (options.requireComplete && stored.signatureFileId.length === 0) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `${stored.name} does not have a signature image yet. An administrator must upload one first.`,
      { authorizedPerson: 'This person has no signature image yet.' },
    );
  }

  return {
    id: stored.id,
    name: stored.name,
    designation: stored.designation,
    companyName: stored.companyName,
    country: stored.country,
    email: stored.email,
    phone: stored.phone,
    signatureFileId: stored.signatureFileId,
  };
}
