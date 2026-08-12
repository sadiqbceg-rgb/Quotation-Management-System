import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Modal } from '@/components/common/Modal';
import { NotAuthorized } from '@/components/common/NotAuthorized';
import { Spinner } from '@/components/common/Spinner';
import { PersonForm } from '@/components/signatories/PersonForm';
import { PersonList } from '@/components/signatories/PersonList';
import { SignatureUpload } from '@/components/signatories/SignatureUpload';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, businessMessageOf, messageOf } from '@/services/api/errors';
import type { PersonFormValues } from '@/schemas/person-schema';
import {
  createPerson,
  listPersons,
  setPersonActive,
  updatePerson,
  uploadSignature,
  type AuthorizedPerson,
} from '@/services/signatories/signatory-service';

/**
 * Authorized Persons (PRD §24).
 *
 * Admin-only. The library ships EMPTY and contains no signature image of any
 * kind — PRD §34 and the Phase 06 data rules forbid a fabricated signature,
 * and the signature in the reference quotation belongs to a real person and is
 * never extracted. Real files are uploaded here by an Admin once the company
 * supplies them.
 */
export default function SignatoriesPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const [editing, setEditing] = useState<AuthorizedPerson | null>(null);
  const [creating, setCreating] = useState(false);
  const [signatureFor, setSignatureFor] = useState<AuthorizedPerson | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const persons = useQuery({
    queryKey: ['persons', 'all'],
    queryFn: () => listPersons(token ?? '', true),
    enabled: token !== null && isAdmin,
  });

  const rows = persons.data ?? [];

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['persons'] });
  };

  const closeForm = (): void => {
    setCreating(false);
    setEditing(null);
    setFormError(null);
    setFieldErrors(null);
  };

  const onFormError = (error: unknown): void => {
    if (error instanceof AppError && error.fields !== undefined) {
      setFieldErrors(error.fields);
      return;
    }
    setFormError(messageOf(error));
  };

  const saveMutation = useMutation({
    mutationFn: (values: PersonFormValues) =>
      editing === null
        ? createPerson(values, token ?? '')
        : updatePerson({ id: editing.id, ...values }, token ?? ''),
    onSuccess: () => {
      invalidate();
      show({
        variant: 'success',
        message: editing === null ? 'Authorized person added.' : 'Details updated.',
      });
      closeForm();
    },
    onError: onFormError,
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setPersonActive(id, active, token ?? ''),
    onSuccess: () => {
      invalidate();
      setPendingId(null);
    },
    onError: (error: unknown) => {
      setPendingId(null);
      // The "in use on a draft" refusal names the blocking draft, so it must be
      // shown in full rather than collapsed into "correct the highlighted
      // fields" — there is no field on this page to correct.
      show({ variant: 'error', message: businessMessageOf(error) });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (input: { id: string; signature: string; filename: string }) =>
      uploadSignature(input, token ?? ''),
    onSuccess: (result) => {
      invalidate();
      setSignatureFor(null);
      setUploadError(null);
      show({
        variant: result.warnings.length > 0 ? 'error' : 'success',
        message:
          result.warnings.length > 0
            ? `Signature saved, but: ${result.warnings.join(' ')}`
            : `Signature saved (${String(result.width)} × ${String(result.height)} px).`,
      });
    },
    onError: (error: unknown) => {
      // The modal stays open with the chosen file intact, so retry is one click.
      setUploadError(messageOf(error));
    },
  });

  if (!isAdmin) {
    return <NotAuthorized />;
  }

  return (
    <>
      <PageHeader
        title="Authorized Persons"
        description="Signatories and their signature images. A person needs a signature on file before they can be selected on a quotation."
        actions={
          <Button
            onClick={() => {
              setFormError(null);
              setFieldErrors(null);
              setCreating(true);
            }}
          >
            Add person
          </Button>
        }
      />

      <Card title="Library">
        {persons.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading authorized persons" />
          </div>
        ) : persons.isError ? (
          <p className="text-brand-red text-sm">{messageOf(persons.error)}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No authorized persons yet"
            description="Add the people who sign your quotations, then upload each one's signature as a transparent PNG. Nothing is pre-filled — no sample signatory and no placeholder signature exists in this system."
            action={
              <Button
                onClick={() => {
                  setFormError(null);
                  setFieldErrors(null);
                  setCreating(true);
                }}
              >
                Add the first person
              </Button>
            }
          />
        ) : (
          <PersonList
            persons={rows}
            pendingId={pendingId}
            onEdit={(person) => {
              setFormError(null);
              setFieldErrors(null);
              setEditing(person);
            }}
            onManageSignature={(person) => {
              setUploadError(null);
              setSignatureFor(person);
            }}
            onToggleActive={(person, active) => {
              setPendingId(person.id);
              activeMutation.mutate({ id: person.id, active });
            }}
          />
        )}
      </Card>

      {creating || editing !== null ? (
        <PersonForm
          open
          {...(editing === null
            ? {}
            : {
                initialValues: {
                  name: editing.name,
                  designation: editing.designation,
                  companyName: editing.companyName,
                  country: editing.country,
                  email: editing.email,
                  phone: editing.phone,
                },
              })}
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
      ) : null}

      <Modal
        open={signatureFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSignatureFor(null);
            setUploadError(null);
          }
        }}
        title={
          signatureFor?.hasSignature === true
            ? `Replace ${signatureFor.name}'s signature`
            : `Add a signature for ${signatureFor?.name ?? ''}`
        }
        description="Replacing a signature keeps the previous image, so quotations already issued are unchanged."
        size="lg"
      >
        {signatureFor === null ? null : (
          <SignatureUpload
            personName={signatureFor.name}
            isUploading={uploadMutation.isPending}
            error={uploadError}
            onUpload={(value) => {
              setUploadError(null);
              uploadMutation.mutate({
                id: signatureFor.id,
                signature: value.signature,
                filename: value.filename,
              });
            }}
          />
        )}
      </Modal>
    </>
  );
}
