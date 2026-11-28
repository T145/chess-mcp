import { useEffect, useId, useRef, type ReactNode } from 'react';

import { CloseIcon } from './Icons';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  widthClass?: string;
  /** Keep the title for screen readers but hide it visually. */
  hideTitle?: boolean;
  /** Render an X close button in the top-right corner. */
  closeButton?: boolean;
  /** Keep the modal frame fixed and scroll its contents in place. */
  scrollable?: boolean;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  widthClass = 'max-w-md',
  hideTitle = false,
  closeButton = false,
  scrollable = false
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : 'Dialog'}
      className={`dialog-panel ${
        scrollable ? 'dialog-panel-scroll' : ''
      } w-[calc(100%-2rem)] ${widthClass} rounded-2xl border border-line bg-panel p-0 text-ink shadow-2xl`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      {closeButton && (
        <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-4 sm:px-5">
          {title && !hideTitle ? (
            <h2 id={titleId} className="min-w-0 flex-1 text-lg font-semibold tracking-tight">
              {title}
            </h2>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-panel-2 text-ink transition-colors hover:bg-panel"
          >
            <CloseIcon className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>
      )}
      <div
        className={
          scrollable
            ? `flex min-h-0 flex-1 flex-col px-4 pb-4 sm:px-5 sm:pb-5 ${
                closeButton ? '' : 'pt-4'
              }`
            : 'p-5 sm:p-6'
        }
      >
        {title && (!closeButton || hideTitle) && (
          <h2
            id={titleId}
            className={hideTitle ? 'sr-only' : 'text-lg font-semibold tracking-tight'}
          >
            {title}
          </h2>
        )}
        <div
          className={
            scrollable
              ? 'min-h-0 flex-1 overflow-y-auto pr-1'
              : title && !hideTitle && !closeButton
                ? 'mt-4'
                : ''
          }
        >
          {children}
        </div>
      </div>
    </dialog>
  );
}
