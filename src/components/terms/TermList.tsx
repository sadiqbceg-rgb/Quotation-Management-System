import { useState } from 'react';

import { Button } from '@/components/common/Button';
import { EmptyState } from '@/components/common/EmptyState';
import type { ResolvedTerm } from '@/hooks/useQuotationTerms';
import { EditTermInline } from './EditTermInline';
import { TermOrderControls } from './TermOrderControls';
import { TermOverrideBadge } from './TermOverrideBadge';

export interface TermListProps {
  terms: readonly ResolvedTerm[];
  onMove: (id: string, direction: -1 | 1) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: { title: string; bodyTemplate: string }) => void;
  onRevert: (id: string) => void;
}

/**
 * The terms this quotation carries, in document order.
 *
 * Numbering is POSITIONAL — 1, 2, 3 … by array position — matching the approved
 * quotation and §10.3. Nothing here reads a stored `sortOrder`, so removing a
 * term from the middle renumbers the rest with no bookkeeping to get wrong.
 *
 * Bodies are rendered as text nodes. Terms are never HTML and never go through
 * `dangerouslySetInnerHTML`.
 */
export function TermList({ terms, onMove, onRemove, onEdit, onRevert }: TermListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (terms.length === 0) {
    return (
      <EmptyState
        title="No terms selected"
        description="Tick the terms that apply, or create one for this quotation. They print as a numbered list under “General Terms & Conditions”."
      />
    );
  }

  return (
    <ol className="flex flex-col gap-2">
      {terms.map((term) => (
        <li
          key={term.id}
          className="flex items-start gap-2 rounded-md border border-slate-200 px-3 py-2.5"
        >
          <TermOrderControls
            title={term.title}
            isFirst={term.position === 1}
            isLast={term.position === terms.length}
            onMove={(direction) => {
              onMove(term.id, direction);
            }}
          />

          <span className="w-6 shrink-0 pt-1 text-sm font-medium text-slate-500 tabular-nums">
            {term.position}.
          </span>

          <div className="min-w-0 flex-1">
            {editingId === term.id ? (
              <EditTermInline
                title={term.title}
                bodyTemplate={term.bodyTemplate}
                onSave={(values) => {
                  onEdit(term.id, values);
                  setEditingId(null);
                }}
                onCancel={() => {
                  setEditingId(null);
                }}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{term.title}</span>
                  <TermOverrideBadge source={term.source} />
                </div>
                <p className="mt-0.5 text-sm whitespace-pre-line text-slate-600">{term.body}</p>

                {term.unresolvedTokens.length > 0 ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Needs a value before this quotation is issued:{' '}
                    {term.unresolvedTokens.map((token) => `{{${token}}}`).join(', ')}
                  </p>
                ) : null}
              </>
            )}
          </div>

          {editingId === term.id ? null : (
            <div className="flex shrink-0 gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditingId(term.id);
                }}
              >
                Edit
              </Button>

              {term.source === 'library-overridden' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onRevert(term.id);
                  }}
                >
                  Revert to library version
                </Button>
              ) : null}

              <Button
                variant="ghost"
                size="sm"
                aria-label={`Remove "${term.title}"`}
                onClick={() => {
                  onRemove(term.id);
                }}
              >
                Remove
              </Button>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
