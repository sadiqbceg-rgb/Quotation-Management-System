/**
 * Customer library actions, over the shared API client.
 *
 * ---------------------------------------------------------------------------
 * A CUSTOMER IS A SOURCE, NOT A LINK
 * ---------------------------------------------------------------------------
 * Selecting a customer copies its values into the quotation form. The quotation
 * then stores those values. Nothing here ever writes a customer id onto a
 * quotation, and nothing reads one back — which is what makes a later edit to a
 * customer unable to change a quotation that has already been issued.
 */

import { callAction } from '@/services/api/client';

/** Field-for-field the same shape as `ClientInfo`, so the picker needs no mapping. */
export interface Customer {
  id: string;
  clientName: string;
  companyName: string;
  address: string;
  contactPerson: string;
  email: string;
  phone: string;
  active: boolean;
}

export type CustomerInput = Omit<Customer, 'id' | 'active'>;

export async function listCustomers(token: string, includeInactive = false): Promise<Customer[]> {
  return callAction<{ includeInactive: boolean }, Customer[]>(
    'clients.list',
    { includeInactive },
    { token },
  );
}

export async function createCustomer(input: CustomerInput, token: string): Promise<Customer> {
  return callAction<CustomerInput, Customer>('clients.create', input, { token });
}

export async function updateCustomer(
  input: CustomerInput & { id: string },
  token: string,
): Promise<Customer> {
  return callAction<typeof input, Customer>('clients.update', input, { token });
}

/** Admin only — enforced by the backend, not by this function. */
export async function setCustomerActive(
  id: string,
  active: boolean,
  token: string,
): Promise<Customer> {
  return callAction<{ id: string; active: boolean }, Customer>(
    'clients.deactivate',
    { id, active },
    { token },
  );
}

/** Case-insensitive match across the fields someone would search by. */
export function matchesSearch(customer: Customer, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (needle.length === 0) return true;

  return [
    customer.clientName,
    customer.companyName,
    customer.contactPerson,
    customer.email,
    customer.phone,
  ].some((field) => field.toLowerCase().includes(needle));
}
