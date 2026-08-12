import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';

export default function SignatoriesPage() {
  return (
    <>
      <PageHeader
        title="Authorized Persons"
        description="Signatories and their signature images."
      />
      <PhasePlaceholder phase="06 (Authorized Persons)" feature="The authorized persons library" />
    </>
  );
}
