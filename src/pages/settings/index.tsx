import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PageHeader } from '@/components/common/PageHeader';
import { Button } from '@/components/common/Button';
import { Card } from '@/components/common/Card';
import { Field } from '@/components/common/Field';
import { Input } from '@/components/common/Input';
import { NotAuthorized } from '@/components/common/NotAuthorized';
import { Spinner } from '@/components/common/Spinner';
import { Textarea } from '@/components/common/Textarea';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/useToast';
import { AppError, businessMessageOf, messageOf } from '@/services/api/errors';
import {
  getSettings,
  updateSettings,
  type BusinessSettings,
} from '@/services/settings/settings-service';
import { COMPANY_IDENTITY } from '@/config/navigation';

/** `error` present-or-absent, never present-and-undefined (exactOptionalPropertyTypes). */
function errorProp(value: string | null | undefined): { error?: string } {
  return value === null || value === undefined || value.length === 0 ? {} : { error: value };
}

interface ReadOnlyRowProps {
  label: string;
  value: string;
  hint?: string;
}

function ReadOnlyRow({ label, value, hint }: ReadOnlyRowProps) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0">
      <div>
        <span className="text-sm font-medium text-slate-700">{label}</span>
        {hint === undefined ? null : <p className="text-xs text-slate-500">{hint}</p>}
      </div>
      <span className="text-sm text-slate-900 tabular-nums">
        {value.length > 0 ? value : <span className="text-slate-400">Not set</span>}
      </span>
    </div>
  );
}

/**
 * Company Settings (Admin only).
 *
 * ---------------------------------------------------------------------------
 * TWO KINDS OF CONFIGURATION, SHOWN AS TWO
 * ---------------------------------------------------------------------------
 * The editable card holds business defaults for the NEXT quotation. Each
 * quotation stores its own VAT rate and closing paragraph and is recomputed
 * from those, so saving here cannot change a quotation that already exists.
 *
 * The read-only card reports deployment configuration. It is deliberately not
 * editable, and the page says why rather than leaving an administrator to
 * wonder whether the field is broken:
 *
 *   - the numbering codes decide every quotation number and every Drive folder
 *     name; changing one would invalidate the archive;
 *   - the printed company identity lives in the letterhead ARTWORK, which the
 *     PDF embeds directly. Editing text here would change the Word document and
 *     not the PDF, and the two files for one quotation would disagree.
 *
 * No secret is displayed. The codes and the VAT number are printed on every
 * quotation; the Script Properties that are secret are not read by this screen
 * at all.
 */
