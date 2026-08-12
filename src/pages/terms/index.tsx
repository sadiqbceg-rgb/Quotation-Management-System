import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { Modal } from '@/components/common/Modal';
import { Select } from '@/components/common/Select';
import { Spinner } from '@/components/common/Spinner';
import { Textarea } from '@/components/common/Textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, messageOf } from '@/services/api/errors';
import { TERM_CATEGORIES, validateTermForm } from '@/schemas/term-schema';
import {
  createTerm,
  importReferenceTerms,
  listTerms,
  reorderTerms,
  setTermActive,
  updateTerm,
  type TermCategory,
  type TermTemplate,
} from '@/services/terms/terms-service';

interface EditorState {
  /** Empty when creating. */
  id: string;
  title: string;
  bodyTemplate: string;
  category: TermCategory;
}

const BLANK: EditorState = { id: '', title: '', bodyTemplate: '', category: 'General' };

/**
 * Terms & Conditions library (PRD §20–§22).
 *
 * Ships EMPTY. The company's 11 real terms arrive through the Admin import,
 * which reads `reference/existing-terms.docx`; nothing is auto-seeded and no
 * wording is invented for the four PRD §20 labels the reference document does
 * not cover.
 *
 * "Delete" is a soft delete throughout. A quotation issued last year still
 * cites its terms, and a hard delete would leave that document unexplainable.
 */
