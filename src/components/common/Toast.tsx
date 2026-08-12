import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { cn } from '@/utils/cn';
import { newRequestId } from '@/utils/uuid';
import { ToastContext, type Toast as ToastModel, type ToastContextValue } from '@/hooks/useToast';

const VARIANT_CLASSES = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-red-200 bg-red-50 text-red-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  info: 'border-slate-200 bg-white text-slate-900',
} as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastModel[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: Omit<ToastModel, 'id'>) => {
    setToasts((current) => [...current, { ...toast, id: newRequestId() }]);
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, show, dismiss }),
    [toasts, show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: readonly ToastModel[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="Notifications"
      className="fixed right-4 bottom-4 z-50 flex w-full max-w-sm flex-col gap-2"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          className={cn(
            'rounded-md border px-4 py-3 text-sm shadow-sm',
            VARIANT_CLASSES[toast.variant],
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p>{toast.message}</p>
              {toast.requestId !== undefined ? (
                <p className="mt-1 font-mono text-[11px] break-all opacity-70">
                  Reference: {toast.requestId}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => {
                onDismiss(toast.id);
              }}
              className="shrink-0 rounded p-0.5 text-lg leading-none opacity-60 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
