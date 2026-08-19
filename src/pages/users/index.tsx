import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { NotAuthorized } from '@/components/common/NotAuthorized';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { Table, type TableColumn } from '@/components/common/Table';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, businessMessageOf, messageOf } from '@/services/api/errors';
import {
  createUser,
  listUsers,
  resetUserCredential,
  setUserActive,
  setUserRole,
  type ManagedUser,
} from '@/services/auth/auth-service';
import { formatDisplayDate } from '@/utils/format-date';
import { TEXT_LIMITS } from '@shared/validation-rules';
import { USER_ROLES, type UserRole } from '@shared/types';

const ROLE_OPTIONS = USER_ROLES.map((role) => ({ value: role, label: role }));

/**
 * A stored timestamp, as a date.
 *
 * `Created At` and `Last Login At` are full ISO datetimes, but
 * `formatDisplayDate` takes an ISO *date* and its pattern is anchored, so a
 * datetime returns an empty string. The time of day is not information anyone
 * administering accounts needs, so the date part is what is shown.
 */
function asDisplayDate(isoTimestamp: string): string {
  if (isoTimestamp.length === 0) return '';
  return formatDisplayDate(isoTimestamp.slice(0, 10));
}

/**
 * The credential rules, from the ONE place they are defined.
 *
 * `TEXT_LIMITS.password` is what the Apps Script validator enforces. Reading it
 * here rather than restating "12" means the form and the server can never
 * disagree about what is acceptable. There is no complexity rule in this
 * system, and this screen does not invent one.
 */
function credentialError(secret: string, confirmation: string): string | null {
  const { min, max } = TEXT_LIMITS.password;
  if (secret.length < min || secret.length > max) {
    return `Must be ${String(min)}-${String(max)} characters.`;
  }
  if (secret !== confirmation) return 'The two entries do not match.';
  return null;
}

/**
 * `error` as a prop that is either present or absent, never present-and-undefined.
 *
 * `exactOptionalPropertyTypes` is on, so `error={maybeUndefined}` does not
 * compile. The rest of the codebase spreads conditionally for the same reason.
 */
function errorProp(value: string | null | undefined): { error?: string } {
  return value === null || value === undefined || value.length === 0 ? {} : { error: value };
}

/* -------------------------------------------------------------------------- */
/* Add user                                                                   */
/* -------------------------------------------------------------------------- */

interface AddUserModalProps {
  open: boolean;
  isSaving: boolean;
  error: string | null;
  fieldErrors: Record<string, string> | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: { email: string; password: string; role: UserRole }) => void;
}

function AddUserModal({
  open,
  isSaving,
  error,
  fieldErrors,
  onOpenChange,
  onSubmit,
}: AddUserModalProps) {
  const [email, setEmail] = useState('');
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [role, setRole] = useState<UserRole>('User');
  const [localError, setLocalError] = useState<string | null>(null);

  const reset = (): void => {
    setEmail('');
    setSecret('');
    setConfirmation('');
    setRole('User');
    setLocalError(null);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        // The credential is cleared the moment the dialog closes. It lives in
        // component state for the duration of the form and nowhere else — never
        // in storage, never in a query cache, never in a URL.
        if (!next) reset();
        onOpenChange(next);
      }}
      title="Add user"
      description="The new account can sign in immediately. There is no self-registration — only an Admin can create an account."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const problem = credentialError(secret, confirmation);
          if (problem !== null) {
            setLocalError(problem);
            return;
          }
          setLocalError(null);
          onSubmit({ email: email.trim(), password: secret, role });
        }}
      >
        <Field label="Email" required {...errorProp(fieldErrors?.['email'])}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="email"
              autoComplete="off"
              value={email}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>

        <Field
          label="Password"
          required
          hint={`${String(TEXT_LIMITS.password.min)}-${String(TEXT_LIMITS.password.max)} characters.`}
          {...errorProp(fieldErrors?.['password'] ?? localError)}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={secret}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setSecret(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Confirm password" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Role" required {...errorProp(fieldErrors?.['role'])}>
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              options={ROLE_OPTIONS}
              value={role}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setRole(event.target.value === 'Admin' ? 'Admin' : 'User');
              }}
            />
          )}
        </Field>

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
            Create user
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */
/* Reset credential                                                           */
/* -------------------------------------------------------------------------- */

