/**
 * The `Customers` sheet — the reusable client library.
 *
 * Selecting a customer PREFILLS the quotation's client fields. It does not link
 * to them. The quotation stores the values it was given (see `client:
 * validated.client` in quotation/handlers.ts), so this sheet is a source of
 * convenience, never a source of truth for a quotation that already exists.
 *
 * That distinction is the whole design: editing a customer here must not change
 * a single quotation that has already been issued, and because no quotation
 * holds a customer id, it cannot.
 *
 * The sheet ships EMPTY. No sample customers — PRD §34 forbids fabricated
 * client data, and a demo customer in a real company's library is exactly the
 * kind of thing that ends up on a real quotation.
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

export const CLIENTS_SHEET_NAME = 'Customers';

export const CLIENTS_HEADERS = [
  'ID',
  'Client Name',
  'Company Name',
  'Address',
  'Contact Person',
  'Email',
  'Phone',
  'Active',
  'Created At',
  'Updated At',
] as const;

const COLUMN = {
  id: 0,
  clientName: 1,
  companyName: 2,
  address: 3,
  contactPerson: 4,
  email: 5,
  phone: 6,
  active: 7,
  createdAt: 8,
  updatedAt: 9,
} as const;

export interface ClientRecordRow {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  active: boolean;
  rowNumber: number;
}

function sheet(): GoogleAppsScript.Spreadsheet.Sheet {
  return getOrCreateSheet(CLIENTS_SHEET_NAME, CLIENTS_HEADERS);
}

function toRecord(values: unknown[], rowNumber: number): ClientRecordRow {
  return {
    id: asText(values[COLUMN.id]),
    clientName: asText(values[COLUMN.clientName]),
    companyName: asText(values[COLUMN.companyName]),
    address: asText(values[COLUMN.address]),
    contactPerson: asText(values[COLUMN.contactPerson]),
    email: asText(values[COLUMN.email]),
    phone: asText(values[COLUMN.phone]),
    active: asBoolean(values[COLUMN.active]),
    rowNumber,
  };
}

/** Active customers only by default — a deactivated one stays out of the picker. */
export function listClients(includeInactive = false): ClientRecordRow[] {
  const rows = readRows(sheet());
  const clients: ClientRecordRow[] = [];

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (row === undefined) continue;
    if (asText(row[COLUMN.id]).length === 0) continue;

    const record = toRecord(row, index + 2);
    if (includeInactive || record.active) clients.push(record);
  }

  return clients;
}

export function findById(id: string): ClientRecordRow | null {
  if (id.length === 0) return null;
  const found = findRow(sheet(), COLUMN.id, id);
  return found === null ? null : toRecord(found.values, found.rowNumber);
}

/**
 * True when another customer already pairs this client name with this company.
 *
 * Deliberately the PAIR, not the company alone: one company legitimately has
 * several contacts, and refusing the second would make the library unusable for
 * exactly the clients that matter most.
 */
export function nameExists(clientName: string, companyName: string, exceptId = ''): boolean {
  const client = clientName.trim().toLowerCase();
  const company = companyName.trim().toLowerCase();

  return listClients(true).some(
    (record) =>
      record.id !== exceptId &&
      record.clientName.trim().toLowerCase() === client &&
      record.companyName.trim().toLowerCase() === company,
  );
}

export interface CreateClientInput {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
}

export function createClient(input: CreateClientInput): ClientRecordRow {
  const now = new Date().toISOString();

  // `appendRow` escapes every string through `escapeForSheet`, so a customer
  // named `=IMPORTXML(...)` is stored as inert text rather than a formula that
  // fires when someone opens the spreadsheet.
  appendRow(sheet(), [
    input.id,
    input.clientName,
    input.companyName,
    input.address,
    input.contactPerson,
    input.email,
    input.phone,
    true,
    now,
    now,
  ]);

  return { ...input, active: true, rowNumber: sheet().getLastRow() };
}

export type UpdateClientInput = Omit<CreateClientInput, 'id'>;

export function updateClient(existing: ClientRecordRow, input: UpdateClientInput): void {
  const target = sheet();

  // Per-cell rather than a whole-row write: `createdAt`, `Active` and the id
  // are not this function's to touch, and naming each column is what keeps a
  // future column addition from silently shifting a value into the wrong cell.
  setCell(target, existing.rowNumber, COLUMN.clientName + 1, input.clientName);
  setCell(target, existing.rowNumber, COLUMN.companyName + 1, input.companyName);
  setCell(target, existing.rowNumber, COLUMN.address + 1, input.address);
  setCell(target, existing.rowNumber, COLUMN.contactPerson + 1, input.contactPerson);
  setCell(target, existing.rowNumber, COLUMN.email + 1, input.email);
  setCell(target, existing.rowNumber, COLUMN.phone + 1, input.phone);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
}

/**
 * Soft delete.
 *
 * A hard delete would remove a record that quotations were built from, and the
 * library is also the audit answer to "who did we quote". Deactivation just
 * removes it from the picker.
 */
export function setActive(existing: ClientRecordRow, active: boolean): void {
  const target = sheet();
  setCell(target, existing.rowNumber, COLUMN.active + 1, active);
  setCell(target, existing.rowNumber, COLUMN.updatedAt + 1, new Date().toISOString());
}
