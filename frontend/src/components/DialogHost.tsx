import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useDialogs } from '../lib/dialog';

/** Renders the dialog at the front of the queue — mount once, at the app root. */
export function DialogHost() {
  const current = useDialogs((s) => s.queue[0]);
  const settle = useDialogs((s) => s.settle);
  const [value, setValue] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const confirmBtn = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    if (!current) return;
    returnFocus.current = document.activeElement;
    setValue(current.kind === 'prompt' ? (current.defaultValue ?? '') : '');
    requestAnimationFrame(() => {
      if (current.kind === 'prompt') {
        field.current?.focus();
        field.current?.select();
      } else {
        confirmBtn.current?.focus();
      }
    });
    return () => {
      const el = returnFocus.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, [current]);

  if (!current) return null;

  const cancel = () => settle(current.kind === 'confirm' ? false : null);
  const confirm = () => settle(current.kind === 'confirm' ? true : value);

  // Escape cancels; Tab stays inside the dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>('button, input, textarea')].filter((el) => !el.hasAttribute('disabled'));
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const titleId = 'app-dialog-title';
  const messageId = current.message ? 'app-dialog-message' : undefined;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        ref={box}
        role={current.kind === 'confirm' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-2xl bg-[var(--surface-raised)] px-6 py-7 text-center shadow-2xl sm:px-8"
      >
        <h2 id={titleId} className="text-xl font-bold text-[var(--text-primary)]">
          {current.title}
        </h2>
        {current.message && (
          <p id={messageId} className="mt-2 text-sm whitespace-pre-line text-[var(--text-secondary)]">
            {current.message}
          </p>
        )}

        {current.kind === 'prompt' &&
          (current.multiline ? (
            <textarea
              ref={field}
              value={value}
              readOnly
              rows={8}
              className="mt-4 w-full rounded-lg border border-[var(--border-strong)] bg-transparent p-3 text-left text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-blue)]"
            />
          ) : (
            <input
              ref={field}
              value={value}
              placeholder={current.placeholder}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  confirm();
                }
              }}
              className="mt-4 w-full rounded-lg border border-[var(--border-strong)] bg-transparent px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--series-blue)]"
            />
          ))}

        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={cancel}
            className="h-11 min-w-[7.5rem] rounded-lg border border-[var(--border-strong)] bg-[var(--surface-raised)] px-5 text-base font-semibold text-[var(--text-primary)] hover:bg-[var(--surface-sunken)]"
          >
            {current.cancelLabel ?? 'Cancel'}
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={confirm}
            className="h-11 min-w-[9rem] rounded-lg bg-[var(--series-blue)] px-5 text-base font-semibold text-white hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--series-blue)]"
          >
            {current.confirmLabel ?? 'OK'}
          </button>
        </div>
      </div>
    </div>
  );
}
