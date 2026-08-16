import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';

export default function CustomersPage() {
  return (
    <>
      <PageHeader title="Customers" description="Client records reused across quotations." />
      <EmptyState
        title="Customer library is not part of the current V1 release"
        description="Customer details can be entered directly when creating a quotation. A reusable customer library is planned for a future version."
      />
    </>
  );
}
