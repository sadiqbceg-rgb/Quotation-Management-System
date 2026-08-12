import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';

export default function CustomersPage() {
  return (
    <>
      <PageHeader title="Customers" description="Client records reused across quotations." />
      <PhasePlaceholder phase="03 (Quotation Core)" feature="The customer library" />
    </>
  );
}
