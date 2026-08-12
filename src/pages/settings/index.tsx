import { PageHeader } from '@/components/common/PageHeader';
import { PhasePlaceholder } from '@/components/common/PhasePlaceholder';

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Company Settings"
        description="Company details, defaults and document configuration."
      />
      <PhasePlaceholder
        phase="14 (Production Deployment) with values captured from Phase 03 onward"
        feature="Company settings"
      />
    </>
  );
}
