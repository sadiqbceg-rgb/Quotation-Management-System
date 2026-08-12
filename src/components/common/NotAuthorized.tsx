import { Link } from 'react-router-dom';
import { PageHeader } from './PageHeader';
import { EmptyState } from './EmptyState';
import { buttonClasses } from './Button';

export function NotAuthorized() {
  return (
    <>
      <PageHeader title="Not authorized" />
      <EmptyState
        title="You do not have access to this section"
        description="Company Settings and Authorized Persons are restricted to administrators. If you need access, ask an administrator to change your role."
        action={
          <Link to="/" className={buttonClasses('secondary')}>
            Back to dashboard
          </Link>
        }
      />
    </>
  );
}
