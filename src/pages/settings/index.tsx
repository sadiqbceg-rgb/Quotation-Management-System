import { PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';

export default function SettingsPage() {
  return (
    <>
      <PageHeader
        title="Company Settings"
        description="Company details, defaults and document configuration."
      />
      <EmptyState
        title="Company settings are managed by the administrator"
        description="Company information used by quotations is configured during deployment. There is no editable Company Settings module in the current V1 release."
      />
    </>
  );
}