export default function TermsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  const terms = useQuery({
    queryKey: ['terms', 'all'],
    queryFn: () => listTerms(token ?? '', true),
    enabled: token !== null,
  });

  const rows = terms.data ?? [];

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['terms'] });
  };

  const onMutationError = (error: unknown): void => {
    if (error instanceof AppError && error.fields !== undefined) {
      setFieldErrors(error.fields);
      return;
    }
    show({ variant: 'error', message: messageOf(error) });
  };

  const saveMutation = useMutation({
    mutationFn: (values: EditorState) =>
      values.id.length === 0
        ? createTerm(
            {
              title: values.title,
              bodyTemplate: values.bodyTemplate,
              category: values.category,
            },
            token ?? '',
          )
        : updateTerm(
            { id: values.id, title: values.title, bodyTemplate: values.bodyTemplate },
            token ?? '',
          ),
    onSuccess: (_result, values) => {
      invalidate();
      show({
        variant: 'success',
        message: values.id.length === 0 ? 'Term added to the library.' : 'Term updated.',
      });
      setEditor(null);
      setFieldErrors(null);
    },
    onError: onMutationError,
  });

  const activeMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setTermActive(id, active, token ?? ''),
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderTerms(ids, token ?? ''),
    onSuccess: invalidate,
    onError: onMutationError,
  });

  const importMutation = useMutation({
    mutationFn: () => importReferenceTerms(token ?? ''),
    onSuccess: (result) => {
      invalidate();
      show({
        variant: 'success',
        message:
          result.imported === 0
            ? `Nothing to import — all ${String(result.total)} reference terms are already in the library.`
            : `Imported ${String(result.imported)} of ${String(result.total)} reference terms. ${String(result.skipped)} were already present and were left untouched.`,
      });
    },
    onError: (error: unknown) => {
      show({ variant: 'error', message: messageOf(error) });
    },
  });

  /** Move a term one place, then persist the whole order. */
  const move = (index: number, direction: -1 | 1): void => {
    const target = index + direction;
    if (target < 0 || target >= rows.length) return;

    const next = [...rows];
    const moving = next[index];
    const displaced = next[target];
    if (moving === undefined || displaced === undefined) return;

    next[index] = displaced;
    next[target] = moving;

    reorderMutation.mutate(next.map((term) => term.id));
  };

  const submit = (): void => {
    if (editor === null) return;

    const values = { title: editor.title.trim(), bodyTemplate: editor.bodyTemplate.trim() };
    const problems = validateTermForm(values);

    if (problems !== null) {
      setFieldErrors(problems);
      return;
    }

    saveMutation.mutate({ ...editor, ...values });
  };

  return (
    <>
      <PageHeader
        title="Terms & Conditions"
        description="The reusable library. Selecting a term on a quotation copies its wording — later edits here never change a quotation that has already been issued."
        actions={
          <div className="flex gap-2">
            {isAdmin ? (
              <Button
                variant="secondary"
                isLoading={importMutation.isPending}
                onClick={() => {
                  importMutation.mutate();
                }}
              >
                Import company terms
              </Button>
            ) : null}
            <Button
              onClick={() => {
                setFieldErrors(null);
                setEditor(BLANK);
              }}
            >
              Add term
            </Button>
          </div>
        }
      />

      <Card
        title="Library"
        description="Order here is the order the checkboxes appear on a quotation. Each quotation then orders its own selection."
      >
        {terms.isPending && token !== null ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" label="Loading terms" />
          </div>
        ) : terms.isError ? (
          <p className="text-brand-red text-sm">{messageOf(terms.error)}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="The Terms & Conditions library is empty"
            description={
              isAdmin
                ? "Import the company's standard terms from the reference document, or add one by hand. The import is safe to run twice — it never modifies a term that already exists."
                : 'Add the terms your company quotes, or ask an administrator to import the standard set.'
            }
            action={
              isAdmin ? (
                <Button
                  isLoading={importMutation.isPending}
                  onClick={() => {
                    importMutation.mutate();
                  }}
                >
                  Import company terms
                </Button>
              ) : (
                <Button
                  onClick={() => {
                    setFieldErrors(null);
                    setEditor(BLANK);
                  }}
                >
                  Add the first term
                </Button>
              )
            }
          />
        ) : (
          <ol className="flex flex-col gap-2">
            {rows.map((term: TermTemplate, index: number) => (
              <li
                key={term.id}
                className="flex items-start gap-3 rounded-md border border-slate-200 px-3 py-2.5"
              >
                <div className="flex shrink-0 flex-col">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    disabled={index === 0 || reorderMutation.isPending}
                    aria-label={`Move "${term.title}" up`}
                    onClick={() => {
                      move(index, -1);
                    }}
                  >
                    <span aria-hidden="true">↑</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1.5"
                    disabled={index === rows.length - 1 || reorderMutation.isPending}
                    aria-label={`Move "${term.title}" down`}
                    onClick={() => {
                      move(index, 1);
                    }}
                  >
                    <span aria-hidden="true">↓</span>
                  </Button>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">{term.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">
                      {term.category}
                    </span>
                    {term.active ? null : (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        Inactive
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">
                    {term.bodyTemplate}
                  </p>
                </div>

                <div className="flex shrink-0 gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setFieldErrors(null);
                      setEditor({
                        id: term.id,
                        title: term.title,
                        bodyTemplate: term.bodyTemplate,
                        category: term.category,
                      });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      activeMutation.mutate({ id: term.id, active: !term.active });
                    }}
                  >
                    {term.active ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Card>

      <Modal
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setEditor(null);
            setFieldErrors(null);
          }
        }}
        title={editor !== null && editor.id.length > 0 ? 'Edit term' : 'Add a term'}
        description="Plain text. Whitelisted {{tokens}} are filled in when a document is produced."
        size="lg"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setEditor(null);
                setFieldErrors(null);
              }}
            >
              Cancel
            </Button>
            <Button isLoading={saveMutation.isPending} onClick={submit}>
              Save
            </Button>
          </>
        }
      >
        {editor === null ? null : (
          <div className="flex flex-col gap-4">
            <Field
              label="Term name"
              required
              {...(fieldErrors?.['title'] === undefined ? {} : { error: fieldErrors['title'] })}
            >
              {({ id, invalid, describedBy }) => (
                <Input
                  id={id}
                  value={editor.title}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setEditor({ ...editor, title: event.target.value });
                    setFieldErrors(null);
                  }}
                />
              )}
            </Field>

            <Field
              label="Term content"
              required
              {...(fieldErrors?.['bodyTemplate'] === undefined
                ? {}
                : { error: fieldErrors['bodyTemplate'] })}
            >
              {({ id, invalid, describedBy }) => (
                <Textarea
                  id={id}
                  rows={6}
                  value={editor.bodyTemplate}
                  invalid={invalid}
                  aria-describedby={describedBy}
                  onChange={(event) => {
                    setEditor({ ...editor, bodyTemplate: event.target.value });
                    setFieldErrors(null);
                  }}
                />
              )}
            </Field>

            <Field label="Category">
              {({ id }) => (
                <Select
                  id={id}
                  value={editor.category}
                  disabled={editor.id.length > 0}
                  options={TERM_CATEGORIES.map((entry) => ({ value: entry, label: entry }))}
                  onChange={(event) => {
                    setEditor({ ...editor, category: event.target.value as TermCategory });
                  }}
                />
              )}
            </Field>
          </div>
        )}
      </Modal>
    </>
  );
}