interface ResetCredentialModalProps {
  user: ManagedUser | null;
  isSaving: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newSecret: string) => void;
}

function ResetCredentialModal({
  user,
  isSaving,
  error,
  onOpenChange,
  onSubmit,
}: ResetCredentialModalProps) {
  const [secret, setSecret] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <Modal
      open={user !== null}
      onOpenChange={(next) => {
        if (!next) {
          setSecret('');
          setConfirmation('');
          setLocalError(null);
        }
        onOpenChange(next);
      }}
      title={user === null ? 'Set a new password' : `Set a new password for ${user.email}`}
      /*
       * The existing password is never shown, because it is never stored — only
       * a salted, peppered PBKDF2 hash of it is, and that cannot be reversed.
       * Saying so here stops anyone asking for a "show current password" button.
       */
      description="The current password cannot be displayed — it is not stored anywhere, only an irreversible hash of it. Setting a new one takes effect immediately and the old one stops working."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const problem = credentialError(secret, confirmation);
          if (problem !== null) {
            setLocalError(problem);
            return;
          }
          setLocalError(null);
          onSubmit(secret);
        }}
      >
        <Field
          label="New password"
          required
          hint={`${String(TEXT_LIMITS.password.min)}-${String(TEXT_LIMITS.password.max)} characters.`}
          {...errorProp(localError)}
        >
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={secret}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setSecret(event.target.value);
              }}
            />
          )}
        </Field>

        <Field label="Confirm new password" required>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              type="password"
              autoComplete="new-password"
              value={confirmation}
              invalid={invalid}
              {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
              onChange={(event) => {
                setConfirmation(event.target.value);
              }}
            />
          )}
        </Field>

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
            Set password
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
 * User management (IMPLEMENTATION_PLAN.md §18.4 — "Manage users": Admin only).
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS SCREEN IS NOT
 * ---------------------------------------------------------------------------
 * It is not the security boundary. The route guard and the hidden navigation
 * item are convenience: the Apps Script endpoint is publicly reachable, so
 * every action here is declared `access: 'Admin'` in the ACTIONS table and the
 * router enforces it before any handler runs. A User who calls
 * `admin.setUserRole` directly is refused by the server, not by this file.
 *
 * No password, hash or salt appears anywhere on this screen. `ManagedUser` has
 * no field to carry one — the server strips it — and the reset dialog can only
 * write a new credential, never read the existing one.
 */
