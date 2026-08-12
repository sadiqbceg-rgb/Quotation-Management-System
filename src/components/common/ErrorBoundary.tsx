import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './Button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

/**
 * Catches render-time failures so a component crash shows a recoverable screen
 * instead of a blank page.
 *
 * The message shown is intentionally generic — a stack trace must never reach
 * the user (§19.9). Details go to the console for a developer only.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = { hasError: false, message: '' };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true, message: 'Something went wrong while displaying this page.' };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error', error, info.componentStack);
  }

  private readonly handleReload = (): void => {
    this.setState({ hasError: false, message: '' });
    window.location.reload();
  };

  public override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="max-w-md rounded-lg border border-slate-200 bg-white p-6 text-center">
          <h1 className="text-base font-semibold text-slate-900">{this.state.message}</h1>
          <p className="mt-2 text-sm text-slate-500">
            Your unsaved work may still be recoverable by going back. If this keeps happening,
            contact an administrator.
          </p>
          <Button className="mt-4" onClick={this.handleReload}>
            Reload the application
          </Button>
        </div>
      </div>
    );
  }
}
