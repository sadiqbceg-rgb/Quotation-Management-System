import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  children: ReactNode;
}

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const;

/**
 * An accessible modal dialog.
 *
 * Radix handles the focus trap, escape handling, scroll locking, portalling and
 * ARIA wiring — the parts that are easy to get subtly wrong by hand. This is
 * the "+ Create New Term" modal in PRD §21 and every confirmation dialog.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  footer,
  size = 'md',
  children,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/40" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-slate-200 bg-white shadow-lg',
            SIZES[size],
          )}
        >
          <div className="border-b border-slate-200 px-5 py-3.5">
            <Dialog.Title className="text-sm font-semibold text-slate-900">{title}</Dialog.Title>
            {description !== undefined ? (
              <Dialog.Description className="mt-0.5 text-xs text-slate-500">
                {description}
              </Dialog.Description>
            ) : null}
          </div>

          <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>

          {footer !== undefined ? (
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
              {footer}
            </div>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;