export default function UsersPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';
  const currentEmail = state.status === 'authenticated' ? state.user.email : '';

  const [adding, setAdding] = useState(false);
  const [resetting, setResetting] = useState<ManagedUser | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);

  const users = useQuery({
    queryKey: ['users'],
    queryFn: () => listUsers(token ?? ''),
    enabled: token !== null && isAdmin,
  });

  const rows = users.data ?? [];

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['users'] });
  };

  const createMutation = useMutation({
    mutationFn: (values: { email: string; password: string; role: UserRole }) =>
      createUser(values, token ?? ''),
    onSuccess: (created) => {
      invalidate();
      setAdding(false);
      setFormError(null);
      setFieldErrors(null);
      show({ variant: 'success', message: `${created.email} can now sign in as ${created.role}.` });
    },
    onError: (error: unknown) => {
      // A duplicate email arrives as a field error, so it lands on the field
      // rather than as a banner the user has to map back to an input.
      if (error instanceof AppError && error.fields !== undefined) {
        setFieldErrors(error.fields);
        return;
      }
      setFormError(messageOf(error));
    },
  });

  const resetMutation = useMutation({
    mutationFn: (input: { email: string; newSecret: string }) =>
      resetUserCredential(input.email, input.newSecret, token ?? ''),
    onSuccess: (updated) => {
      invalidate();
      setResetting(null);
      setResetError(null);
      show({ variant: 'success', message: `New password set for ${updated.email}.` });
    },
    onError: (error: unknown) => {
      // The dialog stays open so the Admin can correct and retry without
      // retyping the email.
      // "That account could not be found." is worth showing verbatim; the
      // length rule is already enforced before the request is sent.
      setResetError(businessMessageOf(error));
    },
  });

  const activeMutation = useMutation({
    mutationFn: (input: { email: string; active: boolean }) =>
      setUserActive(input.email, input.active, token ?? ''),
    onSuccess: (updated) => {
      invalidate();
      setPendingEmail(null);
      show({
        variant: 'success',
        message: `${updated.email} is now ${updated.active ? 'active' : 'inactive'}.`,
      });
    },
    onError: (error: unknown) => {
      setPendingEmail(null);
      // The last-Admin refusal names the reason and the way out ("create a
      // replacement first"). There is no field on this page to correct, so
      // collapsing it to a generic message would leave the Admin stuck.
      show({ variant: 'error', message: businessMessageOf(error) });
    },
  });

  const roleMutation = useMutation({
    mutationFn: (input: { email: string; role: UserRole }) =>
      setUserRole(input.email, input.role, token ?? ''),
    onSuccess: (updated) => {
      invalidate();
      setPendingEmail(null);
      show({ variant: 'success', message: `${updated.email} is now ${updated.role}.` });
    },
    onError: (error: unknown) => {
      setPendingEmail(null);
      // Same reasoning as the activation mutation above.
      show({ variant: 'error', message: businessMessageOf(error) });
    },
  });

  if (!isAdmin) {
    return <NotAuthorized />;
  }

  const busy = activeMutation.isPending || roleMutation.isPending;

  const columns: Array<TableColumn<ManagedUser>> = [
    {
      key: 'email',
      header: 'Email',
      render: (row) => (
        <span className="font-medium">
          {row.email}
          {row.email === currentEmail ? (
            <span className="ml-2 text-xs font-normal text-slate-500">(you)</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (row) => (
        <Select
          options={ROLE_OPTIONS}
          value={row.role}
          aria-label={`Role for ${row.email}`}
          disabled={busy}
          onChange={(event) => {
            const next: UserRole = event.target.value === 'Admin' ? 'Admin' : 'User';
            if (next === row.role) return;
            setPendingEmail(row.email);
            roleMutation.mutate({ email: row.email, role: next });
          }}
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) =>
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
    { key: 'created', header: 'Created At', render: (row) => asDisplayDate(row.createdAt) },
    {
      key: 'lastLogin',
      header: 'Last Login At',
      render: (row) =>
        row.lastLoginAt.length === 0 ? (
          <span className="text-slate-400">Never</span>
        ) : (
          asDisplayDate(row.lastLoginAt)
        ),
    },
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
              setResetError(null);
              setResetting(row);
            }}
          >
            Set password
          </Button>
          <Button
            variant={row.active ? 'danger' : 'secondary'}
            size="sm"
            isLoading={pendingEmail === row.email && busy}
            disabled={busy}
            onClick={() => {
              setPendingEmail(row.email);
              activeMutation.mutate({ email: row.email, active: !row.active });
            }}
          >
            {row.active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Users"
        description="Who can sign in, and what they may do. Deactivating an account keeps its history — accounts are never deleted."
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setFieldErrors(null);
              setAdding(true);
            }}
          >
            Add user
          </Button>
        }
      />

      <Card title="Accounts">
        {users.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading users" />
          </div>
        ) : users.isError ? (
          <p className="text-brand-red text-sm">{messageOf(users.error)}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="The first Admin is created by an operator from the Apps Script editor. Every account after that is added here."
            action={
              <Button
                onClick={() => {
                  setFormError(null);
                  setFieldErrors(null);
                  setAdding(true);
                }}
              >
                Add the first user
              </Button>
            }
          />
        ) : (
          <Table columns={columns} rows={rows} rowKey={(row) => row.email} caption="Users" />
        )}
      </Card>

      <AddUserModal
        open={adding}
        isSaving={createMutation.isPending}
        error={formError}
        fieldErrors={fieldErrors}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setFormError(null);
            setFieldErrors(null);
          }
        }}
        onSubmit={(values) => {
          createMutation.mutate(values);
        }}
      />

      <ResetCredentialModal
        user={resetting}
        isSaving={resetMutation.isPending}
        error={resetError}
        onOpenChange={(open) => {
          if (!open) {
            setResetting(null);
            setResetError(null);
          }
        }}
        onSubmit={(newSecret) => {
          if (resetting === null) return;
          resetMutation.mutate({ email: resetting.email, newSecret });
        }}
      />
    </>
  );
}
