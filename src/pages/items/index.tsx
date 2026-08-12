import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';

export default function ItemsPage() {
  return (
    <>
      <PageHeader
        title="Items / Services"
        description="Reusable manpower, equipment and material items."
      />
      <PhasePlaceholder phase="04 (Item Categories)" feature="The item library" />
    </>
  );
}
