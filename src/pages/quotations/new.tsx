import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';

/**
 * New Quotation.
 *
 * Deliberately inert in Phase 01. PRD §35 requires that opening the application
 * — including this page — must NOT create a quotation or reserve a quotation
 * number. Phase 03 adds the form, mints the client-side draft id, and reserves
 * the official number only on an explicit save.
 */
export default function NewQuotationPage() {
  return (
    <>
      <PageHeader
        title="New Quotation"
        description="Create a quotation. A quotation number is issued only when you save."
      />
      <PhasePlaceholder phase="03 (Quotation Core)" feature="The quotation form" />
    </>
  );
}
