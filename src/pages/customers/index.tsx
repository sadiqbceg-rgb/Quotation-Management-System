import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Spinner } from '@/components/common/Spinner';
import { Table, type TableColumn } from '@/components/common/Table';
import { Textarea } from '@/components/common/Textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, businessMessageOf, messageOf } from '@/services/api/errors';
import {
  createCustomer,
  listCustomers,
  matchesSearch,
  setCustomerActive,
  updateCustomer,
  type Customer,
  type CustomerInput,
} from '@/services/clients/client-service';

const EMPTY: CustomerInput = {
  clientName: '',
  companyName: '',
  address: '',
  contactPerson: '',
  email: '',
  phone: '',
};

/** `error` present-or-absent, never present-and-undefined (exactOptionalPropertyTypes). */
function errorProp(value: string | null | undefined): { error?: string } {
  return value === null || value === undefined || value.length === 0 ? {} : { error: value };
}

/* -------------------------------------------------------------------------- */
/* Form                                                                       */
/* -------------------------------------------------------------------------- */

interface CustomerFormProps {
  open: boolean;
  initial: Customer | null;
  isSaving: boolean;
  error: string | null;
  fieldErrors: Record<string, string> | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CustomerInput) => void;
}

function CustomerForm({
  open,
  initial,
  isSaving,
  error,
  fieldErrors,
  onOpenChange,
  onSubmit,
}: CustomerFormProps) {
  const [values, setValues] = useState<CustomerInput>(EMPTY);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Load the record being edited once per open, without an effect: deriving it
  // during render keeps the user's in-progress typing from being overwritten
  // every time the parent re-renders.
  const key = initial === null ? '__new__' : initial.id;
  if (open && loadedFor !== key) {
    setLoadedFor(key);
    setValues(
      initial === null
        ? EMPTY
        : {
            clientName: initial.clientName,
            companyName: initial.companyName,
            address: initial.address,
            contactPerson: initial.contactPerson,
            email: initial.email,
            phone: initial.phone,
          },
    );
  }

  const set = (field: keyof CustomerInput, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) setLoadedFor(null);
        onOpenChange(next);
      }}
      title={initial === null ? 'Add customer' : `Edit ${initial.companyName}`}
      description="Saved details are reused when creating a quotation. Editing a customer never changes a quotation that has already been created."
      size="lg"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(values);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Client Name" required {...errorProp(fieldErrors?.['clientName'])}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={values.clientName}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                onChange={(event) => {
                  set('clientName', event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Company Name" required {...errorProp(fieldErrors?.['companyName'])}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={values.companyName}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                onChange={(event) => {
                  set('companyName', event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        <Field label="Address" required {...errorProp(fieldErrors?.['address'])}>
          {({ id, describedBy, invalid }) => (
            <Textarea
              id={id}
              rows={3}
              value={values.address}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                set('address', event.target.value);
              }}
            />
          )}
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Contact Person" {...errorProp(fieldErrors?.['contactPerson'])}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={values.contactPerson}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                onChange={(event) => {
                  set('contactPerson', event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Email" {...errorProp(fieldErrors?.['email'])}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                type="email"
                value={values.email}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                onChange={(event) => {
                  set('email', event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Phone" {...errorProp(fieldErrors?.['phone'])}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                value={values.phone}
                invalid={invalid}
                {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                onChange={(event) => {
                  set('phone', event.target.value);
                }}
              />
            )}
          </Field>
        </div>

        {error === null ? null : (
          <p role="alert" className="text-brand-red text-sm">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          <Button type="submit" isLoading={isSaving}>
            {initial === null ? 'Add customer' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The customer library (PRD §40).
 *
 * ---------------------------------------------------------------------------
 * WHY EDITING A CUSTOMER IS SAFE
 * ---------------------------------------------------------------------------
 * A quotation stores the client's details as VALUES, captured when it was
 * saved. No quotation holds a customer id. So a correction here — a moved
 * office, a new contact — applies to future quotations only, and there is no
 * code path by which it could reach one already issued.
 *
 * The list is filtered in the browser. V1 is a few hundred customers, and a
 * round trip per keystroke would be slower and would spend the Apps Script
 * execution budget for nothing — the same reasoning as the quotation register.
 */
export default function CustomersPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const customers = useQuery({
    queryKey: ['customers', 'all'],
    // Admins manage activation, so they see inactive rows too. A User only ever
    // needs the ones they can actually put on a quotation.
    queryFn: () => listCustomers(token ?? '', isAdmin),
    enabled: token !== null,
  });

  const all = useMemo(() => customers.data ?? [], [customers.data]);
  const rows = useMemo(
    () => all.filter((customer) => matchesSearch(customer, search)),
    [all, search],
  );

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['customers'] });
  };

  const closeForm = (): void => {
    setAdding(false);
    setEditing(null);
    setFormError(null);
    setFieldErrors(null);
  };

  const onFormError = (error: unknown): void => {
    if (error instanceof AppError && error.fields !== undefined) {
      setFieldErrors(error.fields);
      return;
    }
    setFormError(businessMessageOf(error));
  };

  const saveMutation = useMutation({
    mutationFn: (values: CustomerInput) =>
      editing === null
        ? createCustomer(values, token ?? '')
        : updateCustomer({ id: editing.id, ...values }, token ?? ''),
    onSuccess: (saved) => {
      invalidate();
      show({
        variant: 'success',
        message:
          editing === null ? `${saved.companyName} added.` : `${saved.companyName} updated.`,
      });
      closeForm();
    },
    onError: onFormError,
  });

  const activeMutation = useMutation({
    mutationFn: (input: { id: string; active: boolean }) =>
      setCustomerActive(input.id, input.active, token ?? ''),
    onSuccess: (saved) => {
      invalidate();
      setPendingId(null);
      show({
        variant: 'success',
        message: `${saved.companyName} is now ${saved.active ? 'active' : 'inactive'}.`,
      });
    },
    onError: (error: unknown) => {
      setPendingId(null);
      show({ variant: 'error', message: businessMessageOf(error) });
    },
  });

  const columns: Array<TableColumn<Customer>> = [
    {
      key: 'client',
      header: 'Client Name',
      render: (row) => <span className="font-medium">{row.clientName}</span>,
    },
    { key: 'company', header: 'Company Name', render: (row) => row.companyName },
    {
      key: 'contact',
      header: 'Contact',
      render: (row) => (
        <div className="text-sm">
          {row.contactPerson.length > 0 ? <div>{row.contactPerson}</div> : null}
          {row.email.length > 0 ? <div className="text-slate-500">{row.email}</div> : null}
          {row.phone.length > 0 ? <div className="text-slate-500">{row.phone}</div> : null}
          {row.contactPerson.length + row.email.length + row.phone.length === 0 ? (
            <span className="text-slate-400">—</span>
          ) : null}
        </div>
      ),
    },
    ...(isAdmin
      ? [
          {
            key: 'status',
            header: 'Status',
            render: (row: Customer) =>
              row.active ? (
                <span className="rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
                  Active
                </span>
              ) : (
                <span className="rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  Inactive
                </span>
              ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setFormError(null);
              setFieldErrors(null);
              setEditing(row);
            }}
          >
            Edit
          </Button>
          {isAdmin ? (
            <Button
              variant={row.active ? 'danger' : 'secondary'}
              size="sm"
              isLoading={pendingId === row.id && activeMutation.isPending}
              disabled={activeMutation.isPending}
              onClick={() => {
                setPendingId(row.id);
                activeMutation.mutate({ id: row.id, active: !row.active });
              }}
            >
              {row.active ? 'Deactivate' : 'Activate'}
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Client records reused across quotations. Editing a customer never changes a quotation that has already been created."
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setFieldErrors(null);
              setAdding(true);
            }}
          >
            Add customer
          </Button>
        }
      />

      <Card title="Library">
        {customers.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading customers" />
          </div>
        ) : customers.isError ? (
          <p className="text-brand-red text-sm">{messageOf(customers.error)}</p>
        ) : all.length === 0 ? (
          <EmptyState
            title="No customers yet"
            description="Add the clients you quote for, then pick one when creating a quotation to fill in their details. Nothing is pre-filled — this library ships empty by design."
            action={
              <Button
                onClick={() => {
                  setFormError(null);
                  setFieldErrors(null);
                  setAdding(true);
                }}
              >
                Add the first customer
              </Button>
            }
          />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="max-w-xs">
              <Input
                type="search"
                placeholder="Search customers"
                aria-label="Search customers"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                }}
              />
            </div>

            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No customer matches “{search}”.
              </p>
            ) : (
              <Table columns={columns} rows={rows} rowKey={(row) => row.id} caption="Customers" />
            )}
          </div>
        )}
      </Card>

      <CustomerForm
        open={adding || editing !== null}
        initial={editing}
        isSaving={saveMutation.isPending}
        error={formError}
        fieldErrors={fieldErrors}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        onSubmit={(values) => {
          saveMutation.mutate(values);
        }}
      />
    </>
  );
}