export default function SettingsPage() {
  const { state } = useAuth();
  const { show } = useToast();
  const queryClient = useQueryClient();

  const token = state.status === 'authenticated' ? state.token : null;
  const isAdmin = state.status === 'authenticated' && state.user.role === 'Admin';

  const [draft, setDraft] = useState<BusinessSettings | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string> | null>(null);

  const settings = useQuery({
    queryKey: ['settings'],
    queryFn: () => getSettings(token ?? ''),
    enabled: token !== null && isAdmin,
  });

  const saveMutation = useMutation({
    mutationFn: (values: BusinessSettings) => updateSettings(values, token ?? ''),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
      setDraft(saved.business);
      setFormError(null);
      setFieldErrors(null);
      show({ variant: 'success', message: 'Company settings saved.' });
    },
    onError: (error: unknown) => {
      if (error instanceof AppError && error.fields !== undefined) {
        setFieldErrors(error.fields);
        return;
      }
      setFormError(businessMessageOf(error));
    },
  });

  if (!isAdmin) {
    return <NotAuthorized />;
  }

  // Seed the editable copy from the server once, without an effect — deriving
  // it during render keeps in-progress typing from being overwritten whenever
  // the query refetches.
  const loaded = settings.data;
  if (loaded !== undefined && draft === null) {
    setDraft(loaded.business);
  }

  const vatPercent = draft === null ? '' : String(draft.defaultVatRateBasisPoints / 100);

  return (
    <>
      <PageHeader
        title="Company Settings"
        description="Defaults applied to new quotations, and the configuration this deployment was set up with."
      />

      {settings.isPending ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" label="Loading company settings" />
        </div>
      ) : settings.isError ? (
        <Card>
          <p role="alert" className="text-brand-red text-sm">
            {messageOf(settings.error)}
          </p>
        </Card>
      ) : draft === null ? null : (
        <div className="flex flex-col gap-4">
          <Card
            title="Quotation defaults"
            description="Applied to new quotations only. Quotations that already exist keep the values they were created with."
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                saveMutation.mutate(draft);
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Default VAT rate"
                  required
                  hint="Percent. Can still be changed on an individual quotation."
                  {...errorProp(fieldErrors?.['defaultVatRateBasisPoints'])}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                      value={vatPercent}
                      invalid={invalid}
                      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                      onChange={(event) => {
                        // Stored as basis points, so the rate stays an integer
                        // and never accumulates a floating-point error.
                        const percent = Number.parseFloat(event.target.value);
                        setDraft({
                          ...draft,
                          defaultVatRateBasisPoints: Number.isFinite(percent)
                            ? Math.round(percent * 100)
                            : 0,
                        });
                      }}
                    />
                  )}
                </Field>

                <Field
                  label="Quotation validity"
                  required
                  hint="Days. Resolves the {{quotation.validityDays}} token in a term."
                  {...errorProp(fieldErrors?.['quotationValidityDays'])}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      type="number"
                      min="1"
                      max="365"
                      value={String(draft.quotationValidityDays)}
                      invalid={invalid}
                      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                      onChange={(event) => {
                        const days = Number.parseInt(event.target.value, 10);
                        setDraft({
                          ...draft,
                          quotationValidityDays: Number.isFinite(days) ? days : 0,
                        });
                      }}
                    />
                  )}
                </Field>
              </div>

              <Field
                label="Default closing paragraph"
                required
                hint="Printed at the end of the quotation. Can be edited per quotation."
                {...errorProp(fieldErrors?.['defaultClosingParagraph'])}
              >
                {({ id, describedBy, invalid }) => (
                  <Textarea
                    id={id}
                    rows={6}
                    value={draft.defaultClosingParagraph}
                    invalid={invalid}
                    {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
                    onChange={(event) => {
                      setDraft({ ...draft, defaultClosingParagraph: event.target.value });
                    }}
                  />
                )}
              </Field>

              {formError === null ? null : (
                <p role="alert" className="text-brand-red text-sm">
                  {formError}
                </p>
              )}

              <div className="flex justify-end">
                <Button type="submit" isLoading={saveMutation.isPending}>
                  Save settings
                </Button>
              </div>
            </form>
          </Card>

          <Card
            title="Deployment configuration"
            description="Set when this deployment was created, and not editable here. Changing any of it is a deployment change, not a settings change."
          >
            <div className="flex flex-col">
              <ReadOnlyRow
                label="Quotation number format"
                value={`${settings.data.deployment.companyCode}/${settings.data.deployment.branchCode}/${settings.data.deployment.documentTypeCode}/YYYY/###`}
                hint="Every issued number and every Drive folder is named from these codes. Changing them would invalidate the archive."
              />
              <ReadOnlyRow
                label="VAT registration number"
                value={settings.data.deployment.vatNumber}
                hint="Printed on the quotation. Set as a Script Property."
              />
              <ReadOnlyRow
                label="Company name"
                value={COMPANY_IDENTITY.name}
                hint="Printed from the letterhead artwork the PDF embeds."
              />
              <ReadOnlyRow
                label="Commercial registration"
                value={COMPANY_IDENTITY.crNumber}
                hint="From the letterhead."
              />
            </div>

            <p className="mt-4 text-xs text-slate-500">
              The company name, address, phone, email and website are part of the letterhead
              artwork, which the PDF embeds directly. Editing them as text here would change the
              Word document and not the PDF, so they are changed by replacing the letterhead and
              redeploying.
            </p>
          </Card>
        </div>
      )}
    </>
  );
}
