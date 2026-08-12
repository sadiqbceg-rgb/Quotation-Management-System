/**
 * The `AuthorizedPersons` sheet — the signatory library.
 *
 * See PRD §24 and IMPLEMENTATION_PLAN.md §11 and §17.3.
 *
 * ---------------------------------------------------------------------------
 * NOT A LOGIN ACCOUNT
 * ---------------------------------------------------------------------------
 * An authorized person is the human who SIGNS a quotation. A user is someone
 * who can sign IN. They are deliberately different sheets with no shared key:
 * merging them would mean either giving every signatory a password or letting a
 * row in this sheet grant access, and both are wrong.
 *
 * The sheet ships EMPTY. PRD §24's "Person 1 / Person 2" are illustrative, and
 * the real signatory named in the reference quotation is evidence, not a
 * fixture — writing either into the library would be inventing personal data.
 *
 * The signature BINARY is never here. Only its Drive file id: a spreadsheet
 * cell caps at 50,000 characters, and more importantly a signature image in a
 * sheet is one careless share away from being public.
 *
 * Deletion is a SOFT delete. A quotation issued last year names its signatory,
 * and that person must stay resolvable even after they leave the company.
 */

import {
  appendRow,
  asBoolean,
  asText,
  findRow,
  getOrCreateSheet,
  readRows,
  setCell,
} from './sheet-access';

export const PERSONS_SHEET_NAME = 'AuthorizedPersons';

export const PERSONS_HEADERS = [
  'ID',
  'Name',
  'Designation',
  'Company Name',
  'Country',
  'Email',
  'Phone',
  'Signature File ID',
  'Active',
  'Created At',
  'Updated At',
] as const;

const COLUMN = {
  id: 0,
  name: 1,
  designation: 2,
  companyName: 3,
  country: 4,
  email: 5,
  phone: 6,
  signatureFileId: 7,
  active: 8,
  createdAt: 9,
  updatedAt: 10,
} as const;

export interface PersonRecord {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
  /** Empty until a signature has been uploaded. */
  signatureFileId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  rowNumber: number;
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(PERSONS_SHEET_NAME, PERSONS_HEADERS);
}

function toRecord(values: unknown[], rowNumber: number): PersonRecord {
  return {
    id: asText(values[COLUMN.id]),
    name: asText(values[COLUMN.name]),
    designation: asText(values[COLUMN.designation]),
    companyName: asText(values[COLUMN.companyName]),
    country: asText(values[COLUMN.country]),
    email: asText(values[COLUMN.email]),
    phone: asText(values[COLUMN.phone]),
    signatureFileId: asText(values[COLUMN.signatureFileId]),
    active: asBoolean(values[COLUMN.active]),
    createdAt: asText(values[COLUMN.createdAt]),
    updatedAt: asText(values[COLUMN.updatedAt]),
    rowNumber,
  };
}

/** Every person, newest last. Active only unless asked otherwise. */
export function listPersons(includeInactive = false): PersonRecord[] {
  const rows = readRows(sheet());
  const persons: PersonRecord[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.id]).length === 0) continue;

    const record = toRecord(row, index + 2);
    if (includeInactive || record.active) persons.push(record);
  }

  return persons;
}

/**
 * Find by id regardless of active state.
 *
 * Deliberately not filtered: an inactive person must still resolve, or a
 * historic quotation would lose its signatory the day they left.
 */
export function findById(id: string): PersonRecord | null {
  const found = findRow(sheet(), COLUMN.id, id);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

/** Case-insensitive duplicate check among ACTIVE people, by name + designation. */
export function personExists(name: string, designation: string, exceptId = ''): boolean {
  const targetName = name.trim().toLowerCase();
  const targetDesignation = designation.trim().toLowerCase();

  return listPersons(true).some(
    (person) =>
      person.id !== exceptId &&
      person.active &&
      person.name.trim().toLowerCase() === targetName &&
      person.designation.trim().toLowerCase() === targetDesignation,
  );
}

export interface CreatePersonInput {
  id: string;
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
}

export function createPerson(input: CreatePersonInput): PersonRecord {
  const now = new Date().toISOString();

  appendRow(sheet(), [
    input.id,
    input.name,
    input.designation,
    input.companyName,
    input.country,
    input.email,
    input.phone,
    // No signature yet. A person is created first, then given one, because the
    // upload needs an id to attach to.
    '',
    true,
    now,
    now,
  ]);

  return {
    ...input,
    signatureFileId: '',
    active: true,
    createdAt: now,
    updatedAt: now,
    rowNumber: sheet().getLastRow(),
  };
}

export interface UpdatePersonInput {
  name: string;
  designation: string;
  companyName: string;
  country: string;
  email: string;
  phone: string;
}

/** Update the details. `createdAt` is never touched — it is the audit anchor. */
export function updatePerson(existing: PersonRecord, input: UpdatePersonInput): PersonRecord {
  const target = sheet();
  const now = new Date().toISOString();

  setCell(target, existing.rowNumber, COLUMN.name + 1, input.name);
  setCell(target, existing.rowNumber, COLUMN.designation + 1, input.designation);
  setCell(target, existing.rowNumber, COLUMN.companyName + 1, input.companyName);
  setCell(target, existing.rowNumber, COLUMN.country + 1, input.country);
  setCell(target, existing.rowNumber, COLUMN.email + 1, input.email);
  setCell(target, existing.rowNumber, COLUMN.phone + 1, input.phone);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, now);

  return { ...existing, ...input, updatedAt: now };
}

/**
 * Point a person at a newly uploaded signature.
 *
 * The previous file id is simply replaced here; the OLD DRIVE FILE IS NOT
 * DELETED (see signature-storage.ts). A quotation issued last month still
 * references it, and deleting it would leave that document unable to render.
 */
export function setSignatureFileId(existing: PersonRecord, fileId: string): PersonRecord {
  const target = sheet();
  const now = new Date().toISOString();

  setCell(target, existing.rowNumber, COLUMN.signatureFileId + 1, fileId);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, now);

  return { ...existing, signatureFileId: fileId, updatedAt: now };
}

export function setActive(existing: PersonRecord, active: boolean): PersonRecord {
  const target = sheet();
  const now = new Date().toISOString();

  setCell(target, existing.rowNumber, COLUMN.active + 1, active);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, now);

  return { ...existing, active, updatedAt: now };
}

export function isEmpty(): boolean {
  return listPersons(true).length === 0;
}
