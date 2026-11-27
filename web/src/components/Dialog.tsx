import { useEffect, useId, useRef, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  widthClass?: string;
}

export function Dialog({ open, onClose, title, children, widthClass = 'max-w-md' }: DialogProps) {
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
      aria-labelledby={titleId}
      className={`dialog-panel w-[calc(100%-2rem)] ${widthClass} rounded-2xl border border-line bg-panel p-0 text-ink shadow-2xl`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <div className="p-5 sm:p-6">
        <h2 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <div className="mt-4">{children}</div>
      </div>
    </dialog>
  );
}
