import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { useAuth } from '@/hooks/useAuth';
import { messageOf } from '@/services/api/errors';
import { listCustomers, matchesSearch, type Customer } from '@/services/clients/client-service';

export interface CustomerPickerProps {
  /** Receives the chosen customer's VALUES. The id is deliberately not passed on. */
  onSelect: (customer: Customer) => void;
}

/**
 * Fill the client fields from the customer library (PRD §40).
 *
 * ---------------------------------------------------------------------------
 * THIS PREFILLS. IT DOES NOT LINK.
 * ---------------------------------------------------------------------------
 * Choosing a customer writes its values into the form's existing fields and
 * then has no further involvement: the quotation stores what the form holds,
 * and no customer id is written onto it. That is what makes a later edit to a
 * customer — or its deactivation — unable to alter a quotation that has already
 * been created.
 *
 * Every field stays editable afterwards. A one-off variation on an address is
 * a normal thing to need, and it must not require editing the library record
 * that other quotations will draw from.
 *
 * Only ACTIVE customers are offered: `listCustomers` defaults to active-only,
 * and a deactivated customer is one the company has decided not to quote again.
 */
export function CustomerPicker({ onSelect }: CustomerPickerProps) {
  const { state } = useAuth();
  const token = state.status === 'authenticated' ? state.token : null;

  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const customers = useQuery({
    queryKey: ['customers', 'active'],
    queryFn: () => listCustomers(token ?? ''),
    // Nothing is fetched until the picker is opened. PRD §35: opening the New
    // Quotation page must not do work of its own.
    enabled: token !== null && open,
  });

  // Memoised so the `?? []` fallback does not allocate a fresh array on every
  // render and defeat the filter memo below it.
  const all = useMemo(() => customers.data ?? [], [customers.data]);
  const rows = useMemo(
    () => all.filter((customer) => matchesSearch(customer, search)),
    [all, search],
  );

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
      >
        Choose from customers
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
        title="Choose a customer"
        description="The details are copied into the form and stay editable. The quotation keeps whatever you save, so later changes to this customer will not affect it."
        size="lg"
      >
        <div className="flex flex-col gap-4">
          <Input
            type="search"
            placeholder="Search customers"
            aria-label="Search customers"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
            }}
          />

          {customers.isPending ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" label="Loading customers" />
            </div>
          ) : customers.isError ? (
            <p role="alert" className="text-brand-red text-sm">
              {messageOf(customers.error)}
            </p>
          ) : all.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No customers yet. Add them under Customers, or just type the details below.
            </p>
          ) : rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No customer matches “{search}”.
            </p>
          ) : (
            <ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
              {rows.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border border-slate-100 p-3 text-left transition-colors hover:bg-slate-50"
                    onClick={() => {
                      onSelect(customer);
                      setOpen(false);
                      setSearch('');
                    }}
                  >
                    <span className="block font-medium text-slate-900">
                      {customer.companyName}
                    </span>
                    <span className="block text-sm text-slate-600">{customer.clientName}</span>
                    {customer.address.length > 0 ? (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {customer.address}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
