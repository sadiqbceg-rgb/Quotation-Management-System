import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';
import { buttonClasses } from '@/components/common/Button';

export default function QuotationsPage() {
  return (
    <>
      <PageHeader
        title="Quotations"
        description="All quotations issued by the company."
        actions={
          <Link to="/quotations/new" className={buttonClasses()}>
            New Quotation
          </Link>
        }
      />
      <PhasePlaceholder
        phase="03 (Quotation Core) and 11 (Google Sheets)"
        feature="The quotation list"
      />
    </>
  );
}
